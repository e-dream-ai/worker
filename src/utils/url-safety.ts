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

function isBlockedIPv6(ip: string): boolean {
  const addr = ip.toLowerCase();

  // ::1 loopback, :: unspecified
  if (addr === '::1' || addr === '::') return true;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — validate the embedded IPv4
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isBlockedIPv4(mapped[1]);
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

/**
 * Throws if `rawUrl` is unsafe to call from the server (SSRF risk).
 * Resolves and returns nothing on success.
 */
export async function assertSafeExternalUrl(rawUrl: string): Promise<void> {
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
}
