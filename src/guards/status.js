// What happened and what comes next (RF-SDD-17, RF-ORQ-09), read from the
// markdown files, the last verifications and git. Dependency-free.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { safeRead } from './state.js';
import { ADDED_RE, resolveSpecRef, specDependencies, taskQueue } from './tasks.js';
import { runtimeMessages } from './runtime-messages.js';

const ids = (tasks) => tasks.map((x) => x.id).join(', ');

/** Plain data of the status, for `sdd.js status --json`. */
export function statusData(root, settings, flow, runtime) {
  const { spec, tasks } = flow;
  const done = tasks.filter((x) => x.done);
  const open = tasks.filter((x) => !x.done);
  const warnings = [];
  if (spec) {
    for (const ref of specDependencies(safeRead(path.join(root, spec.dir, 'spec.md')))) {
      if (!resolveSpecRef(root, settings, ref)) warnings.push(runtimeMessages().status.missingDependency(ref));
    }
  }
  return {
    spec: spec?.id ?? null,
    status: spec?.status ?? null,
    pending: spec && runtime.pending?.spec === spec.id ? runtime.pending.stop : null,
    done: done.map((x) => x.id),
    open: open.map((x) => x.id),
    ready: spec?.status === 'plan-approved' ? taskQueue(tasks).ready.map((x) => x.id) : [],
    added: tasks.filter((x) => ADDED_RE.test(x.title)).map((x) => x.id),
    verify: runtime.verify ?? {},
    warnings,
  };
}

export function statusLines(root, settings, flow, runtime, { brief = false } = {}) {
  const s = runtimeMessages().status;
  const d = statusData(root, settings, flow, runtime);
  const byId = Object.fromEntries(flow.tasks.map((x) => [x.id, x]));
  const titled = (list) => list.map((id) => `${id} ${byId[id]?.title ?? ''}`.trim());
  const lines = [
    `- ${s.spec}: ${d.spec ?? s.none} (${s.phase}: ${d.status ?? s.none})`,
    ...(d.pending ? [`- ${s.pending}: ${d.pending}`] : []),
    `- ${s.done} (${d.done.length}/${flow.tasks.length}): ${titled(d.done.slice(-3)).join(' · ') || s.none}`,
    `- ${s.open}: ${ids(flow.tasks.filter((x) => !x.done)) || s.none}`,
    ...(d.ready.length ? [`- ${s.ready}: ${d.ready.join(', ')}`] : []),
    ...(d.added.length ? [`- ${s.added}: ${d.added.join(', ')}`] : []),
    ...Object.entries(d.verify).map(([c, v]) => `- ${s.verify} ${c}: ${v.status === 'pass' ? 'ok' : `falla (${v.command})`} · ${v.at?.slice(0, 16).replace('T', ' ') ?? ''}`),
    ...(d.warnings.length ? [`- ${s.warnings}: ${d.warnings.join(' · ')}`] : []),
  ];
  if (!brief) {
    const log = spawnSync('git', ['log', '-5', '--oneline', '--no-decorate'], { cwd: root, encoding: 'utf8', windowsHide: true });
    const commits = (log.status === 0 ? log.stdout : '').trim();
    if (commits) lines.push(`- ${s.lastCommits}:`, ...commits.split(/\r?\n/).map((l) => `    ${l}`));
  }
  return lines;
}
