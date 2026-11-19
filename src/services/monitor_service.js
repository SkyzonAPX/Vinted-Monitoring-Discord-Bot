import { fetchCatalogItems } from "../api/fetchCatalogItems.js";
import { buildQueryFromUrl } from "./query_service.js";
import Logger from "../utils/logger.js";

const MAX_SEEN = 1000;

/**
 * Poll the catalogue once per distinct channel query and call
 * onItem(rawItem, channel) for every listing that appeared since the last poll.
 *
 * - The first poll of a query is silent (it only records what already exists).
 * - Deduplication is by item id; there are no timestamps any more.
 */
export function startMonitor({ getChannels, onItem, prefetch, domain, intervalMs = 3000, concurrency = 3 }) {
    const state = new Map(); // queryKey -> { seen:Set<number>, primed:boolean, floorId:number }
    const warnedDomains = new Set();
    let consecutiveErrors = 0;
    let stopped = false;

    async function pollOne(key, group) {
        const body = await fetchCatalogItems(group.query.params);
        // Promoted listings are injected ads and can be old.
        const items = body.items.filter((i) => !i.promoted);

        let st = state.get(key);
        if (!st) {
            st = { seen: new Set(), primed: false, floorId: 0 };
            state.set(key, st);
        }

        const fresh = items.filter(
            (i) => !st.seen.has(i.id) && i.id > st.floorId
        );

        for (const i of items) st.seen.add(i.id);
        while (st.seen.size > MAX_SEEN) {
            st.seen.delete(st.seen.values().next().value);
        }

        if (!st.primed) {
            st.primed = true;
            // Anything genuinely new has a higher id than everything we saw now.
            st.floorId = items.reduce((m, i) => Math.max(m, i.id), 0);
            Logger.info(
                `Query primed with ${items.length} existing listings (silent): ${JSON.stringify(group.query.params)}`
            );
            return 0;
        }

        // Prefetch slow work (description, profit) for every new listing in parallel.
        if (prefetch) {
            for (const raw of fresh) {
                try { prefetch(raw); } catch (error) { Logger.error(`prefetch failed: ${error?.message || error}`); }
            }
        }

        // API returns newest first; notify oldest first.
        for (const raw of fresh.reverse()) {
            for (const channel of group.channels) {
                try {
                    await onItem(raw, channel);
                } catch (error) {
                    Logger.error(`onItem failed: ${error?.stack || error}`);
                }
            }
        }
        return fresh.length;
    }

    async function tick() {
        const groups = new Map();

        for (const channel of getChannels()) {
            const query = buildQueryFromUrl(channel.url, channel.keywords);
            if (!query) continue;

            if (query.domain !== domain) {
                if (!warnedDomains.has(query.domain)) {
                    warnedDomains.add(query.domain);
                    Logger.error(
                        `Channel URL uses vinted.${query.domain} but VINTED_API_DOMAIN_EXTENSION is "${domain}". These channels are skipped.`
                    );
                }
                continue;
            }

            if (!groups.has(query.key)) groups.set(query.key, { query, channels: [] });
            groups.get(query.key).channels.push(channel);
        }

        // Forget queries nobody monitors any more (re-adding re-primes silently).
        for (const key of state.keys()) if (!groups.has(key)) state.delete(key);

        const entries = [...groups.entries()];
        let failures = 0;

        for (let i = 0; i < entries.length; i += concurrency) {
            const batch = entries.slice(i, i + concurrency);
            const results = await Promise.allSettled(
                batch.map(([key, group]) => pollOne(key, group))
            );
            for (const r of results) {
                if (r.status === "rejected") {
                    failures++;
                    Logger.error(`Poll failed: ${r.reason?.message || r.reason}`);
                } else if (r.value > 0) {
                    Logger.info(`Sent ${r.value} new listing(s)`);
                }
            }
        }

        consecutiveErrors = failures > 0 && failures === entries.length ? consecutiveErrors + 1 : 0;
    }

    (async () => {
        while (!stopped) {
            const started = Date.now();
            try {
                await tick();
            } catch (error) {
                consecutiveErrors++;
                Logger.error(`Monitor tick failed: ${error?.stack || error}`);
            }
            // Back off when everything fails (rate limit, blocked, ...).
            const backoff = Math.min(60000, intervalMs * 2 ** Math.min(consecutiveErrors, 5));
            const wait = Math.max(0, (consecutiveErrors ? backoff : intervalMs) - (Date.now() - started));
            await new Promise((r) => setTimeout(r, wait));
        }
    })();

    return { stop: () => { stopped = true; } };
}