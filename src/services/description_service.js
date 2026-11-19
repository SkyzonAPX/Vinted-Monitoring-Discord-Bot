import { fetchItemPageInfo } from "../api/vinted_browser.js";
import Logger from "../utils/logger.js";

// Settings (all optional, in .env):
//   DESCRIPTION_ENABLED=0        disable description fetch
//   DESCRIPTION_TIMEOUT_MS=8000  max wait before posting without description
//   DESCRIPTION_CONCURRENCY=2    concurrent item pages
//   DESCRIPTION_MAX_CHARS=350    max length shown in embed
const num = (v, d) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : d;
};

const getSettings = () => ({
    enabled: process.env.DESCRIPTION_ENABLED !== "0",
    timeoutMs: num(process.env.DESCRIPTION_TIMEOUT_MS, 8000),
    concurrency: Math.max(1, num(process.env.DESCRIPTION_CONCURRENCY, 2)),
    maxChars: num(process.env.DESCRIPTION_MAX_CHARS, 350),
});

// ---------- pure helpers ----------

const strip = (t) =>
    String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * All keywords must appear in the title or description.
 * Case- and accent-insensitive; "sacs" matches "sac".
 */
export function keywordsMatch(keywords, ...texts) {
    const words = strip(keywords).split(/[^a-z0-9&]+/).filter(Boolean);
    if (!words.length) return true;
    const haystack = strip(texts.join(" "));
    return words.every((w) => haystack.includes(w.length > 3 ? w.replace(/[sx]$/, "") : w));
}

export function cleanDescription(text, maxChars = 350) {
    const t = String(text ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\u00a0]+/g, " ")       // collapse spaces
        .replace(/ ?\n ?/g, "\n")             // trim around newlines
        .replace(/\n{3,}/g, "\n\n")           // max one blank line
        .trim();
    return t.length > maxChars ? `${t.slice(0, maxChars - 1).trimEnd()}…` : t;
}

// ---------- queue + cache ----------

let active = 0;
const waiting = [];
const acquire = (max) =>
    new Promise((resolve) => {
        const go = () => { active++; resolve(); };
        active < max ? go() : waiting.push(go);
    });
const release = () => {
    active--;
    waiting.shift()?.();
};

const cache = new Map(); // item id -> Promise<{description, source} | null>
const MAX_CACHE = 500;

/**
 * Fetch an item's description. Never throws: returns null if disabled,
 * too slow, or failed (item posted without description).
 */
export async function getItemDetails(item) {
    const s = getSettings();
    if (!s.enabled) return null;

    let pending = cache.get(item.id);
    if (!pending) {
        pending = (async () => {
            await acquire(s.concurrency);
            try {
                const info = await fetchItemPageInfo(item.url, s.timeoutMs + 2000);
                return {
                    description: cleanDescription(info?.description, s.maxChars),
                    source: info?.source ?? "",
                    color: info?.color ?? "",
                };
            } finally {
                release();
            }
        })().catch((error) => {
            Logger.debug(`Description fetch failed for ${item.id}: ${error?.message || error}`);
            return null;
        });
        cache.set(item.id, pending);
        while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }

    let timer;
    const timeout = new Promise((r) => { timer = setTimeout(() => r(null), s.timeoutMs); });
    try {
        return await Promise.race([pending, timeout]);
    } finally {
        clearTimeout(timer);
    }
}