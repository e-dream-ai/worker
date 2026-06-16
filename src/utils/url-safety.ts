import dns from 'dns';
import net from 'net';
import https from 'https';

/**
 * SSRF guard for user-controlled outbound URLs.
 *
 * Adapters in this repo make authenticated, server-side requests to a
 * user-supplied endpoint URL. Without validation a user could point us at
 * internal infrastructure (cloud metadata, RFC1918 ranges, loopback, etc.).
 *
 * The system supports arbitrary public custom endpoints, so we cannot use a
 * hard allowlist. Instead we block internal targets: require https, parse the
 * URL, DNS-resolve the host, and reject any resolved address that is loopback,
 * private (RFC1918), link-local (incl. cloud metadata 169.254.169.254), IPv6
 * ULA/loopback/unspecified, or hostnames ending in .internal / .local.
 */

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    // Not a parseable IPv4 — treat as blocked to be safe.
    return true;
  }
  const [a, b] = parts;

  // 0.0.0.0/8 (incl. 0.0.0.0 unspecified)
  if (a === 0) return true;
  // 10.0.0.0/8 (RFC1918)
  if (a === 10) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local, incl. 169.254.169.254 metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (RFC1918)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (RFC1918)
  if (a === 192 && b === 168) return true;

  return false;
}

/**
 * Expands an IPv6 address to its full 8-group, 4-hex-digit form (lowercase).
 * Handles "::" compression and a trailing dotted-quad (IPv4-mapped) suffix,
 * and strips an optional zone id (e.g. fe80::1%eth0). Returns null if the
 * address cannot be parsed as IPv6.
 *
 * Expanding first lets us classify ranges by exact group values rather than
 * by fragile string-suffix matching — a legit public address ending in a
 * "ffff" group is no longer mistaken for an IPv4-mapped address.
 */
function expandIPv6(ip: string): string[] | null {
  let work = ip.toLowerCase().trim();

  // Strip zone id (e.g. fe80::1%eth0) — not relevant to the address itself.
  const zoneIdx = work.indexOf('%');
  if (zoneIdx !== -1) {
    work = work.slice(0, zoneIdx);
  }

  if (work.length === 0) return null;

  // A trailing dotted-quad (e.g. ::ffff:127.0.0.1) is converted to two hex
  // groups so the whole address can be treated uniformly as 8 16-bit groups.
  const dottedMatch = work.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMatch) {
    const octets = dottedMatch[1].split('.').map((p) => Number(p));
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
      return null;
    }
    const [o1, o2, o3, o4] = octets;
    const g1 = ((o1 << 8) | o2).toString(16);
    const g2 = ((o3 << 8) | o4).toString(16);
    work = work.slice(0, dottedMatch.index) + `${g1}:${g2}`;
  }

  // Split on the "::" compression marker (at most one allowed).
  const halves = work.split('::');
  if (halves.length > 2) return null;

  const head = halves[0].length ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1].length ? halves[1].split(':') : [];

  let groups: string[];
  if (halves.length === 2) {
    // "::" present — fill the gap with enough zero groups to reach 8.
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }

  if (groups.length !== 8) return null;

  // Validate and normalize each group to 4 hex digits.
  const normalized: string[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    normalized.push(g.padStart(4, '0'));
  }
  return normalized;
}

/**
 * Returns true if the given IPv6 string is loopback, unspecified, unique-local
 * (fc00::/7), link-local (fe80::/10), an IPv4-mapped IPv6 address (::ffff:0:0/96)
 * whose embedded IPv4 is blocked, or a NAT64 well-known/local-use prefix.
 *
 * Both the dotted form (::ffff:127.0.0.1) and the hex form (::ffff:7f00:1) of
 * IPv4-mapped addresses are handled by expanding to canonical groups first, so
 * the IPv4-mapped check triggers ONLY for the true ::ffff:0:0/96 prefix — not
 * for any public address that merely ends in a "ffff" group.
 */
function isBlockedIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);
  if (groups === null) {
    // Unparseable IPv6 — be conservative and block.
    return true;
  }

  const numeric = groups.map((g) => parseInt(g, 16));

  const isAllZero = (from: number, to: number): boolean => {
    for (let i = from; i <= to; i++) {
      if (numeric[i] !== 0) return false;
    }
    return true;
  };

  // ::1 loopback
  if (isAllZero(0, 6) && numeric[7] === 1) return true;
  // :: unspecified
  if (isAllZero(0, 7)) return true;

  // IPv4-mapped IPv6 ::ffff:0:0/96 — groups 0-4 are zero, group 5 is 0xffff.
  // The embedded IPv4 lives in the low 32 bits (groups 6 and 7). This covers
  // BOTH ::ffff:127.0.0.1 and the equivalent hex form ::ffff:7f00:1.
  if (isAllZero(0, 4) && numeric[5] === 0xffff) {
    const a = numeric[6] >> 8;
    const b = numeric[6] & 0xff;
    const c = numeric[7] >> 8;
    const d = numeric[7] & 0xff;
    return isBlockedIPv4(`${a}.${b}.${c}.${d}`);
  }

  // NAT64 well-known prefix 64:ff9b::/96 — an attacker could embed a private
  // IPv4 in the low 32 bits and have a NAT64 gateway translate it internally.
  if (numeric[0] === 0x64 && numeric[1] === 0xff9b && isAllZero(2, 5)) {
    return true;
  }

  // NAT64 local-use prefix 64:ff9b:1::/48 (RFC 8215).
  if (numeric[0] === 0x64 && numeric[1] === 0xff9b && numeric[2] === 1) {
    return true;
  }

  // Unique-local fc00::/7 — first group in 0xfc00..0xfdff.
  if (numeric[0] >= 0xfc00 && numeric[0] <= 0xfdff) return true;

  // Link-local fe80::/10 — first group in 0xfe80..0xfebf.
  if (numeric[0] >= 0xfe80 && numeric[0] <= 0xfebf) return true;

  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
}

/** A DNS-resolved, SSRF-validated address. */
export interface SafeAddress {
  address: string;
  family: number;
}

/**
 * Build an https.Agent that pins outbound connections to the already-validated
 * IP, closing the DNS-rebinding TOCTOU window (validate-then-reconnect). Node
 * merges Agent options into the TLS connect, so SNI and the Host header still
 * use the hostname — only the resolved IP is forced (we never set servername
 * to the IP).
 *
 * Node invokes the Agent `lookup` with `options.all === true` during HTTPS
 * connect and then expects the callback to receive an ARRAY of
 * `{ address, family }`. We support both that array mode and the legacy
 * positional `(err, address, family)` mode so the agent works regardless of
 * how the lookup is invoked.
 */
export function createPinnedAgent(safe: SafeAddress): https.Agent {
  return new https.Agent({
    lookup: (_hostname: string, options: any, callback: any) => {
      if (options && options.all) callback(null, [{ address: safe.address, family: safe.family }]);
      else callback(null, safe.address, safe.family);
    },
  });
}

/**
 * Throws if `rawUrl` is unsafe to call from the server (SSRF risk).
 *
 * On success, returns the FIRST validated address the host resolved to. Callers
 * can pin this address into the connection (e.g. a custom https.Agent `lookup`)
 * to close the DNS-rebinding TOCTOU gap: validate-here, then connect-elsewhere
 * because axios would otherwise re-resolve the host at request time.
 */
export async function assertSafeExternalUrl(rawUrl: string): Promise<SafeAddress> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('[url-safety] URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`[url-safety] Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`[url-safety] Only https URLs are allowed, got: ${parsed.protocol}`);
  }

  // URL.hostname keeps the surrounding brackets for IPv6 literals
  // (e.g. "[::1]"). Strip them so net.isIP and the blocklist see the bare IP.
  const host = parsed.hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[/, '')
    .replace(/\]$/, '');

  if (host.endsWith('.internal') || host.endsWith('.local') || host === 'localhost') {
    throw new Error(`[url-safety] Refusing to call internal host: ${host}`);
  }

  // If the host is already an IP literal, validate it directly — no DNS needed
  // (DNS-resolving a literal is pointless and can wrongly reject valid public
  // IPv6 literal endpoints).
  const literalFamily = net.isIP(host);
  if (literalFamily !== 0) {
    if (isBlockedAddress(host, literalFamily)) {
      throw new Error(`[url-safety] Refusing to call internal/private address ${host}`);
    }
    return { address: host, family: literalFamily };
  }

  // Resolve all addresses the host maps to and reject if any is internal.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch (err: any) {
    throw new Error(`[url-safety] Could not resolve host ${host}: ${err?.message || err}`);
  }

  if (!addresses.length) {
    throw new Error(`[url-safety] Host ${host} did not resolve to any address`);
  }

  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      throw new Error(`[url-safety] Refusing to call internal/private address ${address} (host ${host})`);
    }
  }

  // All resolved addresses are safe. Return the first so the caller can pin it.
  return { address: addresses[0].address, family: addresses[0].family };
}
