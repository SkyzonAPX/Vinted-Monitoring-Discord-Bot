import { fetchCatalogItems } from "../api/fetchCatalogItems.js";
import Logger from "../utils/logger.js";

// Settings (all optional, in .env):
//   PROFIT_ENABLED=0            disable profit calc
//   PROFIT_DECOTE=15            market price discount, %
//   PROFIT_GREEN_PCT=30         min margin for 🟢
//   PROFIT_ORANGE_PCT=10        min margin for 🟠
//   PROFIT_MIN_COMPARABLES=5    below: ⚪ not enough data
//   PROFIT_MAX_PCT=200          above: 🟣 suspect profitability (unreliable)
//   PROFIT_CACHE_MINUTES=30     search cache TTL
//   PROFIT_TIMEOUT_MS=2500      max wait before posting without badge
const num = (v, d) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : d;
};

function getSettings() {
    return {
        enabled: process.env.PROFIT_ENABLED !== "0",
        decote: num(process.env.PROFIT_DECOTE, 15),
        green: num(process.env.PROFIT_GREEN_PCT, 30),
        orange: num(process.env.PROFIT_ORANGE_PCT, 10),
        minComparables: num(process.env.PROFIT_MIN_COMPARABLES, 5),
        maxPct: num(process.env.PROFIT_MAX_PCT, 200),
        ttlMs: num(process.env.PROFIT_CACHE_MINUTES, 30) * 60000,
        timeoutMs: num(process.env.PROFIT_TIMEOUT_MS, 2500),
    };
}

const MIN_GAP_MS = 800; // ~1 comparable search per second max
const MAX_CACHE = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- pure helpers ----------

// ---------- similarity criteria: brand, size, color ----------

const strip = (t) =>
    String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const COLOR_WORDS = {
    noir: ["noir", "noire", "noirs", "black", "negro", "nero"],
    blanc: ["blanc", "blanche", "white", "blanco", "bianco"],
    gris: ["gris", "grise", "grey", "gray", "grigio"],
    bleu: ["bleu", "bleue", "blue", "azul", "blu", "marine", "navy"],
    vert: ["vert", "verte", "green", "verde"],
    rouge: ["rouge", "red", "rojo", "rosso"],
    rose: ["rose", "pink", "rosa"],
    jaune: ["jaune", "yellow", "amarillo", "giallo"],
    orange: ["orange", "naranja", "arancione"],
    violet: ["violet", "violette", "purple", "morado", "viola", "mauve"],
    marron: ["marron", "brown", "marrone"],
    beige: ["beige", "creme", "cream"],
    kaki: ["kaki", "khaki"],
    bordeaux: ["bordeaux", "burgundy"],
    turquoise: ["turquoise"],
    dore: ["dore", "doree", "gold", "dorado", "oro"],
    argente: ["argente", "argentee", "silver", "plateado", "argento"],
    multicolore: ["multicolore", "multicolor", "multicolour"],
};

const COLOR_LOOKUP = new Map(
    Object.entries(COLOR_WORDS).flatMap(([canon, words]) => words.map((w) => [w, canon]))
);

export function detectColors(title) {
    const tokens = strip(title).split(/[^a-z0-9]+/).filter(Boolean);
    // Also matches plurals: noires, vertes, bleus...
    const lookup = (t) => COLOR_LOOKUP.get(t) ?? COLOR_LOOKUP.get(t.replace(/s$/, ""));
    return [...new Set(tokens.map(lookup).filter(Boolean))];
}

// second_line = "size · condition", or just condition when no size
export function parseSecondLine(line) {
    const parts = String(line ?? "").split(" · ").filter(Boolean);
    return parts.length >= 2 ? { size: parts[0], status: parts.slice(1).join(" · ") } : { size: "", status: parts[0] ?? "" };
}

// Raw catalog listing -> comparison entry
export function parseListing(raw) {
    const box = raw.item_box ?? {};
    const title = raw.title ?? "";
    return {
        id: raw.id,
        price: parseFloat(raw.price?.amount),
        title,
        brand: box.first_line && box.first_line !== title ? box.first_line : "",
        size: parseSecondLine(box.second_line).size,
        colors: detectColors(title),
    };
}

const CRITERIA_ORDER = ["brand", "size", "color"]; // drop first: color, then size

export function referenceOf(item) {
    return {
        brand: item.brand && item.brand !== "N/A" ? item.brand : "",
        size: item.size && item.size !== "N/A" ? item.size : "",
        colors: detectColors(item.title),
    };
}

