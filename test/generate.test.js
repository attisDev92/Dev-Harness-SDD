// Core generator (RF-GEN-01..08, RF-GEN-14, RF-MOD-01..05, RF-CNV-04/05/06, RF-GAT-09, RF-OBS-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { HEADER, TOOL_CONTEXT_LIMITS } from '../src/generate/core.js';
import { generateProject as generateCore } from '../src/generate/index.js';
import { neededRoles } from '../src/generate/context.js';
import { validateConfig } from '../src/config/schema.js';
import { tempDir } from './helpers.js';

const base = (over = {}) => ({
  harness_version: '0.2.0',
  install_mode: 'local',
  tools: ['claude-code'],
  language: { code: 'en', specs: 'es', docs: 'en', commits: 'en', ui: 'es' },
  topology: 'monorepo',
  components: {
    web: { path: 'apps/web', id_prefix: 'WEB', stack: 'react+vite+ts', kind: 'frontend', verify: { test: 'npm test' } },
    api: { path: 'apps/api', id_prefix: 'API', stack: 'nestjs+postgres', kind: 'backend' },
  },
  protected: { db: ['**/migrations/**'] },
  ...over,
});
const env = (over = {}) => ({ tracked: new Set(), excludePath: '.git/info/exclude', read: () => null, ...over });
const byPath = (entries) => Object.fromEntries(entries.map((e) => [e.path, e]));

test('the fixture configuration is valid', () => {
  assert.deepEqual(validateConfig(base()), []);
});

test('RF-GEN-01/02/03: shared AGENTS.md, CLAUDE import and one context per component', () => {
  const team = byPath(generateCore(base({ install_mode: 'team' }), env()).entries);
  assert.equal(team['AGENTS.md'].kind, 'block');
  assert.equal(team['CLAUDE.md'].content, '@AGENTS.md');
  assert.equal(team['apps/web/AGENTS.md'].kind, 'block');
  assert.match(team['apps/web/AGENTS.md'].content, /Implemented by: `frontend-dev`/);
  assert.match(team['apps/web/AGENTS.md'].content, /test: `npm test`/);
  assert.match(team['apps/api/AGENTS.md'].content, /not configured: ask the user before the first task/);
  assert.match(team['AGENTS.md'].content, /Before working in `apps\/web`, read `apps\/web\/AGENTS\.md`/);
  const noClaude = byPath(generateCore(base({ tools: ['codex'] }), env()).entries);
  assert.equal(noClaude['CLAUDE.md'], undefined);
  assert.equal(noClaude['CLAUDE.local.md'], undefined);
});

test('RF-GEN-04: only the roles the project needs', () => {
  const roles = (comps) => neededRoles({ components: comps }).map((r) => r.role);
  assert.deepEqual(roles({ web: { path: '.', kind: 'frontend' } }), ['spec-reviewer', 'architect', 'frontend-dev', 'qa-tester', 'reviewer', 'debugger', 'doc-writer']);
  assert.ok(!roles({ web: { path: '.', kind: 'frontend' } }).includes('backend-dev'));
  assert.ok(roles({ api: { path: 'api', kind: 'backend' } }).includes('backend-dev'));
  assert.ok(!roles({ api: { path: 'api', kind: 'backend' } }).includes('frontend-dev'));
  const writes = Object.fromEntries(neededRoles(base()).map((r) => [r.role, r.writes]));
  assert.deepEqual(writes['frontend-dev'], ['apps/web/**']);
  assert.deepEqual([writes.reviewer, writes.debugger, writes['spec-reviewer']], [[], [], []]);
});

test('RF-CNV-05: precedence order and declared convention sources', () => {
  const { entries } = generateCore(base({ conventions: { sources: ['CONTRIBUTING.md', '.editorconfig'], commits: 'custom', commits_note: 'CONTRIBUTING.md' } }), env());
  const root = byPath(entries)['AGENTS.md'].content;
  assert.match(root, /1\) `docs\/constitution\.md`; 2\) project conventions: the rest of this file and `CONTRIBUTING\.md`, `\.editorconfig`; 3\) sdd-harness skills; 4\) third-party skills/);
  // RF-CNV-06
  assert.match(root, /Commit messages: follow the project convention in `CONTRIBUTING\.md`/);
  assert.match(byPath(generateCore(base(), env()).entries)['AGENTS.md'].content, /Commit messages: Conventional Commits/);
});

