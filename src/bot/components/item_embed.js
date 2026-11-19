import { EmbedBuilder, ActionRowBuilder } from "discord.js";
import { createBaseUrlButton, createBaseEmbed } from "./base_embeds.js";
import Logger from "../../utils/logger.js";
import { LEVELS, formatProfitField } from "../../services/profit_service.js";

const money = (amount, currency) => `${amount.toFixed(2)} ${currency}`.trim();

export async function createVintedItemEmbed(item) {
    const profit = item.profit ?? null;
    const color = profit ? LEVELS[profit.level].color : 0x00ff00;
    const embed = await createBaseEmbed(null, item.title, "", color);

    embed.setURL(item.url);

    const seller = item.user.url ? `[${item.user.login}](${item.user.url})` : item.user.login;
    // With a description, it becomes embed text and seller moves to a field.
    const hasDescription = Boolean(item.description);
    embed.setDescription(hasDescription ? item.description : `👤 ${seller}`);

    const fields = [
        { name: "💰 Price", value: money(item.priceNumeric, item.currency), inline: true },
        { name: "🧾 With buyer protection", value: money(item.totalPriceNumeric, item.currency), inline: true },
        { name: "📏 Size", value: item.size, inline: true },
        { name: "🏷️ Brand", value: item.brand, inline: true },
        { name: "📦 Condition", value: item.status, inline: true },
    ];
    if (hasDescription) fields.push({ name: "👤 Vendeur", value: seller, inline: true });
    if (profit) fields.push(formatProfitField(profit, item.currency));
    embed.setFields(fields);

    const photosEmbeds = [];
    const maxPhotos = 3;

    const first = item.photos[0];
    if (!first || !first.fullSizeUrl) {
        Logger.debug(`No photo for item ${item.id}`);
        return { embed, photosEmbeds };
    }
    embed.setImage(first.fullSizeUrl);

    for (let i = 1; i < item.photos.length && i < maxPhotos; i++) {
        photosEmbeds.push(
            new EmbedBuilder().setImage(item.photos[i].fullSizeUrl).setURL(item.url)
        );
    }

    return { embed, photosEmbeds };
}

export async function createVintedItemActionRow(item) {
    const actionRow = new ActionRowBuilder();
    const d = item.domain;

    const sendMessageUrl = `https://www.vinted.${d}/items/${item.id}/want_it/new?button_name=receiver_id=${item.id}`;
    const buyUrl = `https://www.vinted.${d}/transaction/buy/new?source_screen=item&transaction%5Bitem_id%5D=${item.id}`;

    actionRow.addComponents(
        await createBaseUrlButton("🔗 View on Vinted", item.url),
        await createBaseUrlButton("📨 Send Message", sendMessageUrl),
        await createBaseUrlButton("💸 Buy", buyUrl)
    );

    return actionRow;
}