export function criteriaLevels(ref) {
    const has = {
        brand: !!ref.brand,
        size: !!ref.size,
        color: ref.colors.length > 0,
    };
    const crit = CRITERIA_ORDER.filter((c) => has[c]);
    // Known brand stays required: H&M won't compare with Louis Vuitton.
    const minLength = has.brand ? 1 : 0;
    const levels = [];
    for (let k = crit.length; k >= minLength; k--) levels.push(crit.slice(0, k));
    return levels; // e.g. [[brand,size,color],[brand,size],[brand]]
}

export function matches(entry, ref, crit) {
    if (crit.includes("brand") && strip(entry.brand) !== strip(ref.brand)) return false;
    if (crit.includes("size") && strip(entry.size).replace(/\s+/g, "") !== strip(ref.size).replace(/\s+/g, "")) return false;
    if (crit.includes("color") && !entry.colors.some((c) => ref.colors.includes(c))) return false;
    return true;
}

export function describeCriteria(crit, ref) {
    const label = {
        brand: `marque ${ref.brand}`,
        size: `taille ${ref.size}`,
        color: `couleur ${ref.colors.join("/")}`,
    };
    return crit.map((c) => label[c]);
}

// Buyer protection fee (verified on real listings): 0.70 + 5%
export const buyerFee = (price) => 0.7 + 0.05 * price;

