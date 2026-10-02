import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, groupBullets, promptFor, resolveRef, verifyNotes, type ModelNotes } from '../lib/notes.ts';
import { buildChanges, shapeCommit, shapePull } from '../lib/shape.ts';
import { rawCommit, rawSearchItem } from './fixtures.ts';

const commits = [
  rawCommit('aaaaaaa', 'feat: add toggle (#101)', ['base']),
  rawCommit('bbbbbbb', 'fix: crash on empty body (#102)', ['aaaaaaa']),
  rawCommit('ccccccc', 'Harden retry', ['bbbbbbb']),
  rawCommit('ddddddd', 'chore(deps): bump mocha (#104)', ['ccccccc'], 'dependabot[bot]'),
].map(shapeCommit);
const pulls = new Map([101, 102, 104].map((n) => [n, shapePull(rawSearchItem(n, commits.find((c) => c.subject.includes(`#${n}`))!.subject.replace(/ \(#\d+\)/, '')))]));
const changes = buildChanges(commits, pulls);

const bullet = (category: ModelNotes['bullets'][number]['category'], refs: string[], text = 'Adds a thing') => ({
  category,
  user: text,
  dev: text,
  refs,
});

test('resolveRef accepts only changes that were fetched', () => {
  assert.equal(resolveRef('#101', changes), '#101');
  assert.equal(resolveRef('101', changes), '#101');
  assert.equal(resolveRef('PR #102', changes), '#102');
  assert.equal(resolveRef('ccccccc', changes), 'ccccccc');
  assert.equal(resolveRef('CCCCCCC000', changes), 'ccccccc');
  assert.equal(resolveRef('#999', changes), null);
  assert.equal(resolveRef('1234567', changes), null);
  assert.equal(resolveRef('see the PR', changes), null);
});

test('a commit sha inside a PR resolves to that PR', () => {
  assert.equal(resolveRef('aaaaaaa', changes), '#101');
});

test('verifyNotes drops invented refs and bullets with none left', () => {
  const { bullets, verification } = verifyNotes(
    {
      headline: 'x',
      summary_user: '',
      summary_dev: '',
      bullets: [
        bullet('features', ['#101', '#999']),
        bullet('fixes', ['#555'], 'Fixes a bug that does not exist'),
        bullet('fixes', ['#102', 'ccccccc'], 'Fixes crashes.'),
        bullet('internal', ['#104']),
      ],
    },
    changes,
  );
  assert.deepEqual(verification.invalidRefs, ['#999', '#555']);
  assert.equal(verification.droppedBullets, 1);
  assert.deepEqual(verification.uncovered, []);
  assert.equal(bullets.length, 3);
  assert.ok(bullets.every((b) => b.refs.every((r) => changes.some((c) => c.id === r))));
  assert.equal(bullets.find((b) => b.category === 'fixes')!.user, 'Fixes crashes');
});

test('changes the model skipped come back as fallback bullets', () => {
  const { bullets, verification } = verifyNotes(
    { headline: 'x', summary_user: '', summary_dev: '', bullets: [bullet('features', ['#101'])] },
    changes,
  );
  assert.deepEqual(verification.uncovered, ['#102', 'ccccccc', '#104']);
  const fallback = bullets.filter((b) => b.fallback);
  assert.equal(fallback.length, 3);
  assert.deepEqual(
    fallback.map((b) => [b.refs[0], b.category, b.user]),
    [
      ['ccccccc', 'improvements', 'Harden retry'],
      ['#102', 'fixes', 'Crash on empty body'],
      ['#104', 'internal', 'Bump mocha'],
    ],
  );
  const cited = new Set(bullets.flatMap((b) => b.refs));
  assert.equal(cited.size, changes.length);
});

test('duplicate citations are reported, bullets sorted by category order', () => {
  const { bullets, verification } = verifyNotes(
    {
      headline: 'x',
      summary_user: '',
      summary_dev: '',
      bullets: [bullet('internal', ['#104']), bullet('breaking', ['#101', '#101']), bullet('fixes', ['#101', '#102', 'ccccccc'])],
    },
    changes,
  );
  assert.deepEqual(verification.duplicateRefs, ['#101']);
  assert.deepEqual(bullets.map((b) => b.category), ['breaking', 'fixes', 'internal']);
  assert.deepEqual(bullets[0].refs, ['#101']);
});

test('groupBullets hides internal unless asked', () => {
  const { bullets } = verifyNotes({ headline: '', summary_user: '', summary_dev: '', bullets: [] }, changes);
  assert.equal(groupBullets(bullets, false).some((g) => g.category === 'internal'), false);
  assert.equal(groupBullets(bullets, true).some((g) => g.category === 'internal'), true);
});

test('guessCategory reads conventional commits and labels', () => {
  const g = (title: string, labels: string[] = []) => guessCategory({ title, labels, author: null });
  assert.equal(g('feat!: drop node 18'), 'breaking');
  assert.equal(g('docs: fix link'), 'docs');
  assert.equal(g('Update README', ['documentation']), 'docs');
  assert.equal(g('ci: cache deps'), 'internal');
  assert.equal(g('Something odd', ['bug']), 'fixes');
});

test('promptFor shrinks bodies to fit the budget but keeps every ID', () => {
  const text = promptFor(changes, { repo: 'o/r', base: 'v1', head: 'v2' }, 600);
  for (const c of changes) assert.ok(text.includes(`ID: ${c.id}`));
  assert.ok(text.length <= 600 || !text.includes('Body:'));
});
