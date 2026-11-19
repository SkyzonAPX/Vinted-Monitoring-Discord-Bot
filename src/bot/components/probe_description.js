// Probe item description. Run from project root:
//   node probe_description.js "https://www.vinted.fr/items/123-name"
// Uses the same extraction as the bot (src/api/item_page_extractor.js).
import { chromium } from "playwright";
import { extractItemInfo } from "./src/api/item_page_extractor.js";

const url = process.argv[2];
if (!url) {
    console.log('Usage : node probe_description.js "https://www.vinted.fr/items/123-nom"');
    process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
    const ctx = await browser.newContext({
        locale: "fr-FR",
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    });

    // Same session warm-up as the bot
    const home = await ctx.newPage();
    await home.goto(new URL(url).origin + "/catalog", { waitUntil: "domcontentloaded", timeout: 30000 });
    await home.waitForTimeout(2000);

    const tab = await ctx.newPage();
    await tab.route("**/*", (r) =>
        ["image", "media", "font", "stylesheet"].includes(r.request().resourceType()) ? r.abort() : r.continue()
    );

    const t0 = Date.now();
    const response = await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    console.log(`HTTP ${response?.status()} en ${Date.now() - t0} ms`);

    const info = await tab.evaluate(extractItemInfo);
    console.log("\n──────── RÉSULTAT ────────");
    console.log("Source      :", info.source || "(aucune)");
    console.log("Description :", info.description || "(vide)");
    console.log("Couleur     :", info.color ? `${info.color}  (source : ${info.colorSource})` : "(non trouvée)");

    if (!info.description) {
        const diag = await tab.evaluate(() => ({
            title: document.title,
            jsonLdTypes: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
                try { return JSON.stringify([].concat(JSON.parse(s.textContent)).map((x) => x["@type"] || Object.keys(x))); }
                catch { return "JSON invalide"; }
            }),
            hasItempropDescription: !!document.querySelector('[itemprop="description"]'),
            ogDescription: document.querySelector('meta[property="og:description"]')?.content?.slice(0, 200) ?? null,
            debutDeLaPage: (document.body?.innerText || "").slice(0, 200),
        }));
        console.log("\nDescription introuvable. Diagnostic (envoie-moi ceci) :");
        console.log(JSON.stringify(diag, null, 2));
    }
} finally {
    await browser.close();
}