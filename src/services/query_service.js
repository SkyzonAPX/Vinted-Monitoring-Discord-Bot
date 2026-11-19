import Logger from "../utils/logger.js";

// Old web-URL filter name -> new attribute_ids[...] key
const ATTRIBUTES = {
    catalog: "catalog",
    brand_ids: "brand",
    size_ids: "size",
    status_ids: "status",
    color_ids: "color",
    material_ids: "material",
};

function collect(searchParams, name) {
    const values = [
        ...searchParams.getAll(`${name}[]`),
        ...searchParams.getAll(name),
    ];
    return values
        .flatMap((v) => String(v).split(","))
        .map((v) => v.trim())
        .filter(Boolean);
}

/**
 * Turn a Vinted web URL (the one stored on a Discord channel) into
 * parameters for the catalogue API. Filtering is done server-side because
 * listings no longer carry category / brand / size ids.
 *
 * Returns { params, key, domain } or null if the URL is invalid.
 */
export function buildQueryFromUrl(url, keywords = "") {
    try {
        const u = new URL(url);
        const domain = u.hostname.match(/vinted\.(.+)$/)?.[1] ?? null;
        const sp = u.searchParams;

        const params = {};

        // Ids carried by the path: /brand/417-louis-vuitton, /catalog/1904-bags
        const pathIds = {
            brand_ids: u.pathname.match(/^\/brand\/(\d+)/)?.[1],
            catalog: u.pathname.match(/^\/catalog\/(\d+)/)?.[1],
        };

        // Channel keywords (/start_monitoring keywords:...) plus any search_text in the URL.
        // Vinted matches these in both title and description.
        const text = [sp.get("search_text"), keywords]
            .map((v) => String(v ?? "").trim())
            .filter(Boolean)
            .join(" ");
        if (text) params.search_text = text;

        const from = sp.get("price_from");
        if (from) params.price_from = from;
        const to = sp.get("price_to");
        if (to) params.price_to = to;

        for (const [oldName, attr] of Object.entries(ATTRIBUTES)) {
            const values = [...new Set([
                ...(pathIds[oldName] ? [pathIds[oldName]] : []),
                ...collect(sp, oldName),
            ])];
            // The API wants ONE key per attribute, values comma-separated.
            if (values.length) params[`attribute_ids[${attr}]`] = values.join(",");
        }

        const sorted = Object.keys(params)
            .sort()
            .map((k) => [k, params[k]]);

        return { params, key: `${domain}|${JSON.stringify(sorted)}`, domain };
    } catch (error) {
        Logger.error(`Invalid Vinted URL "${url}": ${error.message}`);
        return null;
    }
}

/**
 * Validate a URL given to /start_monitoring.
 * Accepted: /catalog?<filters>, /catalog/<id>-<name>, /brand/<id>-<name>
 * Returns true, or a locale key describing the problem.
 */
export function validateVintedUrl(url) {
    try {
        const u = new URL(url);
        if (!/(^|\.)vinted\.[a-z.]+$/i.test(u.hostname)) {
            return "invalid-url-with-example";
        }

        const path = u.pathname.replace(/\/+$/, "");

        // Brand or category page: the id in the path is already a filter.
        if (/^\/(brand|catalog)\/\d+/.test(path)) return true;

        // Plain catalog needs at least one filter, otherwise it would watch everything.
        if (path === "/catalog") {
            return u.searchParams.toString().length > 0 ? true : "must-have-query-params";
        }

        return "invalid-url-with-example";
    } catch {
        return "invalid-url";
    }
}