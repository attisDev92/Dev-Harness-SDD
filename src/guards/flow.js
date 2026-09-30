// Human gates (RF-SDD-13, RF-ORQ-07, RF-GAT-07/08/10..14, RF-RET-04..06,
// RF-DOM-04). The agent can only *request* a gate; approvals come from what
// the user types (read by the UserPromptSubmit hook), never from the agent.
// Pure functions over the flow state. Dependency-free.

import { logEvent } from './state.js';

export const GATE_KINDS = ['constitution', 'spec', 'clarify', 'plan', 'tasks', 'review', 'manual-test', 'protected', 'change', 'triage', 'lanes', 'validate', 'tracker', 'config'];

const clone = (x) => structuredClone(x);

function specOf(state) {
  return state.activeSpec ? state.specs[state.activeSpec] ?? { phase: 'spec', approved: [] } : null;
}

/**
 * @returns {{ ok: true, state: object } | { ok: false, code: string, params?: object }}
 */
export function requestGate(state, { kind, files = [], adr, summary, option }) {
  if (!GATE_KINDS.includes(kind)) return { ok: false, code: 'unknownGate', params: { kind, kinds: GATE_KINDS } };
  if (state.gate) return { ok: false, code: 'gatePending', params: { kind: state.gate.kind } };
  const spec = specOf(state);
  const needSpec = ['spec', 'clarify', 'plan', 'tasks', 'change', 'validate'];
  if (needSpec.includes(kind) && !spec) return { ok: false, code: 'noActiveSpec' };
  if (kind === 'plan' && !spec.approved.includes('spec')) return { ok: false, code: 'needsApproval', params: { phase: 'spec' } };
  if (kind === 'tasks' && !spec.approved.includes('plan')) return { ok: false, code: 'needsApproval', params: { phase: 'plan' } };
  if (['review', 'manual-test'].includes(kind) && !state.task) return { ok: false, code: 'noTask' };
  if (kind === 'manual-test') {
    // RF-GAT-10: only after verification (and review) passed.
    if (state.task.verify?.status !== 'pass' || state.task.dirty) return { ok: false, code: 'verifyFirst' };
  }
  if (['protected', 'lanes'].includes(kind) && !files.length) return { ok: false, code: 'filesRequired' };
  if (kind === 'config' && !summary) return { ok: false, code: 'summaryRequired' };
  if (kind === 'protected' && !adr) return { ok: false, code: 'adrRequired' };
  if (kind === 'change' && !spec.change) return { ok: false, code: 'noChange' };
  if (kind === 'triage' && !state.triage) return { ok: false, code: 'noTriage' };
  if (kind === 'tracker' && !state.trackerPlan) return { ok: false, code: 'noTrackerPlan' };
  const next = clone(state);
  next.gate = { kind, spec: state.activeSpec, task: state.task?.id ?? null, files, adr, summary, option, requested: new Date().toISOString() };
  logEvent(next, 'gate-requested', { kind });
  return { ok: true, state: next };
}

/**
 * What the user typed, if it answers a gate: `/sdd:approve …`, `/sdd:reject …`,
 * or a message starting with OK / KO (RF-GAT-12/13).
 * @returns {{ approved: boolean, text: string } | null}
 */
export function parseDecision(prompt) {
  const p = String(prompt ?? '').trim();
  let m = /^\/sdd:(approve|reject)\b\s*([\s\S]*)$/i.exec(p);
  if (m) return { approved: m[1].toLowerCase() === 'approve', text: m[2].trim() };
  m = /^(ok|okay|ko)\b[\s.,:;!-]*([\s\S]*)$/i.exec(p);
  if (m) return { approved: m[1].toLowerCase() !== 'ko', text: m[2].trim() };
  return null;
}

/**
 * Applies the user's decision to the pending gate.
 * @returns {{ state: object, gate: object, approved: boolean, resetRetries?: string }}
 */
export function decide(state, { approved, text = '' }) {
  if (!state.gate) return null;
  const next = clone(state);
  const gate = next.gate;
  next.gate = null;
  const spec = next.activeSpec ? (next.specs[next.activeSpec] ??= { phase: 'spec', approved: [] }) : null;
  const approve = (phase, nextPhase) => {
    if (!spec.approved.includes(phase)) spec.approved.push(phase);
    if (nextPhase) spec.phase = nextPhase;
  };
  let resetRetries;

  if (approved) {
    switch (gate.kind) {
      case 'constitution': next.constitution.approved = true; break;
      case 'spec': approve('spec', spec.phase === 'spec' ? 'plan' : spec.phase); break;
      case 'clarify': approve('clarify'); break;
      case 'plan': approve('plan', 'tasks'); break;
      case 'tasks': approve('tasks', 'implement'); break;
      case 'review': if (next.task) next.task.review = 'approved'; break;
      case 'manual-test': if (next.task) next.task.manualApproved = true; break;
      case 'protected': next.granted = [...new Set([...(next.granted ?? []), ...gate.files])]; break;
      case 'config': next.granted = [...new Set([...(next.granted ?? []), 'harness.config.yaml'])]; break;
      case 'change': spec.change = false; break;
      case 'triage':
        // RF-RET-06: apply only the chosen option, with a fresh attempt counter.
        resetRetries = next.triage?.task ?? next.task?.id;
        next.triage = null;
        if (next.task) next.task.option = text;
        break;
      case 'validate': spec.phase = 'done'; break;
      // RF-TRK-08: the agent may now create and update items in the tracker.
      case 'tracker': if (next.trackerPlan) next.trackerPlan.approved = true; break;
      default: break;
    }
  } else if (gate.kind === 'manual-test' && next.task) {
    // RF-GAT-13: a KO starts triage; no code changes until the user picks an option.
    next.triage = { task: next.task.id, reason: text, started: new Date().toISOString() };
    next.task.manualApproved = false;
  } else if (gate.kind === 'review' && next.task) {
    next.task.review = 'changes-requested';
    next.task.reviewNotes = text;
  }
  logEvent(next, approved ? 'gate-approved' : 'gate-rejected', { kind: gate.kind, text });
  return { state: next, gate, approved, resetRetries };
}
