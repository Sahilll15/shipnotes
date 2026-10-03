import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, clientIp, normalizeIp, tooMany } from '../server/ratelimit.ts';

const req = (headers: Record<string, string>) => new Request('http://x/api', { headers });

test('clientIp ignores the spoofable leftmost forwarded hop', () => {
  assert.equal(clientIp(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 9.9.9.9' })), '9.9.9.9');
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 8.8.8.8' })), '8.8.8.8');
  assert.equal(clientIp(req({})), 'unknown');
});

test('check blocks after the limit with a finite retry-after', async () => {
  const r = req({ 'x-real-ip': '10.0.0.1' });
  let last = await check(r, 'refs');
  for (let i = 0; i < 100 && last.ok; i++) last = await check(r, 'refs');
  assert.equal(last.ok, false);
  assert.ok(!last.ok && Number.isFinite(last.retryAfter) && last.retryAfter > 0);
});

test('IPv6 clients are grouped by /64 so rotating addresses does not reset the limit', () => {
  assert.equal(normalizeIp('2001:db8:1:2:3:4:5:6'), normalizeIp('2001:db8:1:2:ffff::1'));
  assert.equal(clientIp(req({ 'x-real-ip': '2001:db8:1:2::9' })), '2001:db8:1:2::/64');
});

test('429 bodies carry resetAt', async () => {
  const before = Date.now();
  const res = tooMany(120);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.ok(body.resetAt >= before + 120_000 && body.resetAt <= Date.now() + 120_000);
});
