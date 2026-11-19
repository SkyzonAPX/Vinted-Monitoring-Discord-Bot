import { vintedApiGet } from "./vinted_browser.js";

const enc = (v) => encodeURIComponent(v).replace(/%2C/g, ",");
const encKey = (k) =>
    encodeURIComponent(k).replace(/%5B/g, "[").replace(/%5D/g, "]");

/**
 * Query the new catalogue service (api.vinted.<ext>/svc-catalogue/items).
 * Empty parameters are removed: the API answers 400 on blank values.
 *
 * @param {Object} params e.g. { search_text, price_to, "attribute_ids[brand]": "53,12" }
 * @returns {Promise<{items: Object[], pagination: Object}>}
 */
export async function fetchCatalogItems(params = {}) {
    const all = { page: 1, per_page: 48, order: "newest_first", ...params };

    const qs = Object.entries(all)
        .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
        .map(([k, v]) => `${encKey(k)}=${enc(v)}`)
        .join("&");

    const body = await vintedApiGet(`/svc-catalogue/items?${qs}`);

    if (!body || !Array.isArray(body.items)) {
        throw new Error(
            `Unexpected catalogue response: ${JSON.stringify(body).slice(0, 300)}`
        );
    }

    return body;
}