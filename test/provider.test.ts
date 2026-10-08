import { test } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { GROQ_DEFAULT_MODEL, isRetryable, providers, withFallback, type Provider } from '../server/provider.ts';

const apiError = (status: number) => OpenAI.APIError.generate(status, undefined, 'boom', new Headers());
const fake = (name: Provider['name'], model: string) => ({ name, model, client: null }) as unknown as Provider;
const pick = (list: Provider[]) => list.map((p) => [p.name, p.model]);

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

test('isRetryable covers 413, 429, 5xx and network errors only', () => {
  assert.equal(isRetryable(apiError(413)), true);
  assert.equal(isRetryable(apiError(429)), true);
  assert.equal(isRetryable(apiError(500)), true);
  assert.equal(isRetryable(new OpenAI.APIConnectionError({ message: 'down' })), true);
  assert.equal(isRetryable(apiError(400)), false);
  assert.equal(isRetryable(apiError(401)), false);
  assert.equal(isRetryable(new Error('plain')), false);
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
