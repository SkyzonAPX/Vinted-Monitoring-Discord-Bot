import { chromium } from "playwright";
import ConfigurationManager from "../utils/config_manager.js";
import Logger from "../utils/logger.js";
import { extractItemInfo } from "./item_page_extractor.js";

const extension =
    ConfigurationManager.getAlgorithmSetting.vinted_api_domain_extension;

const VINTED_URL = `https://www.vinted.${extension}`;
// Since September 2026 the catalogue lives on its own host.
const API_URL = `https://api.vinted.${extension}`;

let browser = null;
let context = null;
let page = null;
let initPromise = null;
let refreshPromise = null;

async function openCatalogPage() {
    await page.goto(`${VINTED_URL}/catalog`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });
    // Give the site time to set access_token_web / Cloudflare cookies.
    await page.waitForTimeout(2000);
}

export async function initVintedBrowser() {
    if (browser && context && page) return { browser, context, page };
    if (initPromise) return initPromise;

    initPromise = (async () => {
        Logger.info("Starting Vinted Playwright browser");

        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({
            locale: "fr-FR",
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/140.0.0.0 Safari/537.36",
        });
        page = await context.newPage();

        Logger.info(`Opening Vinted: ${VINTED_URL}/catalog`);
        await openCatalogPage();
        Logger.info("Vinted page loaded");

        return { browser, context, page };
    })();

    try {
        return await initPromise;
    } catch (error) {
        // Allow a clean retry after a failed start.
        await closeVintedBrowser().catch(() => {});
        throw error;
    } finally {
        initPromise = null;
    }
}

export async function getVintedContext() {
    if (!context) await initVintedBrowser();
    return context;
}

/** Reload the catalogue page to renew the anonymous token / Cloudflare cookies. */
export async function refreshVintedSession() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        await initVintedBrowser();
        Logger.info("Refreshing Vinted session");
        await openCatalogPage();
    })();

    try {
        await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

async function buildAuthHeaders() {
    const ctx = await getVintedContext();
    const cookies = await ctx.cookies();
    const get = (name) => cookies.find((c) => c.name === name)?.value;

    const token = get("access_token_web");
    if (!token) {
        throw new Error(
            `access_token_web cookie not found. Cookies received: ${
                cookies.map((c) => c.name).join(", ") || "none"
            }`
        );
    }

    const anonId = get("anon_id");

    return {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(anonId ? { "X-Anon-Id": anonId } : {}),
    };
}

/**
 * GET on api.vinted.<ext>. `pathAndQuery` must start with "/".
 * On 401/403 the session is refreshed and the request is retried once.
 */
export async function vintedApiGet(pathAndQuery, { retry = true } = {}) {
    const ctx = await getVintedContext();
    const headers = await buildAuthHeaders();

    const response = await ctx.request.get(`${API_URL}${pathAndQuery}`, {
        headers,
        timeout: 20000,
    });

    const status = response.status();
    const bodyText = await response.text();

    if ((status === 401 || status === 403) && retry) {
        Logger.info(`Vinted API answered ${status}, refreshing session`);
        await refreshVintedSession();
        return vintedApiGet(pathAndQuery, { retry: false });
    }

    let body;
    try {
        body = JSON.parse(bodyText);
    } catch {
        body = bodyText;
    }

    if (!response.ok()) {
        throw new Error(
            `Vinted HTTP ${status} - ${pathAndQuery}\n` +
                `Response: ${
                    typeof body === "string"
                        ? body.slice(0, 300)
                        : JSON.stringify(body).slice(0, 300)
                }`
        );
    }

    return body;
}

/**
 * Open an item page in a disposable tab and read its description.
 * Images, fonts and stylesheets are blocked to load faster.
 * @returns {Promise<{description: string, source: string}>}
 */
export async function fetchItemPageInfo(itemUrl, timeoutMs = 7000) {
    const ctx = await getVintedContext();
    const tab = await ctx.newPage();
    try {
        await tab.route("**/*", (route) =>
            ["image", "media", "font", "stylesheet"].includes(route.request().resourceType())
                ? route.abort()
                : route.continue()
        );

        const response = await tab.goto(itemUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        const status = response?.status() ?? 0;
        if (status >= 400) throw new Error(`HTTP ${status} on item page`);

        return await tab.evaluate(extractItemInfo);
    } finally {
        await tab.close().catch(() => {});
    }
}

export async function closeVintedBrowser() {
    if (browser) await browser.close();
    browser = null;
    context = null;
    page = null;
    Logger.info("Vinted Playwright browser closed");
}