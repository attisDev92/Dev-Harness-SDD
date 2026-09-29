#!/usr/bin/env node
// Claude Code hook dispatcher (RF-ADP-01/02). One entry point per event:
//   node .harness/scripts/hook.js <PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|SessionEnd|Stop>
// It reads the hook payload from stdin and applies the neutral guards.
// Exit 2 + stderr blocks (Claude reads the reason); stdout JSON asks the user.
// Dependency-free.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findProjectRoot, loadGuardSettings } from './project.js';
import { isMainModule } from './args.js';
import { loadFlow, saveFlow, touchLock, releaseLock, logEvent } from './state.js';
import { checkShell } from './bash-guard.js';
import { checkWrite, componentOf } from './files-guard.js';
import { decide, parseDecision } from './flow.js';
import { changeSnapshot, changedSince } from './verify.js';
import { loadState as loadRetries, saveState as saveRetries, resetTask } from './retry.js';
import { runtimeMessages, verdictText } from './runtime-messages.js';
import { guardMessages } from './messages.js';
import { matchesAny } from './glob.js';
import { specRoots } from './tasks.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);
const HARNESS_ROLES = new Set(['spec-reviewer', 'architect', 'frontend-dev', 'backend-dev', 'qa-tester', 'reviewer', 'debugger', 'doc-writer']);

/**
 * @param {string} event
 * @param {object} payload hook input
 * @param {{ env?: object, cwd?: string, snapshot?: (root: string) => object }} [opts]
 * @returns {{ code: number, stdout?: string, stderr?: string }}
 */
