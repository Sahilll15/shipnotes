import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, clientIp } from '../server/ratelimit.ts';

const req = (headers: Record<string, string>) => new Request('http://x/api', { headers });

test('clientIp ignores the spoofable leftmost forwarded hop', () => {
  assert.equal(clientIp(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 9.9.9.9' })), '9.9.9.9');
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 8.8.8.8' })), '8.8.8.8');
  assert.equal(clientIp(req({})), 'unknown');
});

test('check blocks after the limit with a finite retry-after', () => {
  const r = req({ 'x-real-ip': '10.0.0.1' });
  let last = check(r, 'refs');
  for (let i = 0; i < 100 && last.ok; i++) last = check(r, 'refs');
  assert.equal(last.ok, false);
  assert.ok(!last.ok && Number.isFinite(last.retryAfter) && last.retryAfter > 0);
});
