import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeCommits,
  buildChanges,
  capCommits,
  cleanBody,
  contributors,
  pagesForNewest,
  prNumberFromSubject,
  shapeCommit,
  shapePull,
} from '../lib/shape.ts';
import { parseRepo, sortTags, defaultRange, isValidRef } from '../lib/repo.ts';
import { rawCommit, rawSearchItem } from './fixtures.ts';

test('shapeCommit keeps only what the app needs', () => {
  const c = shapeCommit(rawCommit('abc1234', 'fix: thing (#12)\n\nlonger body', ['p1']));
  assert.equal(c.short, 'abc1234');
  assert.equal(c.subject, 'fix: thing (#12)');
  assert.equal(c.body, 'longer body');
  assert.equal(c.parents.length, 1);
  assert.equal(c.author?.login, 'dai-shi');
  assert.equal('files' in c, false);
});

test('shapePull reads search items and strips template noise', () => {
  const pr = shapePull(rawSearchItem(42, 'feat: add retry', ['enhancement'], 'renovate[bot]'));
  assert.equal(pr.number, 42);
  assert.deepEqual(pr.labels, ['enhancement']);
  assert.equal(pr.author?.bot, true);
  assert.equal(pr.mergedAt, '2026-08-01T00:00:00Z');
  assert.equal(pr.body, 'This changes feat: add retry.');
});

test('cleanBody truncates long bodies', () => {
  assert.equal(cleanBody('a'.repeat(50), 10), 'aaaaaaaaaa...');
});

test('prNumberFromSubject handles squash and merge styles, not issue refs', () => {
  assert.equal(prNumberFromSubject('fix(persist): x (#3555)'), 3555);
  assert.equal(prNumberFromSubject('Merge pull request #77 from a/b'), 77);
  assert.equal(prNumberFromSubject('Fix crash, closes #9'), null);
  assert.equal(prNumberFromSubject('Harden retry'), null);
});

test('merge commits claim the branch commits behind their second parent', () => {
  // m1 -> a (feature branch: f1, f2) merged as m2 -> d (direct push)
  const commits = [
    rawCommit('aaaaaaa', 'chore: start', ['base']),
    rawCommit('f1f1f1f', 'wip', ['aaaaaaa']),
    rawCommit('f2f2f2f', 'more wip', ['f1f1f1f']),
    rawCommit('m2m2m2m', 'Merge pull request #5 from x/feature\n\nAdd the thing', ['aaaaaaa', 'f2f2f2f']),
    rawCommit('ddddddd', 'Harden retry', ['m2m2m2m']),
  ].map(shapeCommit);
  const owners = attributeCommits(commits);
  assert.equal(owners.get(commits[1].sha), 5);
  assert.equal(owners.get(commits[2].sha), 5);
  assert.equal(owners.get(commits[3].sha), 5);
  assert.equal(owners.has(commits[0].sha), false);
  assert.equal(owners.has(commits[4].sha), false);

  const changes = buildChanges(commits, new Map(), new Map(), 'https://github.com/o/r');
  assert.deepEqual(changes.map((c) => c.id), ['aaaaaaa', '#5', 'ddddddd']);
  const pr = changes[1];
  assert.equal(pr.commits.length, 3);
  assert.equal(pr.title, 'Add the thing');
  assert.equal(pr.url, 'https://github.com/o/r/pull/5');
});

test('buildChanges prefers fetched PR details over the commit subject', () => {
  const commits = [rawCommit('1111111', 'fix: a (#10)', ['base'])].map(shapeCommit);
  const pulls = new Map([[10, shapePull(rawSearchItem(10, 'fix: real title', ['bug'], 'bob'))]]);
  const [c] = buildChanges(commits, pulls);
  assert.equal(c.title, 'fix: real title');
  assert.deepEqual(c.labels, ['bug']);
  assert.equal(c.author?.login, 'bob');
});

test('contributors are unique with bots last', () => {
  const commits = [
    rawCommit('1111111', 'chore: bump (#1)', ['b'], 'dependabot[bot]'),
    rawCommit('2222222', 'feat: x (#2)', ['1111111'], 'carol'),
    rawCommit('3333333', 'fix: y (#3)', ['2222222'], 'carol'),
  ].map(shapeCommit);
  const people = contributors(buildChanges(commits, new Map()));
  assert.deepEqual(people.map((p) => p.login), ['carol', 'dependabot[bot]']);
});

test('range cap keeps the newest commits and picks the right compare pages', () => {
  assert.deepEqual(capCommits([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(pagesForNewest(80, 150), [1]);
  assert.deepEqual(pagesForNewest(140, 150), [1, 2]);
  assert.deepEqual(pagesForNewest(320, 150), [2, 3, 4]);
  assert.deepEqual(pagesForNewest(400, 150), [3, 4]);
});

test('parseRepo accepts common inputs and rejects junk', () => {
  assert.deepEqual(parseRepo('pmndrs/zustand'), { owner: 'pmndrs', repo: 'zustand' });
  assert.deepEqual(parseRepo('https://github.com/axios/axios/tree/v1.x'), { owner: 'axios', repo: 'axios' });
  assert.deepEqual(parseRepo('git@github.com:sindresorhus/ky.git'), { owner: 'sindresorhus', repo: 'ky' });
  assert.equal(parseRepo('just-a-name'), null);
  assert.equal(parseRepo('../etc/passwd'), null);
  assert.equal(isValidRef('v1.2.3'), true);
  assert.equal(isValidRef('a..b'), false);
  assert.equal(isValidRef('x y'), false);
});

test('tags sort by semver so backports do not become the default head', () => {
  const sorted = sortTags([
    { name: 'v0.34.0', date: '2026-09-13', prerelease: false },
    { name: 'v1.20.0', date: '2026-08-24', prerelease: false },
    { name: 'v1.21.0-beta.1', date: '2026-09-20', prerelease: true },
    { name: 'v1.19.0', date: '2026-07-26', prerelease: false },
  ]);
  assert.deepEqual(sorted.map((t) => t.name), ['v1.21.0-beta.1', 'v1.20.0', 'v1.19.0', 'v0.34.0']);
  assert.deepEqual(defaultRange(sorted), { head: 'v1.20.0', base: 'v1.19.0' });
});
