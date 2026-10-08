import OpenAI from 'openai';

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

export type Provider = { name: 'groq' | 'openai'; client: OpenAI; model: string; label: string };
type Env = Record<string, string | undefined>;

/** GROQ_API_KEY first, then GROQ_API_KEYS (comma or newline separated), trimmed and without duplicates. */
export function groqKeys(env: Env = process.env) {
  const all = [env.GROQ_API_KEY ?? '', ...(env.GROQ_API_KEYS ?? '').split(/[,\n]/)].map((k) => k.trim());
  return [...new Set(all.filter(Boolean))];
}

const groqClients = new Map<string, OpenAI>();
let openaiClient: OpenAI | null = null;
function groqClient(apiKey: string) {
  let c = groqClients.get(apiKey);
  if (!c) {
    // One SDK retry on Groq so a rate limit falls through to the next key quickly.
    c = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 1, timeout: 90_000 });
    groqClients.set(apiKey, c);
  }
  return c;
}

/** One Groq entry per key, then OpenAI. With no key at all, OpenAI alone so the SDK reports the missing key. */
export function providers(openaiModel: string, env: Env = process.env): Provider[] {
  const keys = groqKeys(env);
  const model = env.GROQ_MODEL || GROQ_DEFAULT_MODEL;
  const list: Provider[] = keys.map((key, i) => ({ name: 'groq', client: groqClient(key), model, label: `groq key ${i + 1} of ${keys.length}` }));
  if (env.OPENAI_API_KEY || !list.length) {
    openaiClient ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2, timeout: 90_000 });
    list.push({ name: 'openai', client: openaiClient, model: openaiModel, label: 'openai' });
  }
  return list;
}

/** Rate limits, oversized requests (Groq's 413 for the per-minute token budget), server errors and network failures. */
export function isRetryable(err: unknown) {
  if (!(err instanceof OpenAI.APIError) || err instanceof OpenAI.APIUserAbortError) return false;
  return err.status === undefined || err.status === 413 || err.status === 429 || err.status >= 500;
}

const HOUR = 3_600_000;
const UNIT_MS: Record<string, number> = { h: HOUR, m: 60_000, s: 1000, ms: 1 };

/** How long to rest a Groq key after this error: retry-after on 429/413 (kept between 1s and 1 day), an hour on 401/403, else 0. */
export function cooldownMs(err: unknown) {
  const e = err as { status?: number; headers?: Headers; message?: string } | null;
  if (e?.status === 401 || e?.status === 403) return HOUR;
  if (e?.status !== 429 && e?.status !== 413) return 0;
  const header = Number(e.headers?.get?.('retry-after')) * 1000;
  const wait = e.message?.match(/try again in ([\d.hms]+)/)?.[1] ?? '';
  const parsed = [...wait.matchAll(/([\d.]+)(ms|h|m|s)/g)].reduce((t, [, n, unit]) => t + Number(n) * UNIT_MS[unit], 0);
  const ms = header > 0 ? header : parsed;
  return ms > 0 ? Math.min(Math.max(ms, 1000), 86_400_000) : 60_000;
}

const cooldowns = new Map<OpenAI, { until: number; status: number }>();
const statusOf = (err: unknown) => (err as { status?: number })?.status ?? 'network';

/** Tries Groq keys in order (next key on 429, 413, 401, 403), skipping keys on cooldown, then OpenAI once if the last Groq failure is retryable. */
export async function withFallback<T>(
  list: Provider[],
  call: (p: Provider) => Promise<T>,
  now: () => number = Date.now,
): Promise<{ result: T; provider: Provider }> {
  let last: unknown;
  let groqDown = false;
  for (const p of list) {
    if (p.name === 'groq' && groqDown) continue;
    const resting = cooldowns.get(p.client);
    if (resting && resting.until > now()) {
      last = OpenAI.APIError.generate(resting.status, undefined, `${p.label} is cooling down`, new Headers());
      continue;
    }
    if (p.name === 'openai' && last !== undefined) {
      if (!isRetryable(last)) throw last;
      console.warn(`groq failed (${statusOf(last)}), falling back to openai`);
    }
    try {
      return { result: await call(p), provider: p };
    } catch (err) {
      if (p.name !== 'groq' || !(isRetryable(err) || cooldownMs(err))) throw err;
      last = err;
      const wait = cooldownMs(err);
      if (wait) cooldowns.set(p.client, { until: now() + wait, status: (err as { status: number }).status });
      // A 5xx or network error is Groq itself, not this key, so the other keys are skipped.
      else groqDown = true;
      console.warn(`${p.label} failed (${statusOf(err)})`);
    }
  }
  throw last ?? new Error('No model provider is configured');
}
