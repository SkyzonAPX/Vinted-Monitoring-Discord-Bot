import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ForbiddenError, NotFoundError, RateLimitError, executeWithDetailedHandling } from '../helpers/execute_helper.js';
import randomUserAgent from 'random-useragent';
import Logger from './logger.js';
import { listProxies, parseProxyLine } from './proxies.js';
import ConfigurationManager from './config_manager.js';
import fs from 'fs';

// HTTPS proxy support: https-proxy-agent is available via node_modules.
let HttpsProxyAgent = null;
try {
    ({ HttpsProxyAgent } = await import('https-proxy-agent'));
} catch {
    // HTTP proxies are ignored (SOCKS still works).
}

const proxy_settings = ConfigurationManager.getProxiesConfig
const algorithm_settings = ConfigurationManager.getAlgorithmSetting
const vinted_api_domain_extension = algorithm_settings.vinted_api_domain_extension;

// Platform mapping used to derive the user-agent platform.
const PLATFORMS = {
    'Windows': 'Windows',
    'macOS': 'Mac',
    'Linux': 'Linux',
    'Android': 'Android',
    'iOS': 'iPhone',
    'Windows Phone': 'Windows Phone'
};

/**
 * Static class for managing proxy settings and making HTTP requests with SOCKS authentication.
 */
class ProxyManager {
    static proxyConfig = null;
    static proxies = [];
    static proxiesLoaded = false;
    static currentProxyIndex = 0;

    static proxiesOnCooldown = [];
    static initPromise = null;

    /**
     * Load proxies once (subsequent init() calls are no-ops).
     * proxies.txt accepts: ip:port, ip:port:user:pass, user:pass@ip:port, with optional
     * socks5://, socks4://, http:// prefixes (see parseProxyLine).
     */
    static async init() {
        if (this.proxiesLoaded) return;
        if (!this.initPromise) {
            this.initPromise = this.loadProxies()
                .then((list) => {
                    this.proxies = list;
                    this.proxiesLoaded = true;
                })
                .finally(() => { this.initPromise = null; });
        }
        return this.initPromise;
    }

    static async loadProxies() {
        const unique = new Map();

        if (proxy_settings.use_webshare) {
            for (const p of await listProxies(proxy_settings.webshare_api_key)) {
                unique.set(`${p.ip}:${p.port}`, p);
            }
            Logger.info(`Loaded ${unique.size} proxies from Webshare.`);
            return [...unique.values()];
        }

        let content = '';
        try {
            content = fs.readFileSync('proxies.txt', 'utf8');
        } catch (error) {
            Logger.error(`Could not read proxies.txt: ${error.message}`);
        }

        const defaultScheme = process.env.PROXY_DEFAULT_SCHEME || 'socks5';
        let invalid = 0;
        let skippedHttp = 0;

        for (const line of content.split(/\r?\n/)) {
            if (!line.trim() || line.trim().startsWith('#')) continue;

            const proxy = parseProxyLine(line, defaultScheme);
            if (!proxy) { invalid++; continue; }
            if (proxy.isHttp && !HttpsProxyAgent) { skippedHttp++; continue; }

            unique.set(`${proxy.ip}:${proxy.port}`, proxy);
        }

        Logger.info(
            `Loaded ${unique.size} proxies from file` +
            (invalid ? ` (${invalid} invalid lines ignored)` : '') +
            (skippedHttp ? ` (${skippedHttp} HTTP proxies skipped: https-proxy-agent missing)` : '') +
            '.'
        );
        return [...unique.values()];
    }

    /**
     * Clears the proxy configuration.
     */
    static clearProxy() {
        this.proxyConfig = null;
    }

    /**
     * Retrieves the current proxy agent if a proxy is configured.
     * @returns {SocksProxyAgent|undefined} The proxy agent or undefined if no proxy is set.
     */
    static async getNewProxy() {
        if (!this.proxiesLoaded) {
            await this.init()
            this.proxiesLoaded = true;
        }

        if (this.proxies.length > 0) {
            this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;

            const proxy = this.proxies[this.currentProxyIndex];

            return proxy
        }
        
        Logger.error('No proxies available.');

        return undefined;
    }

