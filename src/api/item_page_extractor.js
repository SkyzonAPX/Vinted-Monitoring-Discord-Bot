/**
 * Runs INSIDE an item page (page.evaluate). Must stay self-contained:
 * no outer variables, no imports.
 *
 * Sources tried in order: structured JSON-LD data, a page element,
 * then meta tags. `source` indicates which one worked.
 */
export function extractItemInfo() {
    const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
    const text = (el) => (el?.innerText || el?.textContent || "").trim();
    const meta = (n) =>
        (document.querySelector(`meta[property="${n}"]`) ||
            document.querySelector(`meta[name="${n}"]`))?.getAttribute("content") || "";

    const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => parse(s.textContent))
        .flatMap((x) => [].concat(x ?? []))
        .flatMap((x) => (x && x["@graph"] ? x["@graph"] : [x]))
        .filter(Boolean);
    const product = nodes.find((x) => [].concat(x["@type"] ?? []).includes("Product"));

    let description = String(product?.description ?? "").trim();
    let source = description ? "json-ld" : "";

    if (!description) {
        const el = document.querySelector(
            '[itemprop="description"], [data-testid="item-description"], [data-testid="description"]'
        );
        description = text(el);
        if (description) source = "dom";
    }

    if (!description) {
        description = (meta("og:description") || meta("description")).trim();
        if (description) source = "meta";
    }

    // Color (currently read only by probe_description.js)
    const LABEL = /^(couleur|color|colour|colore|farbe)\s*[:\n]*/i;
    let color = String(product?.color ?? "").trim();
    let colorSource = color ? "json-ld" : "";

    if (!color) {
        const el = document.querySelector('[data-testid="item-attributes-color"]');
        color = text(el).replace(LABEL, "").trim();
        if (color) colorSource = "dom";
    }

    if (!color) {
        const label = [...document.querySelectorAll("dt, th, div, span")].find(
            (n) => n.children.length === 0 && /^(couleur|color|colour)$/i.test((n.textContent || "").trim())
        );
        const value = text(label?.nextElementSibling);
        if (value && value.length < 40) {
            color = value;
            colorSource = "label";
        }
    }

    return { description, source, color, colorSource };
}