// RF-MD-01, RF-MD-02.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkDocWrite } from '../src/guards/docs-guard.js';
import { DEFAULT_DOCS_WHITELIST } from '../src/guards/project.js';
import { globToRegExp, matchesAny } from '../src/guards/glob.js';

const root = path.resolve('/project');
const never = () => false;
const check = (file, whitelist = DEFAULT_DOCS_WHITELIST, exists = never) =>
  checkDocWrite({ file: path.join(root, file), root, whitelist, exists }).decision;

test('RF-MD-02: the default whitelist allows the documented locations', () => {
  for (const file of [
    'README.md',
    'CHANGELOG.md',
    'AGENTS.md',
    'web/README.md',
    'api/AGENTS.md',
    'specs/API-001-auth/spec.md',
    'specs/API-001-auth/plan.md',
    'specs/API-001-auth/tasks.md',
    'specs/API-001-auth/progress.md',
    'docs/constitution.md',
    'docs/decisions/ADR-0001-use-postgres.md',
    'docs/architecture/overview.md',
    'docs/lessons.md',
  ]) {
    assert.equal(check(file), 'allow', file);
  }
});

test('RF-MD-01: new docs outside the whitelist are blocked', () => {
  for (const file of [
    'NOTES.md',
    'docs/summary.md',
    'src/IMPLEMENTATION_PLAN.md',
    'specs/API-001-auth/notes.md',
    'docs/decisions/decision.md',
    'docs/architecture/deep/nested.md',
    'guide.mdx',
    'TODO.MD',
  ]) {
    assert.equal(check(file), 'block', file);
  }
});

test('RF-MD-01: the verdict carries the relative path', () => {
  const v = checkDocWrite({ file: path.join(root, 'docs', 'x.md'), root, whitelist: DEFAULT_DOCS_WHITELIST, exists: never });
  assert.deepEqual(v, { decision: 'block', kind: 'docBlocked', match: 'docs/x.md' });
});

test('RF-MD-01: code files, existing docs and paths outside the project are not blocked', () => {
  assert.equal(check('src/app.ts'), 'allow');
  assert.equal(check('NOTES.md', DEFAULT_DOCS_WHITELIST, () => true), 'allow');
  assert.equal(checkDocWrite({ file: path.resolve('/elsewhere/x.md'), root, whitelist: DEFAULT_DOCS_WHITELIST, exists: never }).decision, 'allow');
});

test('RF-MD-01: a project whitelist replaces the default one', () => {
  assert.equal(check('docs/guide.md', ['docs/*.md']), 'allow');
  assert.equal(check('README.md', ['docs/*.md']), 'block');
});

test('glob semantics', () => {
  assert.ok(globToRegExp('**/migrations/**').test('db/migrations/001.sql'));
  assert.ok(globToRegExp('**/migrations/**').test('migrations/001.sql'));
  assert.ok(globToRegExp('*.sql').test('a/b/c.sql'));
  assert.ok(!globToRegExp('docs/*.md').test('docs/a/b.md'));
  assert.ok(globToRegExp('tsconfig*.json').test('tsconfig.build.json'));
  assert.ok(globToRegExp('specs/**/contracts/**').test('specs/API-004/contracts/openapi.yaml'));
  assert.ok(globToRegExp('file[0-9].txt').test('file3.txt'));
  assert.ok(matchesAny('.\\docker-compose.yml', ['docker*']));
});