export function handleHook(event, payload, opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = payload.cwd ?? env.CLAUDE_PROJECT_DIR ?? opts.cwd ?? process.cwd();
  const root = findProjectRoot(cwd);
  if (!root) return { code: 0 };
  const settings = loadGuardSettings(root);
  const lang = env.HARNESS_LANG?.startsWith('es') ? 'es' : env.HARNESS_LANG?.startsWith('en') ? 'en' : settings.language ?? 'es';
  const t = runtimeMessages(lang);
  const legacy = guardMessages(lang);
  const { state, rebuilt } = loadFlow(root, specRoots(settings));
  const session = payload.session_id ?? 'unknown';
  const save = () => saveFlow(root, state, settings.specsLanguage);
  const snapshot = opts.snapshot ?? changeSnapshot;
  const blockWith = (text) => ({ code: 2, stderr: text });
  const input = payload.tool_input ?? {};
  const tool = payload.tool_name;

  switch (event) {
    case 'PreToolUse': {
      const writes = WRITE_TOOLS.has(tool) || (tool === 'Bash' && /sdd\.js/.test(input.command ?? ''));
      // RF-ORQ-12: one session runs tasks at a time.
      if (writes && (state.task || /sdd\.js["']?\s+next\b/.test(input.command ?? ''))) {
        const lock = touchLock(root, session);
        if (!lock.ok) return blockWith(t.hook.lockBusy(lock.holder));
      }
      let verdict = { decision: 'allow' };
      if (tool === 'Bash') {
        verdict = checkShell(input.command ?? '', { root, cwd, settings, state });
      } else if (WRITE_TOOLS.has(tool)) {
        const file = input.file_path ?? input.notebook_path ?? input.path;
        if (file) verdict = checkWrite({ root, file: path.resolve(cwd, file), settings, state, input });
      } else if (AGENT_TOOLS.has(tool) && HARNESS_ROLES.has(input.subagent_type)) {
        state.subagent = { role: input.subagent_type, snapshot: snapshot(root), started: new Date().toISOString() };
        save();
      }
      if (verdict.decision === 'block') return blockWith(verdictText({ ...verdict, allowed: settings.docsWhitelist }, lang, legacy));
      if (verdict.decision === 'ask') {
        return {
          code: 0,
          stdout: JSON.stringify({
            hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: verdictText(verdict, lang, legacy) },
          }),
        };
      }
      return { code: 0 };
    }

    case 'PostToolUse': {
      if (WRITE_TOOLS.has(tool) && state.task) {
        const file = input.file_path ?? input.notebook_path;
        const rel = file ? path.relative(root, path.resolve(cwd, file)).split(path.sep).join('/') : '';
        if (componentOf(rel, settings.components)) {
          state.task.dirty = true;
          save();
        }
        return { code: 0 };
      }
      if (AGENT_TOOLS.has(tool) && state.subagent) {
        // RF-DOM-03/04: compare what the subagent changed with its lanes.
        const { role, snapshot: before } = state.subagent;
        state.subagent = null;
        const changed = changedSince(before, snapshot(root));
        const lanes = settings.roles?.[role]?.writes ?? [];
        const outside = changed.filter((f) => !matchesAny(f, lanes) && !f.startsWith('.harness/'));
        if (changed.some((f) => componentOf(f, settings.components)) && state.task) state.task.dirty = true;
        logEvent(state, 'subagent-finished', { role, changed: changed.length, outside: outside.length });
        save();
        if (outside.length) return blockWith(t.hook.lanes(role, outside));
      }
      return { code: 0 };
    }

    case 'UserPromptSubmit': {
      const decision = parseDecision(payload.prompt);
      if (!decision) return { code: 0 };
      if (!state.gate) {
        return /^\s*\/sdd:(approve|reject)/i.test(payload.prompt ?? '') ? { code: 0, stdout: t.hook.noGate() } : { code: 0 };
      }
      const result = decide(state, decision);
      Object.assign(state, result.state);
      if (result.resetRetries) saveRetries(root, resetTask(loadRetries(root), result.resetRetries));
      save();
      const lines = [result.approved ? t.hook.approved(result.gate.kind, decision.text) : t.hook.rejected(result.gate.kind, decision.text)];
      if (!result.approved && result.gate.kind === 'manual-test') lines.push(t.hook.triageFromKo());
      return { code: 0, stdout: lines.join('\n') };
    }

    case 'SessionStart': {
      // RF-ORQ-09: pick up where the last session left off.
      const lines = [];
      if (rebuilt) {
        save();
        lines.push(t.hook.rebuilt());
      }
      if (state.activeSpec || state.task || state.gate) {
        const spec = state.specs[state.activeSpec] ?? {};
        lines.push(t.hook.resumed([
          `- ${t.status.spec}: ${state.activeSpec ?? t.status.none} (${t.status.phase}: ${spec.phase ?? t.status.none})`,
          `- ${t.status.task}: ${state.task ? `${state.task.id} ${state.task.title ?? ''}`.trim() : t.status.none}`,
          `- ${t.status.gate}: ${state.gate?.kind ?? t.status.none}`,
          ...(state.triage ? [`- ${t.status.triage}: ${state.triage.task}`] : []),
        ].join('\n')));
      }
      return { code: 0, stdout: lines.join('\n') };
    }

    case 'SessionEnd':
      releaseLock(root, session);
      return { code: 0 };

    case 'Stop': {
      // RF-VER-01: never finish with unverified or failing changes. Blocking
      // only once (stop_hook_active) avoids an endless loop.
      if (payload.stop_hook_active || !state.task) return { code: 0 };
      if (state.task.dirty || state.task.verify?.status === 'fail') {
        return blockWith(t.hook.stopVerify(state.task.id, state.task.verify?.status === 'fail' ? state.task.verify.failing?.command : null));
      }
      return { code: 0 };
    }

    default:
      return { code: 0 };
  }
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
    // Fail safe: an internal error blocks tool calls, but never breaks a session.
    result = event === 'PreToolUse'
      ? { code: 2, stderr: `Blocked: the harness hook failed (${err?.message ?? err}). Fail-safe: the action was not allowed.` }
      : { code: 0, stderr: `sdd-harness hook error: ${err?.message ?? err}` };
  }
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.code;
}

if (isMainModule(import.meta.url)) main();
