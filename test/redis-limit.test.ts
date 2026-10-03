import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRedisWindow,
  LimiterUnavailable,
  limiterBusy,
  PEEK_SCRIPT,
  TAKE_SCRIPT,
  type RedisLike,
} from '../server/redis-limit.ts';

/** In-memory stand-in for the three Lua scripts, with a controllable clock for PTTL. */
function fakeRedis() {
  const data = new Map<string, { v: number; exp: number | null }>();
  const clock = { now: 0 };
  const live = (k: string) => {
    const e = data.get(k);
    if (e && e.exp !== null && e.exp <= clock.now) data.delete(k);
    return data.get(k);
  };
  const pttl = (k: string) => {
    const e = live(k);
    return !e ? -2 : e.exp === null ? -1 : e.exp - clock.now;
  };
  const calls: string[] = [];
  const redis: RedisLike = {
    async eval(script, [k], args) {
      const a = args.map(Number);
      if (script === TAKE_SCRIPT) {
        calls.push('take');
        const [limit, window] = a;
        const c = live(k)?.v ?? 0;
        if (c >= limit) return [0, c, pttl(k)];
        const next = c + 1;
        data.set(k, { v: next, exp: next === 1 ? clock.now + window : live(k)!.exp });
        return [1, next, pttl(k)];
      }
      if (script === PEEK_SCRIPT) return [live(k)?.v ?? 0, pttl(k)];
      throw new Error('unknown script');
    },
  };
  return { redis, data, clock, calls };
}

const HOUR = 3_600_000;

test('redis take allows N, refuses N+1 with resetAt from PTTL, and never counts past the limit', async () => {
  const { redis, data, clock } = fakeRedis();
  const w = createRedisWindow(redis, 'shipnotes');
  clock.now = 1000;
  const first = await w.take('notes', '1.2.3.4', 2, HOUR, clock.now);
  assert.deepEqual(first, { ok: true, count: 1, remaining: 1, resetAt: 1000 + HOUR });
  clock.now = 5000;
  assert.equal((await w.take('notes', '1.2.3.4', 2, HOUR, clock.now)).ok, true);
  const over = await w.take('notes', '1.2.3.4', 2, HOUR, clock.now);
  assert.equal(over.ok, false);
  assert.equal(over.resetAt, 1000 + HOUR, 'the window started at the first counted hit');
  await w.take('notes', '1.2.3.4', 2, HOUR, clock.now);
  assert.equal(data.get('rl:shipnotes:notes:1.2.3.4')!.v, 2);
});

test('redis peek reads count and reset time without incrementing', async () => {
  const { redis, clock } = fakeRedis();
  const w = createRedisWindow(redis, 'shipnotes');
  assert.deepEqual(await w.peek('notes', 'ip', 8, 0), { count: 0, remaining: 8, resetAt: null });
  await w.take('notes', 'ip', 8, HOUR, 0);
  clock.now = 600;
  for (let i = 0; i < 5; i++) assert.deepEqual(await w.peek('notes', 'ip', 8, 600), { count: 1, remaining: 7, resetAt: HOUR });
});

test('the window resets after it expires', async () => {
  const { redis, clock } = fakeRedis();
  const w = createRedisWindow(redis, 'shipnotes');
  await w.take('notes', 'ip', 1, HOUR, 0);
  assert.equal((await w.take('notes', 'ip', 1, HOUR, 10)).ok, false);
  clock.now = HOUR;
  assert.equal((await w.take('notes', 'ip', 1, HOUR, HOUR)).ok, true);
});

test('a failing redis surfaces as LimiterUnavailable and maps to 503', async () => {
  const broken: RedisLike = { eval: async () => Promise.reject(new Error('ECONNRESET')) };
  const w = createRedisWindow(broken, 'shipnotes');
  await assert.rejects(w.take('notes', 'ip', 8, HOUR), LimiterUnavailable);
  await assert.rejects(w.peek('notes', 'ip', 8), LimiterUnavailable);
  const res = limiterBusy();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'The service is busy, try again in a minute.');
});
