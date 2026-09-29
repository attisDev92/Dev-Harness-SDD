// Curated skills (RF-SKL-02..15) and tracker sync (RF-TRK-01..10), main path only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, run, snapshot } from './fixtures.js';
import { main } from '../src/cli/main.js';
import { treeHash, loadRegistry, ALLOWED_LICENSES } from '../src/skills/installer.js';
import { planSync, linkedTasks, updateTaskLine } from '../src/guards/tracker-sync.js';

const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');

async function cli(argv, root, extra = {}) {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, {
    stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } },
    env: { HARNESS_LANG: 'es', ...(extra.env ?? {}) }, cwd: root, readStdin: async () => '', ...extra,
  });
  return { code, stdout, stderr };
}

test('the registry pins commits, hashes and allowed licenses', () => {
  const reg = loadRegistry();
  for (const s of reg.skills) {
    assert.match(s.sha, /^[0-9a-f]{40}$/, s.name);
    assert.match(s.hash, /^[0-9a-f]{64}$/, s.name);
    assert.ok(Array.isArray(s.roles) && s.roles.length, s.name);
  }
  assert.ok(reg.skills.some((s) => !ALLOWED_LICENSES.includes(s.license)), 'at least one entry shows the license rule');
});

test('skills: verified install, license rule, hash mismatch, verify and clean removal', async (t) => {
  const root = FIXTURES.frontend(t);
  const before = snapshot(root);
  await run(['init', '--yes'], { cwd: root });
  const files = { 'SKILL.md': Buffer.from('---\nname: ui\ndescription: x\n---\nUse tokens.\n'), 'scripts/run.sh': Buffer.from('echo hi\n') };
  const registry = {
    skills: [
      { name: 'ui', repo: 'acme/skills', path: 'skills/ui', sha: 'a'.repeat(40), hash: treeHash(files), license: 'MIT', when: { kind: 'frontend' }, roles: ['frontend-dev'] },
      { name: 'closed', repo: 'acme/skills', path: 'skills/closed', sha: 'a'.repeat(40), hash: 'x', license: 'Proprietary', when: { always: true }, roles: ['reviewer'] },
      { name: 'tampered', repo: 'acme/skills', path: 'skills/t', sha: 'a'.repeat(40), hash: 'f'.repeat(64), license: 'MIT', when: { always: true }, roles: ['reviewer'] },
    ],
  };
  const fetchSkill = async () => ({ files, licenses: { LICENSE: Buffer.from('MIT License\n') } });
  const r = await cli(['skills', 'install', '--yes'], root, { registry, fetchSkill });
  assert.equal(r.code, 1, 'the hash mismatch is an error');
  assert.match(r.stdout, /Se descargarán 3 skills desde github\.com/);
  assert.match(r.stdout, /Aviso: "ui" contiene scripts \(scripts\/run\.sh\)\. El harness nunca los ejecuta\./);
  assert.match(r.stderr, /closed: licencia "Proprietary" no permitida/);
  assert.match(r.stderr, /tampered: el hash descargado no coincide/);
  assert.equal(read(root, '.agents/skills/ui/SKILL.md'), read(root, '.claude/skills/ui/SKILL.md'));
  assert.match(read(root, '.claude/skills/ui/NOTICE.harness.md'), /acme\/skills.*MIT/s);
  assert.ok(fs.existsSync(path.join(root, '.claude/skills/ui/LICENSE')));
  const lock = JSON.parse(read(root, '.harness/skills.lock'));
  assert.deepEqual(Object.keys(lock.skills), ['ui']);

  assert.equal((await cli(['skills', 'verify'], root)).code, 0);
  fs.appendFileSync(path.join(root, '.claude/skills/ui/SKILL.md'), 'edited\n');
  const bad = await cli(['skills', 'verify'], root);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /\.claude\/skills\/ui\/SKILL\.md: modificado/);
  fs.writeFileSync(path.join(root, '.claude/skills/ui/SKILL.md'), read(root, '.agents/skills/ui/SKILL.md'));

  // Local mode hides them from git; remove takes them away with everything else.
  assert.match(read(root, '.git/info/exclude'), /\/\.agents\/skills\/ui\//);
  assert.equal((await run(['remove', '--yes'], { cwd: root })).code, 0);
  assert.deepEqual(snapshot(root), before);
});

