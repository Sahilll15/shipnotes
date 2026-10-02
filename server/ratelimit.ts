type Hits = number[];

const buckets = new Map<string, Hits>();
const MAX_KEYS = 10_000;

export type Limit = { limit: number; windowMs: number };

const WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000);

export const LIMITS = {
  notes: { limit: Number(process.env.RATE_LIMIT_NOTES ?? 4), windowMs: WINDOW },
  refs: { limit: Number(process.env.RATE_LIMIT_REFS ?? 20), windowMs: WINDOW },
} satisfies Record<string, Limit>;

/** Prefers x-real-ip, then the last x-forwarded-for hop: the leftmost entry is client-controlled. */
export function clientIp(req: Request) {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return 'unknown';
}

export function check(req: Request, name: keyof typeof LIMITS) {
  const { limit, windowMs } = LIMITS[name];
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();

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

export function tooMany(retryAfter: number) {
  const minutes = Math.ceil(retryAfter / 60);
  return Response.json(
    {
      error: `Rate limit reached. This demo runs on my own API credits, so it allows a few changelogs per hour. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or run it locally with your own key.`,
      code: 'rate_limited',
    },
    { status: 429, headers: { 'retry-after': String(retryAfter) } },
  );
}
