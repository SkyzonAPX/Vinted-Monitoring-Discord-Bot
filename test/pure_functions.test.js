import { test } from "node:test";
import assert from "node:assert/strict";

import { buildQueryFromUrl, validateVintedUrl } from "../src/services/query_service.js";
import { keywordsMatch, cleanDescription } from "../src/services/description_service.js";
import {
    detectColors,
    parseSecondLine,
    parseListing,
    buildQueryVariants,
    median,
    criteriaLevels,
    matches,
    buildResult,
} from "../src/services/profit_service.js";

test("buildQueryFromUrl parses a catalog URL", () => {
    const q = buildQueryFromUrl("https://www.vinted.fr/catalog?search_text=shoes&price_to=50", "nike");
    assert.ok(q);
    assert.equal(q.domain, "fr");
    assert.equal(q.params.search_text, "shoes nike");
    assert.equal(q.params.price_to, "50");
    assert.ok(q.key.includes("fr|"));
});

test("validateVintedUrl accepts filtered catalog", () => {
    assert.equal(validateVintedUrl("https://www.vinted.fr/catalog?search_text=shoes"), true);
    assert.equal(validateVintedUrl("https://www.vinted.fr/catalog"), "must-have-query-params");
});

test("keywordsMatch is accent/case insensitive", () => {
    assert.equal(keywordsMatch("sac noir", "Sac à bandoulière", "Noir"), true);
    assert.equal(keywordsMatch("sac noir", "Sac à bandoulière", "Bleu"), false);
    assert.equal(keywordsMatch("", "anything"), true);
});

test("cleanDescription normalizes and truncates", () => {
    const out = cleanDescription("a   b\n\n\nc", 5);
    assert.ok(out.endsWith("…") || out.length <= 5);
});

test("detectColors maps variants", () => {
    assert.deepEqual(detectColors("Chaussures noires et bleu marine"), ["noir", "bleu"]);
});

test("parseSecondLine handles size and condition", () => {
    assert.deepEqual(parseSecondLine("42 · Bon état"), { size: "42", status: "Bon état" });
    assert.deepEqual(parseSecondLine("Bon état"), { size: "", status: "Bon état" });
});

test("buildQueryVariants always keeps brand first", () => {
    const v = buildQueryVariants({ brand: "Nike", title: "Air Max shoes", size: "42" });
    assert.ok(v.length > 0);
    for (const q of v) assert.ok(q.startsWith("nike"));
});

test("median works", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([]), null);
});

test("criteriaLevels requires brand when known", () => {
    const ref = { brand: "Nike", size: "42", colors: ["noir"] };
    const levels = criteriaLevels(ref);
    assert.ok(levels.every((l) => l.includes("brand")));
});

test("matches filters by criteria", () => {
    const ref = { brand: "Nike", size: "42", colors: ["noir"] };
    const entry = { brand: "Nike", size: "42", colors: ["noir"] };
    assert.equal(matches(entry, ref, ["brand", "size", "color"]), true);
    const other = { brand: "Adidas", size: "42", colors: ["noir"] };
    assert.equal(matches(other, ref, ["brand"]), false);
});

test("buildResult computes profit badge", () => {
    const s = {
        enabled: true, decote: 15, green: 30, orange: 10, minComparables: 2, maxPct: 200,
        ttlMs: 1000, timeoutMs: 1000,
    };
    const p = buildResult({ cost: 50, prices: [60, 70, 80], s, query: "q", criteria: ["brand"] });
    assert.ok(p);
    assert.ok(typeof p.pct === "number");
    assert.equal(p.n, 3);
});
