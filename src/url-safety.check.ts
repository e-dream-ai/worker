/**
 * Standalone runnable check for SSRF URL-safety logic.
 *
 * The worker repo has no test runner (the package.json `test` script just
 * errors), so rather than scaffolding a whole framework we ship this small
 * script. It exercises the adversarial IP table and the pinned-agent lookup
 * contract, and exits non-zero on any failure.
 *
 * Run:  npx tsx src/url-safety.check.ts
 *
 * All endpoint cases use IP-literal URLs so they are DNS-independent: when the
 * host is already an IP literal, assertSafeExternalUrl validates it directly
 * without a DNS lookup.
 */
import assert from 'assert';
import { assertSafeExternalUrl, createPinnedAgent } from './utils/url-safety.js';

type Case = { url: string; expect: 'BLOCK' | 'ALLOW' };

// IP-literal URLs only — DNS-independent. IPv6 literals are bracketed per RFC.
const cases: Case[] = [
  // BLOCK — IPv4 loopback / private / link-local / metadata
  { url: 'https://127.0.0.1/x', expect: 'BLOCK' },
  { url: 'https://10.0.0.1/x', expect: 'BLOCK' },
  { url: 'https://172.16.0.1/x', expect: 'BLOCK' },
  { url: 'https://192.168.1.1/x', expect: 'BLOCK' },
  { url: 'https://169.254.169.254/x', expect: 'BLOCK' },
  // BLOCK — IPv6 loopback / link-local / ULA
  { url: 'https://[::1]/x', expect: 'BLOCK' },
  { url: 'https://[fe80::1]/x', expect: 'BLOCK' },
  { url: 'https://[fc00::1]/x', expect: 'BLOCK' },
  // BLOCK — IPv4-mapped IPv6 (dotted + hex forms) of internal addresses
  { url: 'https://[::ffff:127.0.0.1]/x', expect: 'BLOCK' },
  { url: 'https://[::ffff:7f00:1]/x', expect: 'BLOCK' }, // == ::ffff:127.0.0.1
  { url: 'https://[::ffff:10.0.0.1]/x', expect: 'BLOCK' },
  // BLOCK — NAT64 well-known prefix embedding an internal IPv4
  { url: 'https://[64:ff9b::7f00:1]/x', expect: 'BLOCK' }, // 127.0.0.1 via NAT64

  // ALLOW — genuine public IPv6
  { url: 'https://[2001:db8::1]/x', expect: 'ALLOW' },
  // ALLOW — public IPv6 that merely ENDS in a ffff group (regression: must not
  // be mistaken for an IPv4-mapped address).
  { url: 'https://[2001:db8::ffff:7f00:1]/x', expect: 'ALLOW' },
  { url: 'https://[2606:4700:4700::1111]/x', expect: 'ALLOW' }, // Cloudflare DNS
  // ALLOW — IPv4-mapped IPv6 of a PUBLIC IPv4 (8.8.8.8)
  { url: 'https://[::ffff:8.8.8.8]/x', expect: 'ALLOW' },
  // ALLOW — 172.32.0.1 is OUTSIDE the 172.16.0.0/12 private range
  { url: 'https://172.32.0.1/x', expect: 'ALLOW' },
];

async function run(): Promise<void> {
  let failures = 0;

  for (const c of cases) {
    let blocked = false;
    try {
      await assertSafeExternalUrl(c.url);
    } catch {
      blocked = true;
    }
    const actual = blocked ? 'BLOCK' : 'ALLOW';
    if (actual !== c.expect) {
      failures++;
      console.error(`FAIL  ${c.url}  expected ${c.expect}, got ${actual}`);
    } else {
      console.log(`ok    ${c.expect}  ${c.url}`);
    }
  }

  // Non-https must be rejected.
  {
    let rejected = false;
    try {
      await assertSafeExternalUrl('http://example.com/x');
    } catch {
      rejected = true;
    }
    if (!rejected) {
      failures++;
      console.error('FAIL  http://example.com/x  expected reject (non-https)');
    } else {
      console.log('ok    reject non-https  http://example.com/x');
    }
  }

  // Pinned-agent lookup contract: Node calls lookup with { all: true } during
  // HTTPS connect and expects the callback to receive an ARRAY.
  {
    const agent = createPinnedAgent({ address: '93.184.216.34', family: 4 });
    const lookup = (agent.options as any).lookup as (
      h: string,
      o: any,
      cb: any
    ) => void;
    assert.strictEqual(typeof lookup, 'function', 'agent should expose a lookup fn');

    let arrErr: any = 'unset';
    let arrResult: any;
    lookup('h', { all: true }, (err: any, res: any) => {
      arrErr = err;
      arrResult = res;
    });
    try {
      assert.strictEqual(arrErr, null, 'all-mode err should be null');
      assert.deepStrictEqual(
        arrResult,
        [{ address: '93.184.216.34', family: 4 }],
        'all-mode result should be an array of {address, family}'
      );
      console.log('ok    pinned lookup all:true returns array');
    } catch (e: any) {
      failures++;
      console.error(`FAIL  pinned lookup all:true — ${e.message}`);
    }

    // Legacy positional mode still works.
    let posErr: any = 'unset';
    let posAddr: any;
    let posFam: any;
    lookup('h', { all: false }, (err: any, addr: any, fam: any) => {
      posErr = err;
      posAddr = addr;
      posFam = fam;
    });
    try {
      assert.strictEqual(posErr, null);
      assert.strictEqual(posAddr, '93.184.216.34');
      assert.strictEqual(posFam, 4);
      console.log('ok    pinned lookup positional mode returns (addr, family)');
    } catch (e: any) {
      failures++;
      console.error(`FAIL  pinned lookup positional — ${e.message}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll url-safety checks passed.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
