import OpenAI from 'openai';

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

export type Provider = { name: 'groq' | 'openai'; client: OpenAI; model: string };
type Env = Record<string, string | undefined>;

const clients = new Map<string, OpenAI>();
function clientFor(name: Provider['name'], env: Env) {
  let c = clients.get(name);
  if (!c) {
    // One SDK retry on Groq so a rate limit falls through to OpenAI quickly.
    c =
      name === 'groq'
        ? new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: GROQ_BASE_URL, maxRetries: 1, timeout: 90_000 })
        : new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2, timeout: 90_000 });
    clients.set(name, c);
  }
  return c;
}

/** Groq first when GROQ_API_KEY is set, then OpenAI. With neither key, OpenAI alone so the SDK reports the missing key. */
export function providers(openaiModel: string, env: Env = process.env): Provider[] {
  const list: Provider[] = [];
  if (env.GROQ_API_KEY) list.push({ name: 'groq', client: clientFor('groq', env), model: env.GROQ_MODEL || GROQ_DEFAULT_MODEL });
  if (env.OPENAI_API_KEY || !list.length) list.push({ name: 'openai', client: clientFor('openai', env), model: openaiModel });
  return list;
}

/** Rate limits, oversized requests (Groq's 413 for the per-minute token budget), server errors and network failures. */
export function isRetryable(err: unknown) {
  if (!(err instanceof OpenAI.APIError) || err instanceof OpenAI.APIUserAbortError) return false;
  return err.status === undefined || err.status === 413 || err.status === 429 || err.status >= 500;
}

/** Runs `call` on the first provider and retries once on the next one when the failure is retryable. */
export async function withFallback<T>(list: Provider[], call: (p: Provider) => Promise<T>): Promise<{ result: T; provider: Provider }> {
  const [first, second] = list;
  try {
    return { result: await call(first), provider: first };
  } catch (err) {
    if (!second || !isRetryable(err)) throw err;
    console.warn(`${first.name} failed (${(err as { status?: number }).status ?? 'network'}), falling back to ${second.name}`);
    return { result: await call(second), provider: second };
  }
}