test('RF-CNV-04: templates in the configured languages', () => {
  const e = byPath(generateCore(base(), env()).entries);
  assert.match(e['.harness/templates/spec.md'].content, /Requisitos funcionales \(EARS\)/);
  assert.match(e['.harness/templates/tasks.md'].content, /Hecho cuando/);
  assert.match(e['.harness/templates/constitution.md'].content, /The agent never commits/);
  assert.match(e['.harness/templates/adr.md'].content, /Discarded alternatives/);
  const es = byPath(generateCore(base({ language: { specs: 'en', docs: 'es' } }), env()).entries);
  assert.match(es['.harness/templates/constitution.md'].content, /El agente nunca hace commit/);
  assert.match(es['.harness/templates/plan.md'].content, /Test strategy/);
  assert.match(es['AGENTS.md'].content, /Reglas innegociables/);
});

test('RF-GEN-07: generated files carry a do-not-edit header', () => {
  const e = generateCore(base({ install_mode: 'team' }), env()).entries;
  for (const entry of e.filter((x) => x.kind === 'file')) {
    if (entry.path.endsWith('.json')) continue;
    const header = entry.path.endsWith('.js') ? HEADER.js : entry.path.endsWith('.md') ? HEADER.md : HEADER.hash;
    assert.ok(entry.content.includes(header), entry.path);
  }
  const guard = byPath(e)['.harness/scripts/guard.js'].content;
  assert.ok(guard.startsWith(`#!/usr/bin/env node\n${HEADER.js}\n`));
  for (const block of e.filter((x) => x.kind === 'block' && x.path.endsWith('.md') && x.path !== 'CLAUDE.md')) {
    assert.match(block.content, /^<!-- Generated by sdd-harness/, block.path);
  }
});

