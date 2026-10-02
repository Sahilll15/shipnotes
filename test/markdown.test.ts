import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, renderInline, toMarkdown, type ReleaseDoc } from '../lib/markdown.ts';
import { verifyNotes } from '../lib/notes.ts';
import { buildChanges, contributors, shapeCommit, shapePull } from '../lib/shape.ts';
import { rawCommit, rawSearchItem } from './fixtures.ts';

const commits = [
  rawCommit('aaaaaaa', 'feat: add toggle (#101)', ['base'], 'alice'),
  rawCommit('ccccccc', 'Harden retry', ['aaaaaaa'], 'bob'),
  rawCommit('ddddddd', 'chore: bump (#104)', ['ccccccc'], 'dependabot[bot]'),
].map(shapeCommit);
const pulls = new Map([
  [101, shapePull(rawSearchItem(101, 'feat: add toggle', [], 'alice'))],
  [104, shapePull(rawSearchItem(104, 'chore: bump', [], 'dependabot[bot]'))],
]);
const changes = buildChanges(commits, pulls);
const { bullets } = verifyNotes(
  {
    headline: 'Toggles and retries',
    summary_user: 'Adds toggles.',
    summary_dev: 'Adds a `Toggle` export.',
    bullets: [
      { category: 'features', user: 'Adds a toggle', dev: 'Adds `<Toggle />`', refs: ['#101'] },
      { category: 'improvements', user: 'Retries are safer', dev: 'Hardens `retry`', refs: ['ccccccc'] },
      { category: 'internal', user: 'Bumps deps', dev: 'Bumps deps', refs: ['#104'] },
    ],
  },
  changes,
);
const doc: ReleaseDoc = {
  repo: 'o/r',
  base: 'v1.0.0',
  head: 'v1.1.0',
  headline: 'Toggles and retries',
  summary: { user: 'Adds toggles.', dev: 'Adds a `Toggle` export.' },
  bullets,
  changes: Object.fromEntries(changes.map((c) => [c.id, c])),
  contributors: contributors(changes),
};

test('toMarkdown follows the GitHub release format', () => {
  const md = toMarkdown(doc, 'user');
  assert.match(md, /^## Toggles and retries\n\nAdds toggles\.\n/);
  assert.match(md, /### Features\n\n- Adds a toggle by @alice in https:\/\/github\.com\/o\/r\/pull\/101/);
  assert.match(md, /- Retries are safer by @bob in c{7}0{33}/);
  assert.match(md, /### Contributors\n\n@alice, @bob\n/);
  assert.match(md, /\*\*Full Changelog\*\*: https:\/\/github\.com\/o\/r\/compare\/v1\.0\.0\.\.\.v1\.1\.0$/);
  assert.doesNotMatch(md, /### Internal/);
  assert.doesNotMatch(md, /dependabot/);
});

test('toMarkdown switches tone and can include internal', () => {
  const md = toMarkdown(doc, 'dev', true);
  assert.match(md, /Adds a `Toggle` export\./);
  assert.match(md, /- Adds `<Toggle \/>` by @alice/);
  assert.match(md, /### Internal\n\n- Bumps deps by @dependabot\[bot\]/);
});

test('markdownToHtml renders headings, lists, links and code', () => {
  const html = markdownToHtml(toMarkdown(doc, 'dev'));
  assert.match(html, /<h2>Toggles and retries<\/h2>/);
  assert.match(html, /<h3>Features<\/h3>\n<ul>\n<li>Adds <code>&lt;Toggle \/&gt;<\/code> by <a href="https:\/\/github.com\/alice">@alice<\/a> in <a href="https:\/\/github.com\/o\/r\/pull\/101">#101<\/a><\/li>/);
  assert.match(html, /<code>ccccccc<\/code>/);
  assert.match(html, /<p><strong>Full Changelog<\/strong>: <a href="https:\/\/github.com\/o\/r\/compare\/v1.0.0...v1.1.0">v1.0.0...v1.1.0<\/a><\/p>/);
  assert.equal((html.match(/<ul>/g) ?? []).length, (html.match(/<\/ul>/g) ?? []).length);
});

test('markdownToHtml escapes anything a PR author could inject', () => {
  const html = markdownToHtml('- <img src=x onerror=alert(1)> [x](javascript:alert(1)) "q"');
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(renderInline('`<b>`'), '<code>&lt;b&gt;</code>');
});
