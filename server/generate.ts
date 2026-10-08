import 'server-only';
import { zodTextFormat } from 'openai/helpers/zod';
import { ModelNotes, promptFor, SYSTEM_PROMPT, verifyNotes } from '../lib/notes.ts';
import type { ReleaseDoc } from '../lib/markdown.ts';
import { fetchRange, quotaSnapshot, type RangeData } from './github.ts';
import { providers, withFallback } from './provider.ts';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
// USD per token for the OpenAI model; override when switching models. Groq's free tier counts as zero.
const PRICE_IN = Number(process.env.PRICE_INPUT_PER_M ?? 0.75) / 1e6;
const PRICE_OUT = Number(process.env.PRICE_OUTPUT_PER_M ?? 4.5) / 1e6;

export type NotesResult = ReleaseDoc & {
  range: Omit<RangeData, 'changes' | 'contributors'>;
  verification: ReturnType<typeof verifyNotes>['verification'];
  usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number; ms: number };
  github: ReturnType<typeof quotaSnapshot>;
  cached?: boolean;
};

const results = new Map<string, { at: number; data: NotesResult }>();
const RESULT_TTL = 60 * 60 * 1000;

export function cachedResult(key: string) {
  const hit = results.get(key);
  return hit && Date.now() - hit.at < RESULT_TTL ? hit.data : null;
}

export async function generate(
  owner: string,
  repo: string,
  base: string,
  head: string,
  progress: (step: string) => void,
): Promise<NotesResult> {
  const range = await fetchRange(owner, repo, base, head, progress);
  const full = `${owner}/${repo}`;

  progress(`Writing notes for ${range.changes.length} changes`);
  const started = Date.now();
  const { result: response, provider } = await withFallback(providers(MODEL), ({ client, model }) =>
    client.responses.parse({
      model,
      reasoning: { effort: 'low' },
      max_output_tokens: 16_000,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: promptFor(range.changes, { repo: full, base, head }) },
      ],
      text: { format: zodTextFormat(ModelNotes, 'release_notes') },
    }),
  );
  const paid = provider.name === 'openai';
  const parsed = response.output_parsed;
  if (!parsed) throw new Error('The model returned no structured output.');

  progress('Checking every citation');
  const { bullets, verification } = verifyNotes(parsed, range.changes);
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const { changes, contributors, ...rangeMeta } = range;

  const data: NotesResult = {
    repo: full,
    base,
    head,
    headline: parsed.headline.trim() || `${head}`,
    summary: { user: parsed.summary_user.trim(), dev: parsed.summary_dev.trim() },
    bullets,
    changes: Object.fromEntries(changes.map((c) => [c.id, { ...c, body: '' }])),
    contributors,
    range: rangeMeta,
    verification,
    usage: {
      model: provider.model,
      inputTokens,
      outputTokens,
      costUsd: paid ? Number((inputTokens * PRICE_IN + outputTokens * PRICE_OUT).toFixed(5)) : 0,
      ms: Date.now() - started,
    },
    github: quotaSnapshot(),
  };
  if (results.size > 200) results.clear();
  results.set(`${full}:${base}:${head}`.toLowerCase(), { at: Date.now(), data });
  return data;
}