test('the copied guards run standalone from .harness/scripts/', (t) => {
  const dir = tempDir(t);
  const { entries } = generateCore(base(), env());
  for (const e of entries.filter((x) => x.path.startsWith('.harness/scripts/'))) {
    const file = path.join(dir, e.path);
    spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(path.dirname(file))},{recursive:true});require('fs').writeFileSync(${JSON.stringify(file)},process.argv[1])`, e.content]);
  }
  const r = spawnSync(process.execPath, [path.join(dir, '.harness/scripts/guard.js'), 'git', '--command', 'git push'], { encoding: 'utf8', env: { ...process.env, HARNESS_LANG: 'en' } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Committing is the user's job/);
});

test('RF-GAT-09: guards.json protects the harness itself', () => {
  const guards = JSON.parse(byPath(generateCore(base(), env()).entries)['.harness/guards.json'].content);
  assert.deepEqual(guards.protected.db, ['**/migrations/**']);
  assert.ok(guards.protected.harness.includes('harness.config.yaml'));
  assert.ok(guards.protected.harness.includes('.harness/**'));
  // AGENTS.md and CLAUDE.local.md only protect their block, so the agent can extend the rest.
  assert.ok(!guards.protected.harness.includes('AGENTS.md'));
  assert.ok(guards.managed_blocks.includes('AGENTS.md'));
  assert.ok(guards.managed_blocks.includes('CLAUDE.local.md'));
  assert.deepEqual(guards.retries, { in_scope: 2, protected: 0 });
});

test('RF-MOD-01/03: local mode uses local files and .git/info/exclude', () => {
  const e = byPath(generateCore(base(), env()).entries);
  assert.equal(e['CLAUDE.local.md'].content, '@AGENTS.md');
  assert.equal(e['CLAUDE.md'], undefined);
  const exclude = e['.git/info/exclude'];
  assert.equal(exclude.style, 'hash');
  const lines = exclude.content.split('\n');
  assert.deepEqual(lines.slice(0, 6), ['/harness.config.yaml', '/.harness/', '/apps/web/AGENTS.md', '/apps/api/AGENTS.md', '/AGENTS.md', '/CLAUDE.local.md']);
  for (const p of ['/.agents/skills/sdd-orchestrator/SKILL.md', '/.claude/agents/frontend-dev.md', '/.claude/commands/sdd/next.md', '/.claude/settings.local.json']) {
    assert.ok(lines.includes(p), p);
  }
  assert.equal(e['.gitignore'], undefined);
});

test('RF-MOD-02/04: local mode never touches committed files', () => {
  const tracked = new Set(['AGENTS.md', 'apps/web/AGENTS.md']);
  const { entries, notices } = generateCore(base({ tools: ['claude-code', 'codex', 'opencode'] }), env({ tracked }));
  const e = byPath(entries);
  assert.equal(e['AGENTS.md'], undefined);
  assert.equal(e['apps/web/AGENTS.md'], undefined);
  assert.equal(e['.harness/context/AGENTS.md'].kind, 'file');
  assert.equal(e['.harness/context/web.md'].kind, 'file');
  assert.equal(e['CLAUDE.local.md'].content, '@.harness/context/AGENTS.md');
  assert.match(e['.harness/context/AGENTS.md'].content, /Before working in `apps\/web`, read `\.harness\/context\/web\.md`/);
  assert.deepEqual(notices.map((n) => n.params.tool), ['codex', 'opencode']);
  assert.ok(notices.every((n) => n.code === 'toolNeedsTeam'));
  for (const entry of entries) assert.ok(!tracked.has(entry.path), entry.path);
});

test('RF-MOD-05 / RF-OBS-05: team mode commits the config but never state or logs', () => {
  const tracked = new Set(['AGENTS.md', 'CLAUDE.md']);
  const { entries, notices } = generateCore(base({ install_mode: 'team' }), env({ tracked }));
  const e = byPath(entries);
  assert.equal(e['AGENTS.md'].kind, 'block');
  assert.equal(e['CLAUDE.md'].kind, 'block');
  assert.equal(e['.harness/.gitignore'].content.split('\n').slice(1).join('\n'), 'state/\nlogs/\n');
  assert.equal(e['.git/info/exclude'], undefined);
  assert.deepEqual(notices, []);
});

test('RF-INI-10: local artifacts are excluded in either mode', () => {
  const team = byPath(generateCore(base({ install_mode: 'team', artifacts: { versioned: false } }), env()).entries);
  assert.equal(team['.git/info/exclude'].content, '/specs/\n/docs/constitution.md\n/docs/decisions/\n/docs/architecture/\n/docs/lessons.md');
  const local = byPath(generateCore(base({ artifacts: { versioned: true } }), env()).entries);
  assert.ok(!local['.git/info/exclude'].content.includes('/specs/'));
});

test('no git repository: nothing to exclude, and the user is told', () => {
  const { entries, notices } = generateCore(base(), env({ excludePath: null }));
  assert.equal(entries.some((e) => e.style === 'hash'), false);
  assert.deepEqual(notices.map((n) => n.code), ['noGitExclude']);
});

test('RF-GEN-14 / edge case 6: the context stays under every tool limit and oversize is reported', () => {
  const tools = Object.keys(TOOL_CONTEXT_LIMITS);
  const { entries, notices } = generateCore(base({ tools, install_mode: 'team' }), env());
  const own = byPath(entries)['AGENTS.md'].content.length;
  assert.ok(own < Math.min(...Object.values(TOOL_CONTEXT_LIMITS)) / 2, `own block is ${own} chars`);
  assert.deepEqual(notices, []);
  const huge = 'x'.repeat(20000);
  const big = generateCore(base({ tools, install_mode: 'team' }), env({ read: (p) => (p === 'AGENTS.md' ? huge : null) }));
  assert.deepEqual(big.notices.map((n) => n.params.tool), ['antigravity']);
});

test('single-component projects at the root get no extra component file', () => {
  const cfg = base({ topology: 'single', components: { app: { path: '.', kind: 'frontend' } } });
  const e = generateCore(cfg, env()).entries;
  assert.equal(e.filter((x) => x.path.endsWith('AGENTS.md')).length, 1);
});

test('RF-SKL-01/12: own skills follow the components, and design-system the design source', async () => {
  const { ownSkills } = await import('../src/generate/skills.js');
  const front = Object.keys(ownSkills({ components: { web: { path: '.', kind: 'frontend', stack: 'react' } }, design: { source: 'figma' } }));
  assert.ok(front.includes('design-system') && front.includes('clean-code') && front.includes('testing-strategy'));
  assert.ok(!front.includes('backend-architecture') && !front.includes('db-migrations'));
  assert.match(ownSkills({ components: { web: { path: '.', kind: 'frontend' } }, design: { source: 'figma' } })['design-system'], /fuente de verdad es Figma/);
  const back = Object.keys(ownSkills({ components: { api: { path: '.', kind: 'backend', stack: 'nestjs+prisma+postgres' } } }));
  for (const s of ['backend-architecture', 'api-design', 'secure-coding', 'db-migrations', 'docs-writer']) assert.ok(back.includes(s), s);
  assert.ok(!back.includes('design-system'));
  const { entries } = generateCore(base(), env());
  assert.match(byPath(entries)['.claude/agents/backend-dev.md'].content, /load these skills: `clean-code`, `backend-architecture`, `api-design`, `secure-coding`, `db-migrations`/);
});