export function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Split text into search words. "&" stays in the word (H&M, M&S).
const tokenize = (text) =>
    String(text ?? "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}&]+/gu, " ")
        .split(/\s+/)
        .filter((w) => w && w !== "&");

/**
 * Search queries, most specific to broadest.
 * Brand is always first (even short, e.g. "h&m") and never truncated.
 * Size added only if numeric (39, 42...); "M"/"L" would add noise.
 */
export function buildQueryVariants({ brand = "", title = "", size = "" }) {
    const brandTokens = tokenize(brand);
    const titleTokens = [...new Set(tokenize(title))]
        .filter((w) => !brandTokens.includes(w))
        .filter((w) => w.length > 1 || /\d/.test(w));

    const counts = brandTokens.length ? [4, 3, 2] : [6, 4, 3];
    const sizeToken = /^\d{2,3}$/.test(String(size).trim()) ? String(size).trim() : "";

    const variants = [];
    if (sizeToken && !titleTokens.includes(sizeToken)) {
        variants.push([...brandTokens, ...titleTokens.slice(0, counts[0]), sizeToken]);
    }
    for (const n of counts) variants.push([...brandTokens, ...titleTokens.slice(0, n)]);

    return variants
        .map((w) => w.join(" "))
        .filter((q, i, arr) => q && arr.indexOf(q) === i);
}

export function buildResult({ cost, prices, s, query = "", criteria = [] }) {
    const n = prices.length;
    if (n === 0) return null;

    const market = median(prices);
    const resale = market * (1 - s.decote / 100);
    const profit = resale - cost;
    const pct = (profit / cost) * 100;

    let level = "red";
    if (n < s.minComparables) level = "grey";
    else if (pct > s.maxPct) level = "suspect"; // too good to be true: mixed comparables
    else if (pct >= s.green) level = "green";
    else if (pct >= s.orange) level = "orange";

    return {
        level, pct, market, resale, profit, n, cost, query, criteria,
        decote: s.decote,
        maxPct: s.maxPct,
        min: Math.min(...prices),
        max: Math.max(...prices),
    };
}

// ---------- display (Discord embed) ----------

export const LEVELS = {
    green: { emoji: "🟢", label: "Rentable", color: 0x00ff00 },
    orange: { emoji: "🟠", label: "Correct", color: 0xffa500 },
    red: { emoji: "🔴", label: "Peu rentable", color: 0xff0000 },
    grey: { emoji: "⚪", label: "Pas assez de données", color: 0x808080 },
    suspect: { emoji: "🟣", label: "Rentabilité suspecte", color: 0x9b59b6 },
};

const SYMBOLS = { EUR: "€", GBP: "£", USD: "$", PLN: "zł", CZK: "Kč" };

export function formatProfitField(p, currency = "EUR") {
    const cur = SYMBOLS[currency] ?? currency;
    const m = (v) => `${v.toFixed(2)} ${cur}`;
    const lv = LEVELS[p.level];
    const sign = p.pct >= 0 ? "+" : "";
    const query = p.query.length > 60 ? `${p.query.slice(0, 57)}...` : p.query;

    const critRaw = p.criteria?.length ? p.criteria.join(" + ") : "aucun (recherche large)";
    const crit = critRaw.length > 60 ? `${critRaw.slice(0, 57)}...` : critRaw;

    const head = p.level === "grey"
        ? `${lv.emoji} **${lv.label}**`
        : p.level === "suspect"
            ? `${lv.emoji} **${lv.label}**\n🚫 Le taux (${sign}${p.pct.toFixed(0)} %) dépasse la limite de ${p.maxPct} % : ne te fie pas à ce calcul.`
            : `${lv.emoji} **${lv.label}** · ${sign}${p.pct.toFixed(0)} %`;

    const lines = [
        `Recherche utilisée : "${query}"`,
        `Critères           : ${crit}`,
        `Comparables        : ${p.n} (min ${m(p.min)} / max ${m(p.max)})`,
        `Prix médian marché : ${m(p.market)}`,
        `Revente estimée    : ${m(p.resale)} (après décote ${p.decote} %)`,
        `Coût d'achat total : ${m(p.cost)} (prix + protection acheteur)`,
        `Bénéfice estimé    : ${m(p.profit)}`,
        `Rentabilité        : ${p.pct.toFixed(0)} %  ${lv.emoji}`,
    ].join("\n");

    return {
        name: "📊 Rentabilité",
        value:
            `${head}\n\`\`\`\n${lines}\n\`\`\`\n` +
            "⚠️ *Prix demandés, pas vendus. Vérifie l'état, le modèle exact et l'authenticité.*",
        inline: false,
    };
}

// ---------- network: queue + cache ----------

let chain = Promise.resolve();
let lastSearchAt = 0;

function throttled(fn) {
    const run = chain.then(async () => {
        const wait = lastSearchAt + MIN_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastSearchAt = Date.now();
        return fn();
    });
    chain = run.catch(() => {});
    return run;
}

const queryCache = new Map(); // query -> { at, entries:[{id,price}] }
const inflight = new Map(); // query -> Promise
const itemCache = new Map(); // item id -> Promise<result|null>

function trim(map) {
    while (map.size > MAX_CACHE) map.delete(map.keys().next().value);
}

async function searchComparables(query, ttlMs) {
    const hit = queryCache.get(query);
    if (hit && Date.now() - hit.at < ttlMs) return hit.entries;
    if (inflight.has(query)) return inflight.get(query);

    const p = throttled(async () => {
        const body = await fetchCatalogItems({
            search_text: query,
            per_page: 48,
            order: "relevance",
        });
        const entries = body.items
            .filter((i) => !i.promoted)
            .map(parseListing)
            .filter((e) => Number.isFinite(e.price));
        queryCache.set(query, { at: Date.now(), entries });
        trim(queryCache);
        return entries;
    }).finally(() => inflight.delete(query));

    inflight.set(query, p);
    return p;
}

async function compute(item, s) {
    const cost =
        item.totalPriceNumeric > 0
            ? item.totalPriceNumeric
            : item.priceNumeric + buyerFee(item.priceNumeric);
    if (!(cost > 0)) return null;

    const ref = referenceOf(item);
    const variants = buildQueryVariants({ brand: ref.brand, title: item.title, size: ref.size });
    const levels = criteriaLevels(ref);
    let best = null;

    // For each search (most specific first), apply criteria from strictest
    // (brand + size + color) to broadest. Max 4 searches, all cached.
    for (const query of variants) {
        const pool = await searchComparables(query, s.ttlMs);

        for (const crit of levels) {
            const prices = pool
                .filter((e) => e.id !== item.id && matches(e, ref, crit))
                .map((e) => e.price);

            const candidate = { prices, query, criteria: describeCriteria(crit, ref) };
            if (prices.length >= s.minComparables) {
                return buildResult({ cost, s, ...candidate });
            }
            if (!best || prices.length > best.prices.length) best = candidate;
        }
    }

    return best ? buildResult({ cost, s, ...best }) : null;
}

/**
 * Estimate an item's profitability. Never throws:
 * returns null on failure or timeout (item posted without badge).
 * Search keeps running in background and warms the cache.
 */
export async function estimateProfit(item) {
    const s = getSettings();
    if (!s.enabled) return null;

    let pending = itemCache.get(item.id);
    if (!pending) {
        pending = compute(item, s).catch((error) => {
            Logger.debug(`Profit estimate failed for ${item.id}: ${error?.message || error}`);
            return null;
        });
        itemCache.set(item.id, pending);
        trim(itemCache);
    }

    let timer;
    const timeout = new Promise((r) => {
        timer = setTimeout(() => r(null), s.timeoutMs);
    });
    try {
        return await Promise.race([pending, timeout]);
    } finally {
        clearTimeout(timer);
    }
}