    /** 
     * Get New Proxy Socks Agent
     * @param {Proxy} proxy - The proxy to get the agent for
     * @returns {SocksProxyAgent} - The proxy agent
     */
    static getProxyAgent(proxy) {
        if (!proxy) return undefined;
        if (proxy.isHttp) return HttpsProxyAgent ? new HttpsProxyAgent(proxy.getProxyString()) : undefined;
        return new SocksProxyAgent(proxy.getProxyString());
    }

    /**
     * Agent for posting to Discord, or undefined for a direct connection.
     * Defaults to always direct: Discord needs no proxy and public proxies are slow/unstable.
     * Enable with USE_PROXY_FOR_DISCORD=1; the last attempt always falls back to direct.
     */
    static async getDiscordAgent(attempt = 0, retries = 0) {
        if (process.env.USE_PROXY_FOR_DISCORD !== '1') return undefined;
        if (attempt >= retries) return undefined;
        const proxy = await this.getNewProxy();
        return proxy ? this.getProxyAgent(proxy) : undefined;
    }
    

    /** 
     * Remove invalid proxies from the list
     * @param {Proxy} proxy - The proxy to remove
     * @returns {void}
     */
    static removeProxy(proxy) {
        this.proxies = this.proxies.filter(p => p !== proxy);
    }


    static removeTemporarlyInvalidProxy(proxy, timeout = 60000) {
        this.proxiesOnCooldown.push(proxy);
        this.proxies = this.proxies.filter(p => p !== proxy);

        setTimeout(() => {
            this.proxies.push(proxy);
            this.proxiesOnCooldown = this.proxiesOnCooldown.filter(p => p !== proxy);
        }, timeout);
    }

    /**
     * Makes an HTTP GET request with specified options, using the configured proxy.
     * @param {string} url - The URL to which the request is sent.
     * @param {Object} headers - Optional headers for the request.
     * @returns {Promise} - A promise that resolves with the response body or rejects with an error.
     */
    static async makeGetRequest(url, headers = {}) {
        return await executeWithDetailedHandling(async () => {

            const proxy = await this.getNewProxy();

            const agent = this.getProxyAgent(proxy);

            if (!proxy) {
                Logger.debug('No proxy available; falling back to direct connection.');
            }

            const userAgent = randomUserAgent.getRandom();
            const platform = Object.keys(PLATFORMS).find(key => userAgent.includes(PLATFORMS[key])) || 'Windows';

            const timeout_value = 3000;

            const extension = vinted_api_domain_extension;

            const options = {
                url,
                method: 'GET',
                
                headers: {
                    'User-Agent': userAgent,
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Platform': platform,
                    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Referer': `https://vinted.${extension}/catalog`,
                    'Origin': `https://www.vinted.${extension}`,
                    'DNT': '1',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-User': '?1',
                    'Sec-Fetch-Dest': 'document',
                    'TE': 'Trailers',
                    'Pragma': 'no-cache',
                    'Priority': 'u=0, i',
                    ...headers
                },
                ...(agent ? { httpsAgent: agent, httpAgent: agent } : {}),
                responseType: 'json',
                timeout: timeout_value
            };

            try {
                Logger.debug(`Making GET request to ${url}`);
                const response = await axios(options);
                Logger.debug(`GET request to ${url} completed successfully`);
                return { response, body: response.data };
            } catch (error) {
                const code = error.response ? error.response.status : null;

                Logger.debug(`Error making GET request: ${error.message}`);

                if (code === 404) {
                    throw new NotFoundError("Resource not found.");
                } else if (code === 403) {
                    if (proxy) {
                        Logger.info(`Removing proxy ${proxy.ip}:${proxy.port} due to access forbidden error.`);
                        this.removeTemporarlyInvalidProxy(proxy);
                    }
                    throw new ForbiddenError("Access forbidden. IP: " + (error.response || ""));
                } else if (code === 429) {
                    if (proxy) {
                        Logger.info(`Removing proxy ${proxy.ip}:${proxy.port} due to rate limit error.`);
                        this.removeTemporarlyInvalidProxy(proxy, 20000);
                    }
                    throw new RateLimitError("Rate limit exceeded. IP: " + (error.response || ""));
                } else {
                    throw new Error(`Error making GET request: ${error.message}`);
                }
            }
        });
    }
}

export default ProxyManager;