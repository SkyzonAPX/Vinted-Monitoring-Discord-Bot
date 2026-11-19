const HTTP_PORTS = new Set([80, 443, 3128, 8000, 8080, 8888]);
const SCHEME_RE = /^(socks5h|socks5|socks4a|socks4|socks|https|http):\/\//i;
const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)$/i;

export class Proxy {
    constructor(ip, port, username = "", password = "", method = "socks") {
        this.ip = ip;
        this.port = port;
        this.username = username;
        this.password = password;
        this.method = method; // socks, socks4, socks5, socks5h, http, https
    }

    get isHttp() {
        return this.method === "http" || this.method === "https";
    }

    getProxyString() {
        const auth = this.username
            ? `${encodeURIComponent(this.username)}:${encodeURIComponent(this.password ?? "")}@`
            : "";
        return `${this.method}://${auth}${this.ip}:${this.port}`;
    }
}

/**
 * Parse a proxies.txt line. Accepted formats:
 *   ip:port                         (public list, no credentials)
 *   ip:port:user:pass               (original/Webshare format)
 *   user:pass@ip:port
 *   any of the above with a socks5://, socks4://, socks://, http://, https:// prefix
 *
 * Without a prefix: a line with credentials keeps "socks" (original behavior);
 * a line without credentials is "http" on common ports (80, 443, 3128, 8080, ...),
 * otherwise `defaultScheme` (socks5). Add the prefix yourself for mixed lists.
 *
 * Returns a Proxy, or null if the line is empty, commented, or invalid.
 */
export function parseProxyLine(rawLine, defaultScheme = "socks5") {
    let line = String(rawLine ?? "").trim();
    if (!line || line.startsWith("#")) return null;

    let scheme = null;
    const m = line.match(SCHEME_RE);
    if (m) {
        scheme = m[1].toLowerCase();
        line = line.slice(m[0].length);
    }

    let host, port, username = "", password = "";

    if (line.includes("@")) {
        const at = line.lastIndexOf("@");
        const cred = line.slice(0, at);
        const addr = line.slice(at + 1).split(":");
        const colon = cred.indexOf(":");
        username = colon === -1 ? cred : cred.slice(0, colon);
        password = colon === -1 ? "" : cred.slice(colon + 1);
        if (addr.length !== 2) return null;
        [host, port] = addr;
    } else {
        const parts = line.split(":");
        if (parts.length === 2) {
            [host, port] = parts;
        } else if (parts.length === 4) {
            [host, port, username, password] = parts;
        } else {
            return null;
        }
    }

    host = host.trim();
    const portNumber = Number(port);
    if (!HOST_RE.test(host) || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        return null;
    }

    if (!scheme) {
        if (username) scheme = "socks";                                   // keep original behavior
        else scheme = HTTP_PORTS.has(portNumber) ? "http" : defaultScheme;
    }

    return new Proxy(host, String(portNumber), username.trim(), password.trim(), scheme);
}

export async function listProxies( apiKey ) {
    if (!apiKey) {
        throw new Error("API key is required.")
    }

    const url = new URL('https://proxy.webshare.io/api/v2/proxy/list/')
          url.searchParams.append('mode', 'direct')
          url.searchParams.append('page_size', '9999')
   
    const req = await fetch(url.href, {
      method: "GET",
      headers: {
        Authorization: "Token " + apiKey
      }
    })
   
    const res = await req.json()

    const proxies = res.results.map(proxy => 
        new Proxy(proxy.proxy_address, proxy.port, proxy.username, proxy.password)
    )

    return proxies
}