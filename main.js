import ProxyManager from "./src/utils/http_utils.js";
import { VintedItem } from "./src/entities/vinted_item.js";
import { Preference } from "./src/database.js";
import client from "./src/client.js";
import ConfigurationManager from "./src/utils/config_manager.js";
import { postMessageToChannel } from "./src/services/discord_service.js";
import { createVintedItemEmbed, createVintedItemActionRow } from "./src/bot/components/item_embed.js";
import crud from "./src/crud.js";
import Logger from "./src/utils/logger.js";
import { initVintedBrowser, refreshVintedSession, closeVintedBrowser } from "./src/api/vinted_browser.js";
import http from "node:http";
import { startMonitor } from "./src/services/monitor_service.js";
import { estimateProfit } from "./src/services/profit_service.js";
import { getItemDetails, keywordsMatch } from "./src/services/description_service.js";

ProxyManager.init();

const algorithmSettings = ConfigurationManager.getAlgorithmSetting;
const domain = algorithmSettings.vinted_api_domain_extension;
const token = ConfigurationManager.getDiscordConfig.token;

if (!token) {
    throw new Error("DISCORD_TOKEN is required (set it in .env)");
}
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 3000;

Logger.info("Starting Vinted Bot");

// 1. Open the browser session (gets Cloudflare + access_token_web cookies).
while (true) {
    try {
        await initVintedBrowser();
        break;
    } catch (error) {
        Logger.error(`Could not start Vinted session: ${error?.stack || error}`);
        await new Promise((r) => setTimeout(r, 5000));
    }
}

// 2. Keep the anonymous token fresh (also refreshed on demand after a 401/403).
const sessionRefreshTimer = setInterval(async () => {
    try {
        await refreshVintedSession();
    } catch (error) {
        Logger.error(`Session refresh failed: ${error?.message || error}`);
    }
}, 20 * 60 * 1000);

// 3. Monitored channels
Logger.info("Fetching monitored channels");
let allMonitoringChannels = await crud.getAllMonitoredVintedChannels();
Logger.info(`Monitoring ${allMonitoringChannels.length} Vinted channels`);

crud.eventEmitter.on("updated", async () => {
    allMonitoringChannels = await crud.getAllMonitoredVintedChannels();
    Logger.debug("Updated vinted channels");
});

const sendToChannel = async (item, vintedChannel) => {
    const { embed, photosEmbeds } = await createVintedItemEmbed(item);
    const actionRow = await createVintedItemActionRow(item);

    const user = vintedChannel.user;
    const doMentionUser = user && vintedChannel.preferences.get(Preference.Mention);
    const mentionString = doMentionUser ? `<@${user.discordId}>` : "";

    try {
        await postMessageToChannel(
            token,
            vintedChannel.channelId,
            `${mentionString} `,
            [embed, ...photosEmbeds],
            [actionRow]
        );
    } catch (error) {
        Logger.debug("Error posting message to channel");
        Logger.debug(error);
    }
};

// 4. Poll the catalogue and post new listings
const monitor = startMonitor({
    getChannels: () => allMonitoringChannels,
    domain,
    intervalMs: POLL_INTERVAL_MS,
    // Prefetch description + profitability (results cached per listing).
    prefetch: (rawItem) => {
        const item = new VintedItem(rawItem, domain);
        getItemDetails(item);
        estimateProfit(item);
    },
    onItem: async (rawItem, channel) => {
        const item = new VintedItem(rawItem, domain);

        // Profit badge + listing description, in parallel.
        // Neither blocks: null if too slow or on error.
        const [profit, details] = await Promise.all([estimateProfit(item), getItemDetails(item)]);
        item.profit = profit;
        item.description = details?.description ?? "";

        // Channel keywords: Vinted already filters server-side; once the description is
        // known, also verify each word is in the title or description.
        // If the description is unknown (unreadable), trust Vinted.
        if (channel.keywords && item.description && !keywordsMatch(channel.keywords, item.title, item.description)) {
            Logger.debug(`Item ${item.id} skipped: keywords "${channel.keywords}" not found in title/description`);
            return;
        }

        await sendToChannel(item, channel);
    },
});

Logger.info("Monitoring started");

// Optional health endpoint (enable with HEALTH_PORT).
const healthPort = Number(process.env.HEALTH_PORT);
if (healthPort > 0) {
    const healthServer = http.createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    healthServer.listen(healthPort, () => Logger.info(`Health endpoint listening on ${healthPort}`));
}

// Graceful shutdown handlers
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    Logger.info(`Received ${signal}, shutting down...`);
    try { monitor?.stop?.(); } catch (e) { Logger.debug(e); }
    try { clearInterval(sessionRefreshTimer); } catch (e) { Logger.debug(e); }
    try { await closeVintedBrowser(); } catch (e) { Logger.debug(e); }
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
    Logger.error(`Unhandled rejection: ${reason?.stack || reason}`);
});
process.on("uncaughtException", (error) => {
    Logger.error(`Uncaught exception: ${error?.stack || error}`);
    // Exit after logging so the process manager can restart cleanly.
    process.exit(1);
});