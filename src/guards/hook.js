#!/usr/bin/env node
// Claude Code hook dispatcher (RF-ADP-01/02). One entry point per event:
//   node .harness/scripts/hook.js <PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|Stop>
// It reads the hook payload from stdin. Alerts never stop the work; only the
// harness itself is blocked (exit 2 + stderr). Dependency-free.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findProjectRoot, loadGuardSettings } from './project.js';
import { isMainModule } from './args.js';
import { loadRuntime, saveRuntime, logEvent, readFlow, approveStop } from './state.js';
import { checkWrite } from './files-guard.js';
import { parseDecision } from './flow.js';
import { changeSnapshot, changedSince } from './verify.js';
import { runtimeMessages, verdictText } from './runtime-messages.js';
import { matchesAny } from './glob.js';
import { statusLines } from './status.js';
import { MAX_PARALLEL } from './tasks.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);
const STALE_SUBAGENT_MS = 60 * 60 * 1000;
const DOC_FILE =/\.(md|mdx)$/i;
const HARNESS_ROLES = new Set(['spec-reviewer', 'architect', 'frontend-dev', 'backend-dev', 'qa-tester', 'reviewer', 'debugger', 'doc-writer']);

/**
 * @param {string} event
 * @param {object} payload hook input
 * @param {{ env?: object, cwd?: string, snapshot?: (root: string) => object, runSync?: (root: string) => { ok: boolean, output: string } }} [opts]
 * @returns {{ code: number, stdout?: string, stderr?: string }}
 */