test('tracker: pure sync plan in both directions with conflicts and proposals', () => {
  const tasks = linkedTasks([
    '- [ ] T1 Login <!-- github:o/r#1 -->',
    '- [x] T2 Logout <!-- github:o/r#2 -->',
    '- [ ] T3 Reset <!-- github:o/r#3 -->',
    '- [ ] T4 New task',
    '- [ ] T5 Gone <!-- github:o/r#5 -->',
  ].join('\n'));
  const base = { T1: { title: 'Login', done: false }, T2: { title: 'Logout', done: false }, T3: { title: 'Reset', done: false }, T5: { title: 'Gone', done: false } };
  const remote = [
    { key: 'o/r#1', number: 1, title: 'T1 Login form', done: false }, // changed remotely → pull
    { key: 'o/r#2', number: 2, title: 'T2 Logout', done: false },     // changed locally → push
    { key: 'o/r#3', number: 3, title: 'T3 Reset', done: true },       // changed on both → conflict
    { key: 'o/r#9', number: 9, title: 'Export CSV', done: false },    // new in the tracker → proposal
  ];
  const tasks3 = tasks.map((t) => (t.id === 'T3' ? { ...t, title: 'Reset password' } : t));
  const plan = planSync({ tasks: tasks3, remote, base, provider: 'github' });
  assert.deepEqual(plan.pull.map((x) => [x.task.id, x.title]), [['T1', 'Login form']]);
  assert.deepEqual(plan.push.map((x) => [x.task.id, x.done]), [['T2', true]]);
  assert.deepEqual(plan.conflicts.map((x) => x.task.id), ['T3']);
  assert.deepEqual(plan.create.map((x) => x.title), ['T4 New task']);
  assert.deepEqual(plan.missing.map((x) => x.task.id), ['T5']);
  assert.deepEqual(plan.proposals.map((x) => x.title), ['Export CSV']);
  const line = updateTaskLine('- [ ] T4 New task · Component: web', 'T4', { link: 'github:o/r#10', done: true });
  assert.equal(line, '- [x] T4 New task · Component: web <!-- github:o/r#10 -->');
});

test('tracker: any tracker through the agent and its MCP (plan → user gate → apply)', async (t) => {
  const { runSdd } = await import('../src/guards/sdd.js');
  const { handleHook } = await import('../src/guards/hook.js');
  const root = FIXTURES.frontend(t);
  await run(['init', '--yes'], { cwd: root });
  fs.writeFileSync(path.join(root, 'harness.config.yaml'), read(root, 'harness.config.yaml').replace('tracker:\n  enabled: false', 'tracker:\n  enabled: true\n  provider: youtrack\n  project: SHOP'));
  assert.equal((await run(['sync', '--yes'], { cwd: root })).code, 0);
  assert.match(read(root, '.claude/commands/sdd/tracker.md'), /Sincroniza tasks\.md con youtrack \(proyecto\/tablero: SHOP\)/);
  assert.match((await cli(['tracker', 'sync'], root)).stdout, /"youtrack" se sincroniza desde tu agente con su MCP/);

  const specDir = path.join(root, 'specs', 'SW-001-login');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'tasks.md'), '- [ ] T1 Formulario · Component: shop-web\n');
  const sdd = async (argv, input) => {
    let stdout = '';
    let stderr = '';
    const code = await runSdd(argv, { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, cwd: root, env: {}, readStdin: async () => JSON.stringify(input ?? {}) });
    return { code, stdout, stderr };
  };

  // What the agent read from the tracker through its MCP.
  const plan = await sdd(['tracker', 'plan'], { 'SW-001-login': [{ key: 'SHOP-9', title: 'Exportar CSV', done: false }] });
  assert.equal(plan.code, 0, plan.stderr);
  assert.match(plan.stdout, /→ crear en el tracker: T1 Formulario\n {2}\? nueva en el tracker: SHOP-9 "Exportar CSV"/);
  assert.match(plan.stdout, /gate request tracker/);

  // RF-TRK-08: nothing is applied before the user approves.
  assert.equal((await sdd(['tracker', 'apply'], {})).code, 2);
  assert.equal((await sdd(['gate', 'request', 'tracker'])).code, 0);
  handleHook('UserPromptSubmit', { cwd: root, session_id: 's', prompt: '/sdd:approve' }, { env: {} });
  const apply = await sdd(['tracker', 'apply'], { 'SW-001-login': { links: { T1: 'SHOP-10' }, proposals: ['SHOP-9'] } });
  assert.equal(apply.code, 0, apply.stderr);
  assert.equal(read(root, 'specs/SW-001-login/tasks.md'), '- [ ] T1 Formulario · Component: shop-web <!-- youtrack:SHOP-10 -->\n- [ ] T2 Exportar CSV <!-- youtrack:SHOP-9 -->\n');

  // Next round: both sides agree → nothing to do.
  const again = await sdd(['tracker', 'plan'], { 'SW-001-login': [{ key: 'SHOP-10', title: 'T1 Formulario', done: false }, { key: 'SHOP-9', title: 'Exportar CSV', done: false }] });
  assert.match(again.stdout, /Todo está sincronizado/);
});

