// sdd-harness doctor (RF-DOC-01..06, RF-ADP-03/04 base, edge cases 23 and 25).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../../guards/args.js';
import { CONFIG_FILE, findProjectRoot, loadGuardSettings } from '../../guards/project.js';
import { listSpecs, specRoots, specDependencies, resolveSpecRef } from '../../guards/tasks.js';
import { listSnapshots, checkSnapshot } from '../../guards/contracts.js';
import { requiredSkills, readLock as readSkillsLock, verifySkills, ALLOWED_LICENSES } from '../../skills/installer.js';
import { loadConfigFile } from '../../config/load.js';
import { findBlock } from '../../engine/blocks.js';
import { readManifest } from '../../engine/manifest.js';
import { getConfig, gitTopLevel, trackedFiles } from '../../engine/git.js';
import { hashText, toLf } from '../../engine/text.js';
import { compareVersions, makeReader } from './common.js';

export const RULES = ['commits', 'deps', 'protected', 'docs', 'verify', 'lanes'];

/** Enforcement each tool can reach once its adapter exists (README table). */
export const TOOL_PROFILE = {
  'claude-code': { level: 'strong', bin: 'claude', adapter: 'v0.3', invoke: (c) => `/sdd:${c}` },
  opencode: { level: 'medium-strong', bin: 'opencode', adapter: 'v0.5', invoke: (c) => `/sdd-${c}` },
  codex: { level: 'medium', bin: 'codex', adapter: 'v0.5', invoke: (c) => `$sdd-${c}` },
  antigravity: { level: 'weak', bin: 'antigravity', adapter: 'v0.6', invoke: (c) => `/sdd-${c}` },
};
const LEVEL_LABEL = {
  en: { strong: 'strong', 'medium-strong': 'medium-strong', medium: 'medium', weak: 'weak', none: 'instruction only' },
  es: { strong: 'fuerte', 'medium-strong': 'medio-fuerte', medium: 'medio', weak: 'débil', none: 'solo instrucción' },
};
const FLOW = ['status', 'spec', 'next', 'docs', 'review', 'validate', 'commit'];

function onPath(bin, env) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? String(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').concat(['']) : [''];
  return dirs.some((d) => exts.some((e) => existsSync(path.join(d, bin + e.toLowerCase())) || existsSync(path.join(d, bin + e))));
}

/**
 * Current enforcement of each rule for `tool`, from what the manifest says
 * was generated. Adapters register entries with `enforces: [rule…]`.
 */
function enforcementOf(tool, manifest, intact) {
  const rules = {};
  for (const rule of RULES) {
    const wired = (manifest?.entries ?? []).some((e) => e.tool === tool && e.enforces?.includes(rule) && intact(e));
    rules[rule] = wired ? 'deterministic' : 'instruction';
  }
  const wiredCount = Object.values(rules).filter((r) => r === 'deterministic').length;
  return { rules, level: wiredCount === 0 ? 'none' : TOOL_PROFILE[tool]?.level ?? 'none' };
}

