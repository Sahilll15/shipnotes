import { createRedisWindow, LimiterUnavailable, limiterBusy, redisFromEnv } from './redis-limit.ts';

type Hits = number[];

const buckets = new Map<string, Hits>();
const MAX_KEYS = 10_000;

export type Limit = { limit: number; windowMs: number };
export type Gate = { ok: true; remaining: number } | { ok: false; retryAfter: number };

const WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000);

export const LIMITS = {
  notes: { limit: Number(process.env.RATE_LIMIT_NOTES ?? 4), windowMs: WINDOW },
  refs: { limit: Number(process.env.RATE_LIMIT_REFS ?? 20), windowMs: WINDOW },
} satisfies Record<string, Limit>;

/** Canonical key for an address: ports, zones and brackets stripped, IPv6 grouped by /64. */
export function normalizeIp(raw: string) {
  let ip = raw.trim().toLowerCase();
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  ip = ip.replace(/%.*$/, '');

  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) ip = mapped[1];

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split('.').every((o) => Number(o) <= 255) ? ip.split('.').map(Number).join('.') : 'invalid';
  }
  if (!ip.includes(':') || !/^[0-9a-f:]+$/.test(ip)) return 'invalid';

  const halves = ip.split('::');
  if (halves.length > 2) return 'invalid';
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return 'invalid';
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.some((g) => g.length === 0 || g.length > 4)) return 'invalid';
  // One subscriber usually owns a whole /64, so finer keys would let them rotate addresses.
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** Prefers x-real-ip, then the last x-forwarded-for hop: the leftmost entry is client-controlled. */
export function clientIp(req: Request) {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return normalizeIp(real);
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return normalizeIp(hops[hops.length - 1]);
  }
  return 'unknown';
}

/** In-memory fallback for local dev and tests, when the Redis env vars are not set. */
export function checkMemory(key: string, { limit, windowMs }: Limit, now = Date.now()): Gate {
  if (buckets.size > MAX_KEYS) buckets.clear();

  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    const retryAfter = Math.ceil(((hits[0] ?? now) + windowMs - now) / 1000);
    buckets.set(key, hits);
    return { ok: false as const, retryAfter };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { ok: true as const, remaining: limit - hits.length };
}

const redis = redisFromEnv();
// Local runs against the shared database set this so they never spend production's counters.
const shared = redis ? createRedisWindow(redis, process.env.RATE_LIMIT_NAMESPACE || 'shipnotes') : null;

/** Counts one hit. Throws LimiterUnavailable when Redis is configured but unreachable. */
export async function check(req: Request, name: keyof typeof LIMITS): Promise<Gate> {
  const { limit, windowMs } = LIMITS[name];
  if (!shared) return checkMemory(`${name}:${clientIp(req)}`, LIMITS[name]);
  const now = Date.now();
  const r = await shared.take(name, clientIp(req), limit, windowMs, now);
  return r.ok ? { ok: true, remaining: r.remaining } : { ok: false, retryAfter: Math.max(1, Math.ceil((r.resetAt - now) / 1000)) };
}

/** Runs the limiter for a route: a Response when the request must stop, otherwise null. */
export async function gate(req: Request, name: keyof typeof LIMITS): Promise<Response | null> {
  try {
    const g = await check(req, name);
    return g.ok ? null : tooMany(g.retryAfter);
  } catch (err) {
    if (err instanceof LimiterUnavailable) return limiterBusy();
    throw err;
  }
}

export function tooMany(retryAfter: number) {
  const minutes = Math.ceil(retryAfter / 60);
  return Response.json(
    {
      error: `Rate limit reached. This demo runs on my own API credits, so it allows a few changelogs per hour. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or run it locally with your own key.`,
      code: 'rate_limited',
      resetAt: Date.now() + retryAfter * 1000,
    },
    { status: 429, headers: { 'retry-after': String(retryAfter) } },
  );
}