export function handleHook(event, payload, opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = payload.cwd ?? env.CLAUDE_PROJECT_DIR ?? opts.cwd ?? process.cwd();
  const root = findProjectRoot(cwd);
  if (!root) return { code: 0 };
  const settings = loadGuardSettings(root);
  const t = runtimeMessages();
  const runtime = loadRuntime(root);
  const save = () => saveRuntime(root, runtime);
  const snapshot = opts.snapshot ?? changeSnapshot;
  const context = (text) => ({ code: 0, stdout: JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: event, additionalContext: text } }) });
  // The same alert is not repeated for the same spec and pending tasks.
  const alertOnce = (text, key) => {
    if (runtime.alerted.includes(key)) return { code: 0 };
    runtime.alerted.push(key);
    save();
    return context(text);
  };
  const input = payload.tool_input ?? {};
  const tool = payload.tool_name;

  switch (event) {
    case 'PreToolUse': {
      if (AGENT_TOOLS.has(tool) && HARNESS_ROLES.has(input.subagent_type)) {
        // Up to MAX_PARALLEL subagents may run at once (frontend and backend): each one is tracked on its own.
        // A subagent that never reported back (crashed) stops counting after an hour.
        const running = Object.values(runtime.subagents).filter((s) => Date.now() - Date.parse(s.started) < STALE_SUBAGENT_MS).length;
        runtime.subagents[payload.tool_use_id ?? input.subagent_type] = { role: input.subagent_type, snapshot: snapshot(root), started: new Date().toISOString() };
        save();
        return running >= MAX_PARALLEL ? context(t.hook.tooMany(input.subagent_type, running)) : { code: 0 };
      }
      if (!WRITE_TOOLS.has(tool)) return { code: 0 };
      const file = input.file_path ?? input.notebook_path ?? input.path;
      if (!file) return { code: 0 };
      const flow = readFlow(root, settings);
      const verdict = checkWrite({ root, file: path.resolve(cwd, file), settings, flow, input });
      if (verdict.decision === 'block') return { code: 2, stderr: verdictText(verdict) };
      if (verdict.decision === 'warn') {
        const open = flow.tasks.filter((x) => !x.done).map((x) => x.id).join('+') || '-';
        return alertOnce(verdictText(verdict), `${verdict.kind}:${verdict.zone ?? verdict.component ?? verdict.match}:${flow.spec?.id ?? '-'}:${open}`);
      }
      return { code: 0 };
    }

    case 'PostToolUse': {
      if (WRITE_TOOLS.has(tool)) {
        const file = input.file_path ?? input.notebook_path ?? '';
        if (path.resolve(cwd, file) !== path.join(root, 'harness.config.yaml')) return { code: 0 };
        // RF-GAT-09: the configuration is regenerated right after the user's change.
        const r = (opts.runSync ?? runSync)(root);
        logEvent(root, 'config-synced', { ok: r.ok });
        return context(r.ok ? t.hook.configSynced(r.output) : t.hook.configSyncFailed(r.output));
      }
      const key = payload.tool_use_id ?? input.subagent_type;
      if (!AGENT_TOOLS.has(tool) || !runtime.subagents[key]) return { code: 0 };
      // RF-DOM-03/04: compare what the subagent changed with its lanes.
      const { role, snapshot: before } = runtime.subagents[key];
      delete runtime.subagents[key];
      const alone = Object.keys(runtime.subagents).length === 0;
      const changed = changedSince(before, snapshot(root));
      const lanes = settings.roles?.[role]?.writes ?? [];
      const tooling = settings.protected?.tooling ?? [];
      // While another subagent runs in parallel its files show up in the same diff, so lanes are only checked when this one ran alone.
      const outside = alone ? changed.filter((f) => !matchesAny(f, lanes) && !f.startsWith('.harness/') && !DOC_FILE.test(f) && !matchesAny(f, tooling)) : [];
      logEvent(root, 'subagent-finished', { role, changed: changed.length, outside: outside.length });
      save();
      return outside.length ? context(t.hook.lanes(role, outside)) : { code: 0 };
    }

    case 'UserPromptSubmit': {
      // RF-GAT-08: the user answers a stop by talking ("sí", "continúa", "aprobado"…).
      const pending = runtime.pending;
      if (!pending) return { code: 0 };
      const decision = parseDecision(payload.prompt);
      if (!decision) return { code: 0 };
      const flow = readFlow(root, settings);
      const spec = flow.spec?.id === pending.spec ? flow.spec : null;
      if (!spec) {
        runtime.pending = null;
        save();
        return { code: 0 };
      }
      if (!decision.approved) return { code: 0, stdout: t.hook.changesRequested(pending.stop, spec.id) };
      approveStop(root, spec, pending.stop);
      runtime.pending = null;
      save();
      logEvent(root, 'stop-approved', { spec: spec.id, stop: pending.stop });
      return { code: 0, stdout: t.hook.approvedByUser(pending.stop, spec.id, decision.text) };
    }

    case 'SessionStart': {
      // RF-ORQ-09: pick up where the last session left off.
      const flow = readFlow(root, settings);
      if (!flow.spec) return { code: 0 };
      return { code: 0, stdout: t.hook.resumed(statusLines(root, settings, flow, runtime, { brief: true }).join('\n')) };
    }

    case 'Stop': {
      // RF-VER-01: never finish with failing verification. Once per failure, so it never loops.
      if (payload.stop_hook_active) return { code: 0 };
      const failing = Object.entries(runtime.verify ?? {}).find(([, v]) => v.status === 'fail' && !v.reminded);
      if (!failing) return { code: 0 };
      failing[1].reminded = true;
      save();
      return { code: 2, stderr: t.hook.stopVerify(failing[0], failing[1].command) };
    }

    default:
      return { code: 0 };
  }
}

function runSync(root) {
  const r = spawnSync('sdd-harness', ['sync', '--yes'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 120000 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`.trim().split(/\r?\n/).slice(-15).join('\n');
  return { ok: r.status === 0, output };
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (c) => { data += c; });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

async function main() {
  const event = process.argv[2];
  let result;
  try {
    const raw = await readAll(process.stdin);
    result = handleHook(event, raw.trim() ? JSON.parse(raw) : {});
  } catch (err) {
    // An internal error never blocks the work: the harness is a helper, not a wall.
    result = { code: 0, stderr: `sdd-harness hook error: ${err?.message ?? err}` };
  }
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.code;
}

if (isMainModule(import.meta.url)) main();