export function runChecks(root, { version, env = process.env }) {
  const checks = [];
  const add = (status, id, message, extra = {}) => checks.push({ status, id, message, ...extra });
  const loaded = loadConfigFile(path.join(root, CONFIG_FILE));
  const config = loaded.config ?? {};
  add(loaded.ok ? 'ok' : 'error', 'config', loaded.ok ? ['configValid'] : ['configInvalid', loaded.issues.length], loaded.ok ? {} : { action: ['configAction'] });

  if (config.harness_version) {
    const cmp = compareVersions(config.harness_version, version);
    if (cmp > 0) add('warn', 'version', ['projectNewer', config.harness_version, version], { action: ['projectNewerAction'] });
    else if (cmp < 0) add('warn', 'version', ['versionMismatch', config.harness_version, version], { action: ['versionAction'] });
  }

  const { status, manifest } = readManifest(root);
  if (status !== 'ok') add('error', 'manifest', ['manifestBad', status], { action: ['manifestAction'] });
  else add('ok', 'manifest', ['manifestOk', manifest.entries.length]);

  const read = makeReader(root);
  const local = (config.install_mode ?? 'local') === 'local';
  const inRepo = gitTopLevel(root) !== null;
  const tracked = inRepo ? trackedFiles(root) : new Set();
  const broken = new Set();
  for (const e of manifest?.entries ?? []) {
    if (e.kind === 'json') {
      // The hooks of a tool only count while they are really in its settings.
      const parsed = (() => { try { return JSON.parse(read(e.path) ?? 'null'); } catch { return null; } })();
      const present = parsed && Object.entries(e.appends ?? {}).every(([key, a]) => {
        const arr = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), parsed);
        return Array.isArray(arr) && a.items.every((h) => arr.some((x) => hashText(JSON.stringify(x)) === h));
      });
      if (!present) {
        broken.add(e.path);
        add('error', 'integrity', [read(e.path) === null ? 'missing' : 'hooksRemoved', e.path], { action: ['missingAction'] });
      }
      continue;
    }
    if (e.kind !== 'file' && e.kind !== 'block') continue;
    const text = read(e.path);
    if (text === null) {
      add('error', 'integrity', ['missing', e.path], { action: ['missingAction'] });
      continue;
    }
    if (e.kind === 'file') {
      if (hashText(text) !== e.hash) add('warn', 'integrity', ['modified', e.path], { cause: ['modifiedCause'], action: ['modifiedAction'] });
    } else {
      const found = findBlock(text, e.style ?? 'html');
      if (found.status === 'broken') add('error', 'integrity', ['blockBroken', e.path], { action: ['blockBrokenAction'] });
      else if (found.status === 'absent') add('error', 'integrity', ['blockMissing', e.path], { action: ['missingAction'] });
      else if (hashText(toLf(found.content).replace(/\n+$/, '')) !== e.hash) add('warn', 'integrity', ['modified', e.path], { cause: ['modifiedCause'], action: ['modifiedAction'] });
    }
    if (local && !e.path.startsWith('.git/') && tracked.has(e.path) && e.kind === 'file') add('warn', 'mode', ['tracked', e.path], { action: ['trackedAction'] });
  }
  if (local && inRepo && manifest && !manifest.entries.some((e) => e.kind === 'block' && e.style === 'hash')) {
    add('error', 'mode', ['excludeMissing'], { action: ['missingAction'] });
  }

  for (const [id, c] of Object.entries(config.components ?? {})) {
    if (!['lint', 'typecheck', 'test', 'e2e'].some((k) => c.verify?.[k])) add('warn', 'verify', ['noVerify', id], { action: ['noVerifyAction'] });
  }
  for (const tool of config.tools ?? []) {
    const bin = TOOL_PROFILE[tool]?.bin;
    if (bin && !onPath(bin, env)) add('warn', 'tools', ['toolMissing', tool, bin], { action: ['toolMissingAction'] });
  }
  for (const n of manifest?.notices ?? []) add('warn', 'notice', ['notice', n]);

  // RF-DOC-01: skills.lock integrity; edge case 16: required skills still pending.
  const skillLock = readSkillsLock(root);
  const installedNames = Object.keys(skillLock.skills);
  // A skill blocked by its license (RF-SKL-15) is not pending: it will never be installed.
  const pendingSkills = requiredSkills(config).filter((s) => ALLOWED_LICENSES.includes(s.license) && !skillLock.skills[s.name]).map((s) => s.name);
  const skillProblems = verifySkills(root).problems;
  if (skillProblems.length) add('error', 'skills', ['skillsModified', skillProblems.length], { action: ['skillsModifiedAction'] });
  if (pendingSkills.length) add('warn', 'skills', ['skillsPending', pendingSkills], { action: ['skillsPendingAction'] });
  if (!installedNames.length && !pendingSkills.length) add('info', 'skills', ['skills']);
  else if (installedNames.length && !skillProblems.length) add('ok', 'skills', ['skillsOk', installedNames.length]);
  // RF-VER-03/05: the universal safety net.
  const own = (manifest?.entries ?? []).filter((e) => e.kind === 'git-config' && e.key === 'core.hooksPath');
  const chained = (manifest?.entries ?? []).filter((e) => e.generator === 'githooks' && e.kind === 'block');
  const manual = (manifest?.notices ?? []).filter((n) => n.code === 'hooksChainManual');
  if (config.git_hooks?.enabled && (own.length || chained.length || manual.length || inRepo)) {
    // One check per repository (RF-TOP-02): its own hooksPath, a chained block or a manual note.
    const failing = own.filter((e) => !String(getConfig(path.join(root, e.repo ?? ''), 'core.hooksPath') ?? '').replace(/\\/g, '/').endsWith('.harness/githooks'));
    for (const e of failing) add('error', 'hooks', ['hooksMissing'], { action: ['hooksAction'], repo: e.repo ?? '' });
    for (const b of chained.filter((x) => broken.has(x.path))) add('error', 'hooks', ['hooksMissing'], { action: ['hooksAction'], repo: b.path });
    for (const n of manual) add('warn', 'hooks', ['hooksChained', n.params.manager]);
    if (!own.length && !chained.length && !manual.length) add('error', 'hooks', ['hooksMissing'], { action: ['hooksAction'] });
    else if (!failing.length && (own.length || chained.length)) add('ok', 'hooks', ['hooksOk']);
  } else {
    add('info', 'hooks', ['hooksPath', inRepo ? getConfig(root, 'core.hooksPath') : null]);
  }
  // RF-TOP-05: dependencies between specs. RF-TOP-08/09: contract snapshots.
  const settings = loadGuardSettings(root);
  for (const spec of listSpecs(root, specRoots(settings))) {
    for (const ref of specDependencies(read(`${spec.dir}/spec.md`))) {
      if (!resolveSpecRef(root, settings, ref)) add('warn', 'dependencies', ['missingDependency', spec.id, ref], { action: ['missingDependencyAction'] });
    }
  }
  const snaps = listSnapshots(root, settings);
  let fresh = 0;
  for (const snap of snaps) {
    const c = checkSnapshot(root, snap);
    if (c.status === 'stale') add('warn', 'contracts', ['staleContract', snap.snapshot, snap.source.path], { action: ['staleContractAction'] });
    else if (c.status === 'unavailable') add('info', 'contracts', ['unavailableContract', snap.snapshot, snap.source?.repo ?? '?']);
    else fresh += 1;
  }
  if (!snaps.length) add('info', 'contracts', ['contracts']);
  else if (fresh) add('ok', 'contracts', ['contractsOk', fresh]);

  const tools = (config.tools ?? []).map((tool) => {
    const profile = TOOL_PROFILE[tool];
    const current = enforcementOf(tool, manifest, (e) => !broken.has(e.path));
    return {
      tool,
      potential: profile?.level ?? 'none',
      current: current.level,
      rules: current.rules,
      adapter: profile?.adapter,
      invocation: Object.fromEntries(FLOW.map((c) => [c, profile?.invoke(c) ?? `/sdd:${c}`])),
    };
  });
  return { checks, tools };
}

