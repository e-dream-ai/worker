import dns from 'dns';

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
 * Extract the embedded IPv4 (dotted "a.b.c.d") from an IPv4-mapped IPv6 address
 * in EITHER form, or return null if not IPv4-mapped:
 *   - dotted:  ::ffff:127.0.0.1
 *   - hex:     ::ffff:7f00:1   (the same address with the last 32 bits in hex)
 * Both decode to the same IPv4, so we run the IPv4 blocklist on the result.
 */
function extractMappedIPv4(addr: string): string | null {
  // Dotted form: ::ffff:a.b.c.d (also tolerate an explicit leading 0:0:...).
  const dotted = addr.match(/:ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    return dotted[1];
  }

  // Hex form: ...:ffff:hhhh:hhhh — last two 16-bit groups hold the 32-bit IPv4.
  const hex = addr.match(/:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }

  return null;
}

function isBlockedIPv6(ip: string): boolean {
  const addr = ip.toLowerCase();

  // ::1 loopback, :: unspecified
  if (addr === '::1' || addr === '::') return true;

  // NAT64 well-known prefix 64:ff9b::/96 — embeds an IPv4 that a translator
  // would reach; the IPv4 could be internal, so block the whole prefix.
  // Match "64:ff9b::" and the "64:ff9b:0:0:0:0:..." expanded form.
  if (addr.startsWith('64:ff9b::') || addr.startsWith('64:ff9b:0:0:0:0:')) {
    return true;
  }

  // IPv4-mapped IPv6 — both dotted (::ffff:a.b.c.d) and hex (::ffff:7f00:1)
  // forms — validate the embedded IPv4 against the IPv4 blocklist.
  const mappedIPv4 = extractMappedIPv4(addr);
  if (mappedIPv4) {
    return isBlockedIPv4(mappedIPv4);
  }

  // fc00::/7 — IPv6 unique local addresses (fc.. / fd..)
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true;

  // fe80::/10 — IPv6 link-local
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
    return true;
  }

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

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (host.endsWith('.internal') || host.endsWith('.local') || host === 'localhost') {
    throw new Error(`[url-safety] Refusing to call internal host: ${host}`);
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
