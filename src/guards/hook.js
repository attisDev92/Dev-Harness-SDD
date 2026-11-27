#!/usr/bin/env node
// Hook dispatcher for Claude Code and Google Antigravity (RF-ADP-01/02, RF-AGH-*, RF-HRD-*).
//   node .harness/scripts/hook.js <PreToolUse|PostToolUse|PreInvocation|PostInvocation|UserPromptSubmit|SessionStart|Stop>
// Reads the hook payload from stdin. Dependency-free.

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

const CLAUDE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const AGY_WRITE_TOOLS = new Set(['write_file', 'edit_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ask_question']);
const READ_ONLY_ROLES = new Set(['spec-reviewer', 'reviewer', 'debugger']);
const STALE_SUBAGENT_MS = 60 * 60 * 1000;
const DOC_FILE = /\.(md|mdx)$/i;
const HARNESS_ROLES = new Set(['spec-reviewer', 'architect', 'frontend-dev', 'backend-dev', 'qa-tester', 'reviewer', 'debugger', 'doc-writer']);

const GIT_ASK_RE = /^git\s+(?:push|rebase|merge|cherry-pick|tag|reset\s+--hard|stash\s+drop|branch\s+-D)\b/;
const DEPS_ASK_RE = /^(?:npm\s+(?:install|i)|pnpm\s+add|yarn\s+add|bun\s+add|pip3?\s+install|pipenv\s+install|uv\s+add|poetry\s+add|cargo\s+add|go\s+get|composer\s+require|dotnet\s+add\s+package|gem\s+install|bundle\s+add)\b/;

const isWriteTool = (tool) => CLAUDE_WRITE_TOOLS.has(tool) || AGY_WRITE_TOOLS.has(tool);

function resolveAgyRole(input) {
  for (const candidate of [input.TypeName, input.Role, input.Subagents?.[0]?.Role]) {
    if (HARNESS_ROLES.has(candidate)) return candidate;
  }
  const m = /^Rol:\s*([a-z-]+)\b/m.exec(String(input.Prompt ?? ''));
  return m && HARNESS_ROLES.has(m[1]) ? m[1] : null;
}

function commandSegments(cmd) {
  return String(cmd ?? '')
    .split(/(?:&&|\|\||;|\||\r?\n)+/)
    .map((s) => s.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+)*/, '').trim())
    .filter(Boolean);
}

/**
 * If `convId` is a background subagent session in Antigravity, binds it to the
 * oldest unclaimed async subagent launched from another conversation.
 */
function resolveSubagentEntry(runtime, convId) {
  if (!convId) return null;
  const entries = Object.entries(runtime.subagents ?? {});
  const existing = entries.find(([, s]) => s.subConv === convId);
  if (existing) return { key: existing[0], entry: existing[1], boundNow: false };
  if (entries.some(([, s]) => s.parentConv === convId)) return null;
  const unclaimed = entries.find(([, s]) => s.async && !s.subConv && s.parentConv && s.parentConv !== convId && Date.now() - Date.parse(s.started) < STALE_SUBAGENT_MS);
  if (!unclaimed) return null;
  unclaimed[1].subConv = convId;
  return { key: unclaimed[0], entry: unclaimed[1], boundNow: true };
}

/**
 * @param {string} event
 * @param {object} payload hook input
 * @param {{ env?: object, cwd?: string, snapshot?: (root: string) => object, runSync?: (root: string) => { ok: boolean, output: string } }} [opts]
 * @returns {{ code: number, stdout?: string, stderr?: string }}
 */