test('tracker: GitHub sync end to end with a fake API; errors never touch tasks.md', async (t) => {
  const root = FIXTURES.frontend(t);
  await run(['init', '--yes'], { cwd: root });
  fs.appendFileSync(path.join(root, 'harness.config.yaml'), '');
  fs.writeFileSync(path.join(root, 'harness.config.yaml'), read(root, 'harness.config.yaml').replace('tracker:\n  enabled: false', 'tracker:\n  enabled: true\n  provider: github\n  repo: acme/shop'));
  const specDir = path.join(root, 'specs', 'SW-001-login');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), '# spec\n');
  fs.writeFileSync(path.join(specDir, 'tasks.md'), '# Tareas\n\n- [ ] T1 Formulario · Component: shop-web\n- [x] T2 Estilos · Component: shop-web\n');

  const issues = [{ number: 7, title: 'Exportar CSV', state: 'open' }];
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(`${init.method} ${url.replace('https://api.github.com', '')}`);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    if (init.method === 'GET' && url.endsWith('/repos/acme/shop')) return new Response(JSON.stringify({ full_name: 'acme/shop', permissions: { push: true } }));
    if (init.method === 'GET') return new Response(JSON.stringify(issues));
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.labels, ['sdd:SW-001-login']);
      const n = issues.length + 20;
      issues.push({ number: n, title: body.title, state: 'open' });
      return new Response(JSON.stringify({ number: n }), { status: 201 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  assert.match((await cli(['tracker', 'connect'], root, { fetch })).stderr, /Falta el token/);
  const env = { GITHUB_TOKEN: 'tok' };
  assert.match((await cli(['tracker', 'connect'], root, { fetch, env })).stdout, /Conectado a acme\/shop/);
  const dry = await cli(['tracker', 'sync', '--dry-run'], root, { fetch, env });
  assert.match(dry.stdout, /→ crear en GitHub: T1 Formulario\n {2}→ crear en GitHub: T2 Estilos\n {2}\? nueva en GitHub: acme\/shop#7 "Exportar CSV"/);
  assert.ok(!calls.some((c) => c.startsWith('POST')), 'dry run writes nothing');

  const sync = await cli(['tracker', 'sync', '--yes'], root, { fetch, env });
  assert.equal(sync.code, 0, sync.stderr);
  const tasks = read(root, 'specs/SW-001-login/tasks.md');
  assert.match(tasks, /- \[ \] T1 Formulario · Component: shop-web <!-- github:acme\/shop#21 -->/);
  assert.match(tasks, /- \[x\] T2 Estilos · Component: shop-web <!-- github:acme\/shop#22 -->/);
  assert.ok(calls.includes('PATCH /repos/acme/shop/issues/22'), 'done tasks are closed');
  assert.doesNotMatch(tasks, /Exportar CSV/, 'proposals need approval (RF-TRK-06)');
  assert.equal(read(root, 'specs/SW-001-login/spec.md'), '# spec\n', 'never the spec (RF-TRK-05)');

  // RF-TRK-10: the tracker fails → tasks.md untouched.
  const before = read(root, 'specs/SW-001-login/tasks.md');
  const failing = async () => new Response('{}', { status: 401 });
  const r = await cli(['tracker', 'sync', '--yes'], root, { fetch: failing, env });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /HTTP 401.*No se modificó tasks\.md/);
  assert.equal(read(root, 'specs/SW-001-login/tasks.md'), before);
  assert.doesNotMatch(read(root, 'harness.config.yaml'), /tok/, 'the token is never stored (RF-TRK-03)');
});
