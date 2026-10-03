import { Redis } from '@upstash/redis';

/** The subset of the Upstash client the limiter uses, so tests can pass a fake. */
export type RedisLike = { eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> };

export type Take = { ok: boolean; count: number; remaining: number; resetAt: number };
export type Peek = { count: number; remaining: number; resetAt: number | null };

/** Thrown when Redis is configured but a call failed. Routes that spend money must refuse. */
export class LimiterUnavailable extends Error {
  constructor(cause: unknown) {
    super('rate limiter unavailable', { cause });
  }
}

// KEYS[1] counter; ARGV limit, windowMs. The first counted hit starts the window; over the limit nothing is added.
export const TAKE_SCRIPT = `
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if c > 0 and ttl < 0 then redis.call('PEXPIRE', KEYS[1], window) ttl = window end
if c >= limit then return {0, c, ttl} end
c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], window) ttl = window end
return {1, c, ttl}`;

export const PEEK_SCRIPT = `return {tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1])}`;

/** Returns a client when the Upstash env vars are present, otherwise null (in-memory fallback). */
export function redisFromEnv(): RedisLike | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token, retry: { retries: 2, backoff: (n) => 100 * 2 ** n } });
}

async function call(redis: RedisLike, script: string, keys: string[], args: (string | number)[]) {
  try {
    const out = await redis.eval(script, keys, args);
    if (!Array.isArray(out)) throw new Error('unexpected reply');
    return out.map(Number);
  } catch (err) {
    throw new LimiterUnavailable(err);
  }
}

/** Fixed-window counters in Redis under `rl:<app>:<bucket>:<client>`. */
export function createRedisWindow(redis: RedisLike, app: string) {
  const key = (bucket: string, client: string) => `rl:${app}:${bucket}:${client}`;
  return {
    key,
    async take(bucket: string, client: string, limit: number, windowMs: number, now = Date.now()): Promise<Take> {
      const [ok, count, ttl] = await call(redis, TAKE_SCRIPT, [key(bucket, client)], [limit, windowMs]);
      return { ok: ok === 1, count, remaining: Math.max(0, limit - count), resetAt: now + Math.max(0, ttl) };
    },
    async peek(bucket: string, client: string, limit: number, now = Date.now()): Promise<Peek> {
      const [count, ttl] = await call(redis, PEEK_SCRIPT, [key(bucket, client)], []);
      return { count, remaining: Math.max(0, limit - count), resetAt: count > 0 && ttl > 0 ? now + ttl : null };
    },
  };
}

export function limiterBusy() {
  return Response.json(
    { error: 'The service is busy, try again in a minute.', code: 'limiter_unavailable' },
    { status: 503, headers: { 'retry-after': '60', 'cache-control': 'no-store' } },
  );
}