export function handleHook(event, payload, opts = {}) {
  const env = opts.env ?? process.env;
  const isAgy = payload.toolCall !== undefined || payload.conversationId !== undefined || payload.hookEventName !== undefined;
  const cwd = payload.cwd ?? env.CLAUDE_PROJECT_DIR ?? opts.cwd ?? process.cwd();
  const root = findProjectRoot(cwd);
  if (!root) return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
  const settings = loadGuardSettings(root);
  const t = runtimeMessages();
  const runtime = loadRuntime(root);
  const save = () => saveRuntime(root, runtime);
  const snapshot = opts.snapshot ?? changeSnapshot;

  const queueAlert = (text) => {
    if (!text) return;
    runtime.queuedAlerts = [...(runtime.queuedAlerts ?? []), text].slice(-20);
  };
  const popAlerts = () => {
    const list = [...(runtime.queuedAlerts ?? [])];
    if (!list.length) return [];
    runtime.queuedAlerts = [];
    save();
    return list;
  };
  const agyInject = (messages) => {
    const clean = messages.filter(Boolean);
    if (!clean.length) return { code: 0, stdout: '{}' };
    return { code: 0, stdout: JSON.stringify({ injectSteps: clean.map((m) => ({ systemMessage: { systemMessage: m } })) }) };
  };

  const context = (text) => {
    if (isAgy) {
      queueAlert(text);
      save();
      return { code: 0, stdout: JSON.stringify({ decision: 'allow', reason: text }) };
    }
    return { code: 0, stdout: JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: event, additionalContext: text } }) };
  };

  const blockHook = (reason) => (isAgy
    ? { code: 0, stdout: JSON.stringify({ decision: 'deny', reason }) }
    : { code: 2, stderr: reason });

  const askHook = (reason) => ({ code: 0, stdout: JSON.stringify({ decision: 'ask', reason }) });

  // The same alert is not repeated for the same spec and pending tasks.
  const alertOnce = (text, key) => {
    if (runtime.alerted.includes(key)) return isAgy ? { code: 0, stdout: JSON.stringify({ decision: 'allow' }) } : { code: 0 };
    runtime.alerted.push(key);
    save();
    return context(text);
  };

  const finishSubagent = (key) => {
    const entry = runtime.subagents[key];
    if (!entry) return null;
    const { role, snapshot: before } = entry;
    delete runtime.subagents[key];
    const alone = Object.keys(runtime.subagents).length === 0;
    const changed = changedSince(before, snapshot(root));
    const lanes = settings.roles?.[role]?.writes ?? [];
    const tooling = settings.protected?.tooling ?? [];
    const outside = alone ? changed.filter((f) => !matchesAny(f, lanes) && !f.startsWith('.harness/') && !DOC_FILE.test(f) && !matchesAny(f, tooling)) : [];
    logEvent(root, 'subagent-finished', { role, changed: changed.length, outside: outside.length });
    save();
    return outside.length ? t.hook.lanes(role, outside) : null;
  };

  const input = isAgy ? (payload.toolCall?.args ?? {}) : (payload.tool_input ?? {});
  const tool = isAgy ? payload.toolCall?.name : payload.tool_name;
  const agySubagentRole = isAgy && tool === 'invoke_subagent' ? resolveAgyRole(input) : null;
  const subSession = isAgy ? resolveSubagentEntry(runtime, payload.conversationId) : null;
  if (subSession?.boundNow) save();

  switch (event) {
    case 'PreToolUse': {
      // RF-HRD-06 / RF-AGH-04: command guards (self-approval prevention + native confirmation for risky git and package installs).
      if (tool === 'run_command' || tool === 'Bash') {
        const cmd = String(input.CommandLine ?? input.command ?? '');
        if (/\bsdd\.js\s+stop\b/.test(cmd) && /\bsdd\.js\s+approve\b/.test(cmd)) {
          return blockHook(t.hook.selfApproveBlocked());
        }
        if (/\bsdd\.js\s+approve\b/.test(cmd) && runtime.pending?.waitingForUser) {
          return blockHook(t.hook.selfApproveBlocked());
        }
        if (isAgy) {
          for (const seg of commandSegments(cmd)) {
            if (GIT_ASK_RE.test(seg)) return askHook(t.hook.askGit(seg));
            if (DEPS_ASK_RE.test(seg)) return askHook(t.hook.askDeps(seg));
          }
          return { code: 0, stdout: JSON.stringify({ decision: 'allow' }) };
        }
        return { code: 0 };
      }

      if (QUESTION_TOOLS.has(tool)) {
        if (runtime.pending?.waitingForUser) {
          runtime.pending.waitingForUser = false;
          save();
        }
        return isAgy ? { code: 0, stdout: JSON.stringify({ decision: 'allow' }) } : { code: 0 };
      }

      if ((AGENT_TOOLS.has(tool) && HARNESS_ROLES.has(input.subagent_type)) || (tool === 'invoke_subagent' && agySubagentRole)) {
        const subType = input.subagent_type ?? agySubagentRole;
        if (runtime.paused) {
          logEvent(root, 'subagent-refused', { role: subType, reason: 'paused' });
          return blockHook(t.pause.launchBlocked(subType, runtime.paused.at.slice(0, 16).replace('T', ' ')));
        }
        const activeEntries = Object.entries(runtime.subagents).filter(([, s]) => Date.now() - Date.parse(s.started) < STALE_SUBAGENT_MS);
        const running = activeEntries.length;
        const callId = payload.tool_use_id ?? payload.toolCall?.id ?? subType;
        runtime.subagents[callId] = {
          role: subType,
          snapshot: snapshot(root),
          started: new Date().toISOString(),
          ...(isAgy ? { async: true, parentConv: payload.conversationId ?? null, subConv: null } : {}),
        };
        save();
        if (running >= settings.maxParallel) return context(t.hook.tooMany(subType, running, settings.maxParallel));
        return isAgy ? { code: 0, stdout: JSON.stringify({ decision: 'allow' }) } : { code: 0 };
      }

      if (!isWriteTool(tool)) return isAgy ? { code: 0, stdout: JSON.stringify({ decision: 'allow' }) } : { code: 0 };
      const file = input.Path ?? input.file_path ?? input.notebook_path ?? input.path ?? input.TargetFile;
      if (!file) return isAgy ? { code: 0, stdout: JSON.stringify({ decision: 'allow' }) } : { code: 0 };

      // RF-DOM-02: if an Antigravity read-only subagent was bound to this conversation, hard-deny writes.
      if (subSession && READ_ONLY_ROLES.has(subSession.entry.role)) {
        return blockHook(t.hook.readOnlyRole(subSession.entry.role, path.relative(root, path.resolve(cwd, file)).split(path.sep).join('/')));
      }

      // RF-GAT-09 / RF-AGH-04: editing harness.config.yaml asks natively in Antigravity just like permissions.ask in Claude Code.
      if (isAgy && path.resolve(cwd, file) === path.join(root, 'harness.config.yaml')) {
        return askHook(t.hook.askConfig());
      }

      const flow = readFlow(root, settings);
      const verdict = checkWrite({ root, file: path.resolve(cwd, file), settings, flow, input });
      if (verdict.decision === 'block') return blockHook(verdictText(verdict));
      if (verdict.decision === 'warn') {
        const target = verdict.zone ?? verdict.component ?? verdict.match;
        return alertOnce(verdictText(verdict), `${verdict.kind}:${target}:${flow.spec?.id ?? '-'}`);
      }
      return isAgy ? { code: 0, stdout: JSON.stringify({ decision: 'allow' }) } : { code: 0 };
    }

    case 'PostToolUse': {
      if (QUESTION_TOOLS.has(tool) && runtime.pending?.waitingForUser) {
        runtime.pending.waitingForUser = false;
        save();
        return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
      }
      if ((tool === 'run_command' || tool === 'Bash') && /\bsdd\.js\s+stop\b/.test(String(input.CommandLine ?? input.command ?? '')) && !payload.error) {
        const fresh = loadRuntime(root);
        if (fresh.pending) {
          fresh.pending.waitingForUser = true;
          saveRuntime(root, fresh);
        }
        return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
      }
      if (isWriteTool(tool)) {
        const file = input.Path ?? input.file_path ?? input.notebook_path ?? input.path ?? input.TargetFile ?? '';
        if (path.resolve(cwd, file) !== path.join(root, 'harness.config.yaml')) {
          return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
        }
        // RF-GAT-09: regenerate right after the user's change.
        const r = (opts.runSync ?? runSync)(root);
        logEvent(root, 'config-synced', { ok: r.ok });
        const msg = r.ok ? t.hook.configSynced(r.output) : t.hook.configSyncFailed(r.output);
        if (isAgy) {
          queueAlert(msg);
          save();
          return { code: 0, stdout: '{}' };
        }
        return context(msg);
      }
      const key = payload.tool_use_id ?? payload.toolCall?.id ?? input.subagent_type ?? agySubagentRole;
      if ((!AGENT_TOOLS.has(tool) && tool !== 'invoke_subagent') || !runtime.subagents[key]) {
        return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
      }
      // In Antigravity, invoke_subagent spawns in the background and returns immediately;
      // keep the slot open until the subagent's own Stop hook (or sdd.js done).
      if (isAgy && runtime.subagents[key].async) {
        return { code: 0, stdout: '{}' };
      }
      const laneWarning = finishSubagent(key);
      return laneWarning ? context(laneWarning) : (isAgy ? { code: 0, stdout: '{}' } : { code: 0 });
    }

    case 'UserPromptSubmit': {
      if (isAgy) return { code: 0, stdout: '{}' };
      // RF-GAT-08: the user answers a stop by talking ("sí", "continúa", "aprobado"…).
      const pending = runtime.pending;
      if (!pending) return { code: 0 };
      if (pending.waitingForUser) pending.waitingForUser = false;
      const decision = parseDecision(payload.prompt);
      if (!decision) { save(); return { code: 0 }; }
      const flow = readFlow(root, settings);
      const spec = flow.spec?.id === pending.spec ? flow.spec : null;
      if (!spec) {
        runtime.pending = null;
        save();
        return { code: 0 };
      }
      if (!decision.approved) { save(); return { code: 0, stdout: t.hook.changesRequested(pending.stop, spec.id) }; }
      approveStop(root, spec, pending.stop);
      runtime.pending = null;
      save();
      logEvent(root, 'stop-approved', { spec: spec.id, stop: pending.stop });
      return { code: 0, stdout: t.hook.approvedByUser(pending.stop, spec.id, decision.text) };
    }

    case 'SessionStart': {
      if (subSession) return { code: 0, stdout: '{}' };
      const flow = readFlow(root, settings);
      if (!flow.spec) return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
      const text = t.hook.resumed(statusLines(root, settings, flow, runtime, { brief: true }).join('\n'));
      return isAgy ? agyInject([text]) : { code: 0, stdout: text };
    }

    case 'PreInvocation': {
      if (!isAgy) return { code: 0 };
      if (subSession) return { code: 0, stdout: '{}' };
      const messages = [];
      const firstOfTurn = !payload.invocationNum || payload.invocationNum === 1;
      if (firstOfTurn && runtime.pending) {
        if (runtime.pending.waitingForUser) {
          runtime.pending.waitingForUser = false;
          save();
        }
        const prompt = String(payload.lastUserInput ?? '').trim();
        if (prompt && runtime.pending.lastCheckedInput !== prompt) {
          runtime.pending.lastCheckedInput = prompt;
          const decision = parseDecision(prompt);
          const flow = readFlow(root, settings);
          const spec = flow.spec?.id === runtime.pending.spec ? flow.spec : null;
          if (!spec) {
            runtime.pending = null;
            save();
          } else if (decision && decision.approved) {
            const stop = runtime.pending.stop;
            approveStop(root, spec, stop);
            runtime.pending = null;
            save();
            logEvent(root, 'stop-approved', { spec: spec.id, stop });
            messages.push(t.hook.approvedByUser(stop, spec.id, decision.text));
          } else if (decision) {
            save();
            messages.push(t.hook.changesRequested(runtime.pending.stop, spec.id));
          }
        }
      }
      messages.push(...popAlerts());
      return agyInject(messages);
    }

    case 'PostInvocation': {
      if (!isAgy) return { code: 0 };
      if (subSession) return { code: 0, stdout: '{}' };
      return agyInject(popAlerts());
    }

    case 'Stop': {
      // RF-AGH-08: when a bound Antigravity background subagent stops normally, check its lanes and release its slot.
      if (subSession && !payload.continuationActive && (!payload.terminationReason || payload.terminationReason === 'NO_TOOL_CALL')) {
        const laneWarning = finishSubagent(subSession.key);
        if (laneWarning) {
          queueAlert(laneWarning);
          save();
        }
        return { code: 0, stdout: '{}' };
      }

      // RF-VER-01 / RF-AGH-07: never finish with failing verification. Once per failure, and never on user cancel / error.
      if (payload.stop_hook_active || payload.continuationActive) return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
      if (isAgy && payload.terminationReason && payload.terminationReason !== 'NO_TOOL_CALL') return { code: 0, stdout: '{}' };
      const failing = Object.entries(runtime.verify ?? {}).find(([, v]) => v.status === 'fail' && !v.reminded);
      if (!failing) return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
      failing[1].reminded = true;
      save();
      const reason = t.hook.stopVerify(failing[0], failing[1].command);
      if (isAgy) return { code: 0, stdout: JSON.stringify({ decision: 'continue', reason }) };
      return { code: 2, stderr: reason };
    }

    default:
      return isAgy ? { code: 0, stdout: '{}' } : { code: 0 };
  }
}

function runSync(root) {
  let r = spawnSync('sdd-harness', ['sync', '--yes'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 120000 });
  if (r.error?.code === 'ENOENT' || (process.platform === 'win32' && r.status === 1 && !r.stdout && /not recognized|no se reconoce/i.test(r.stderr ?? ''))) {
    r = spawnSync('npx', ['--no-install', 'sdd-harness', 'sync', '--yes'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 120000 });
  }
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
