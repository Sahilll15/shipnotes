import { test } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { cooldownMs, GROQ_DEFAULT_MODEL, groqKeys, isRetryable, providers, withFallback, type Provider } from '../server/provider.ts';

const apiError = (status: number, message = 'boom', headers = new Headers()) => OpenAI.APIError.generate(status, undefined, message, headers);
const fake = (name: Provider['name'], model: string) => ({ name, model, label: name, client: {} }) as unknown as Provider;
const pick = (list: Provider[]) => list.map((p) => [p.name, p.model]);
const quiet = () => {};
console.warn = quiet;

test('providers puts Groq first, then OpenAI with its own model', () => {
  assert.deepEqual(pick(providers('gpt-5.4-mini', { GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o' })), [
    ['groq', GROQ_DEFAULT_MODEL],
    ['openai', 'gpt-5.4-mini'],
  ]);
  assert.deepEqual(pick(providers('gpt-5.4-mini', { GROQ_API_KEY: 'g', GROQ_MODEL: 'openai/gpt-oss-20b' })), [
    ['groq', 'openai/gpt-oss-20b'],
  ]);
  assert.deepEqual(pick(providers('gpt-5.4-mini', { OPENAI_API_KEY: 'o' })), [['openai', 'gpt-5.4-mini']]);
});

test('groqKeys merges GROQ_API_KEY and GROQ_API_KEYS in order without duplicates', () => {
  assert.deepEqual(groqKeys({ GROQ_API_KEY: 'b', GROQ_API_KEYS: ' a, b\nc,,\n' }), ['b', 'a', 'c']);
  assert.deepEqual(groqKeys({ GROQ_API_KEYS: 'x\r\ny' }), ['x', 'y']);
  assert.deepEqual(groqKeys({}), []);
});

test('providers adds one Groq entry per key, each with its own client', () => {
  const list = providers('m', { GROQ_API_KEYS: 'k1,k2', OPENAI_API_KEY: 'o' });
  assert.deepEqual(list.map((p) => p.label), ['groq key 1 of 2', 'groq key 2 of 2', 'openai']);
  assert.notEqual(list[0].client, list[1].client);
  assert.equal(providers('m', { GROQ_API_KEYS: 'k1' })[0].client, list[0].client);
});

test('an empty key list means OpenAI only', () => {
  assert.deepEqual(pick(providers('m', { GROQ_API_KEYS: ' , ', OPENAI_API_KEY: 'o' })), [['openai', 'm']]);
});

test('isRetryable covers 413, 429, 5xx and network errors only', () => {
  assert.equal(isRetryable(apiError(413)), true);
  assert.equal(isRetryable(apiError(429)), true);
  assert.equal(isRetryable(apiError(500)), true);
  assert.equal(isRetryable(new OpenAI.APIConnectionError({ message: 'down' })), true);
  assert.equal(isRetryable(apiError(400)), false);
  assert.equal(isRetryable(apiError(401)), false);
  assert.equal(isRetryable(new Error('plain')), false);
});

test('cooldownMs reads retry-after, then the "try again in" text, then defaults to 60s', () => {
  assert.equal(cooldownMs(apiError(429, 'x', new Headers({ 'retry-after': '7' }))), 7000);
  assert.equal(cooldownMs(apiError(429, 'Please try again in 6m6.7s. Need more tokens?')), 366_700);
  assert.equal(cooldownMs(apiError(413, 'Please try again in 250ms')), 1000);
  assert.equal(cooldownMs(apiError(429, 'x', new Headers({ 'retry-after': '0.01' }))), 1000);
  assert.equal(cooldownMs(apiError(429, 'x', new Headers({ 'retry-after': '9999999' }))), 86_400_000);
  assert.equal(cooldownMs(apiError(429, 'Please try again in 30h0m0s')), 86_400_000);
  assert.equal(cooldownMs(apiError(429)), 60_000);
  assert.equal(cooldownMs(apiError(401)), 3_600_000);
  assert.equal(cooldownMs(apiError(403)), 3_600_000);
  assert.equal(cooldownMs(apiError(500)), 0);
  assert.equal(cooldownMs(apiError(400)), 0);
});

test('withFallback retries once on OpenAI after a retryable Groq failure', async () => {
  const calls: string[] = [];
  const out = await withFallback([fake('groq', 'g'), fake('openai', 'o')], async (p) => {
    calls.push(p.name);
    if (p.name === 'groq') throw apiError(503);
    return 'ok';
  });
  assert.deepEqual(calls, ['groq', 'openai']);
  assert.equal(out.result, 'ok');
  assert.equal(out.provider.name, 'openai');
});

test('withFallback rethrows a bad request, or any error with no second provider', async () => {
  const calls: string[] = [];
  const run = (list: Provider[], err: Error) =>
    withFallback(list, async (p) => {
      calls.push(p.name);
      throw err;
    });
  await assert.rejects(run([fake('groq', 'g'), fake('openai', 'o')], apiError(400)), { status: 400 });
  await assert.rejects(run([fake('groq', 'g')], apiError(429)), { status: 429 });
  assert.deepEqual(calls, ['groq', 'groq']);
});

test('withFallback keeps the Groq result when it succeeds', async () => {
  const out = await withFallback([fake('groq', 'g'), fake('openai', 'o')], async () => 1);
  assert.equal(out.result, 1);
  assert.equal(out.provider.name, 'groq');
});

test('withFallback moves to OpenAI when Groq rejects a request as too large (413)', async () => {
  const out = await withFallback([fake('groq', 'g'), fake('openai', 'o')], async (p) => {
    if (p.name === 'groq') throw apiError(413);
    return 'ok';
  });
  assert.equal(out.provider.name, 'openai');
});

const keyList = () => [fake('groq', 'g'), fake('groq', 'g'), fake('openai', 'o')].map((p, i) => ({ ...p, label: `k${i + 1}` }));

test('a rate-limited key is skipped for the next key, and stays skipped while cooling down', async () => {
  const list = keyList();
  let clock = 1_000;
  const now = () => clock;
  const tried: string[] = [];
  const call = async (p: Provider) => {
    tried.push(p.label);
    if (p.label === 'k1') throw apiError(429, 'x', new Headers({ 'retry-after': '30' }));
    return p.label;
  };
  assert.equal((await withFallback(list, call, now)).result, 'k2');
  assert.equal((await withFallback(list, call, now)).result, 'k2');
  assert.deepEqual(tried, ['k1', 'k2', 'k2']);
  clock += 30_001;
  await withFallback(list, call, now);
  assert.deepEqual(tried, ['k1', 'k2', 'k2', 'k1', 'k2']);
});

test('a rejected key (401) moves on to the next key', async () => {
  const list = keyList();
  const tried: string[] = [];
  const out = await withFallback(list, async (p) => {
    tried.push(p.label);
    if (p.label === 'k1') throw apiError(401);
    return p.label;
  });
  assert.equal(out.result, 'k2');
  assert.deepEqual(tried, ['k1', 'k2']);
});

test('when every key is rate limited or cooling down, OpenAI answers', async () => {
  const list = keyList();
  const tried: string[] = [];
  const call = async (p: Provider) => {
    tried.push(p.label);
    if (p.name === 'groq') throw apiError(429);
    return p.label;
  };
  assert.equal((await withFallback(list, call)).result, 'k3');
  assert.equal((await withFallback(list, call)).result, 'k3');
  assert.deepEqual(tried, ['k1', 'k2', 'k3', 'k3']);
});

test('without OpenAI, exhausted keys surface the last Groq error', async () => {
  const [k1, k2] = keyList();
  await assert.rejects(withFallback([k1, k2], async () => { throw apiError(429); }), { status: 429 });
  await assert.rejects(withFallback([k1, k2], async () => 'never'), { status: 429 });
});

test('a Groq 5xx goes straight to OpenAI without trying the other keys', async () => {
  const tried: string[] = [];
  const out = await withFallback(keyList(), async (p) => {
    tried.push(p.label);
    if (p.name === 'groq') throw apiError(503);
    return p.label;
  });
  assert.equal(out.result, 'k3');
  assert.deepEqual(tried, ['k1', 'k3']);
});