function render(msg, dict, tc) {
  const [key, ...args] = msg;
  if (key === 'notice') return tc.notice[args[0].code]?.(args[0].params) ?? args[0].code;
  const f = dict[key];
  return typeof f === 'function' ? f(...args) : f ?? key;
}

export async function doctorCommand(argv, { io, t, tc, lang, version }) {
  const out = (s) => io.stdout.write(s + '\n');
  const { flags, unknown } = parseArgs(argv, { boolean: ['json'] });
  if (unknown.length) {
    io.stderr.write(t.unknownOption(unknown[0]) + '\n');
    return 1;
  }
  const d = tc.doctor;
  const root = findProjectRoot(io.cwd);
  if (!root) {
    const result = { ok: false, errors: 1, warnings: 0, checks: [{ status: 'error', id: 'activation', message: d.notActivated, action: d.initAction }], tools: [] };
    if (flags.json) out(JSON.stringify(result, null, 2));
    else { out(`[${d.error}] ${d.notActivated}`); out(`    ${d.action}: ${d.initAction}`); }
    return 1;
  }
  const { checks, tools } = runChecks(root, { version, env: io.env });
  const rendered = checks.map((c) => ({
    status: c.status,
    id: c.id,
    message: render(c.message, d, tc),
    ...(c.cause ? { cause: render(c.cause, d, tc) } : {}),
    ...(c.action ? { action: render(c.action, d, tc) } : {}),
  }));
  const errors = rendered.filter((c) => c.status === 'error').length;
  const warnings = rendered.filter((c) => c.status === 'warn').length;

  if (flags.json) {
    out(JSON.stringify({ ok: errors === 0, errors, warnings, root, checks: rendered, tools }, null, 2));
    return errors ? 1 : 0;
  }
  const levels = LEVEL_LABEL[lang] ?? LEVEL_LABEL.en;
  out(`${d.title} · ${root}`);
  out('');
  for (const c of rendered) {
    out(`[${d[c.status]}] ${c.message}`);
    if (c.cause) out(`    ${d.cause}: ${c.cause}`);
    if (c.action) out(`    ${d.action}: ${c.action}`);
  }
  if (tools.length) {
    out('');
    out(`${d.enforcement}:`);
    for (const x of tools) {
      out(`  ${x.tool}: ${d.current} ${levels[x.current]} · ${d.potential} ${levels[x.potential]}`);
      if (x.current === 'none' && x.adapter) out(`    ${d.adapterPending(x.adapter)}`);
      out(`    ${RULES.map((r) => `${d.rules[r]}: ${x.rules[r] === 'deterministic' ? d.deterministic : d.instruction}`).join(' · ')}`);
      if (x.tool === 'antigravity') out(`    ${d.antigravityHint}`);
    }
    out('');
    out(`${d.invocation}:`);
    for (const x of tools) out(`  ${x.tool}: ${Object.values(x.invocation).join('  ')}`);
  }
  out('');
  out(d.summary(errors, warnings));
  return errors ? 1 : 0;
}
