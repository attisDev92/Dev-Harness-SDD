// Two-way sync between tasks.md and any tracker (RF-TRK-01, 04..07). Pure
// planning: given local tasks, remote items and the last synced state, it
// decides what goes where and what needs the user's choice. Dependency-free:
// the CLI uses it for GitHub and sdd.js for every other tracker, whose items
// the agent reads and writes through that tracker's MCP.

/** Link of a task to its tracker item: `<!-- <provider>:<key> -->` (RF-TRK-01). */
const LINK_RE = /\s*<!--\s*([a-z0-9][a-z0-9-]*):([^\s>]+)\s*-->/;
const TASK_LINE = /^(\s*- \[)( |x|X)(\] )(T\d+)(\b\s*)(.*)$/;

/** Title of the task as shown in the tracker: "T3 Login API". */
export const remoteTitle = (task) => `${task.id} ${task.title}`;
export const localTitleOf = (remote) => String(remote.title).replace(/^T\d+\s+/, '');

/** Tasks of a tasks.md with their tracker link. */
export function linkedTasks(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    const m = TASK_LINE.exec(line);
    if (!m) return;
    const link = LINK_RE.exec(line);
    const title = m[6].replace(LINK_RE, '').split(/\s+·\s+/)[0].trim();
    out.push({ id: m[4], done: m[2] !== ' ', title, link: link ? link[2] : null, provider: link ? link[1] : null, line: index });
  });
  return out;
}

/** Rewrites one task line: checkbox, title and link; the rest of the line stays. */
export function updateTaskLine(text, id, { done, title, link }) {
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n';
  return String(text).split(/\r?\n/).map((line) => {
    const m = TASK_LINE.exec(line);
    if (!m || m[4] !== id) return line;
    let rest = m[6];
    if (title !== undefined) {
      const [, ...fields] = rest.replace(LINK_RE, '').split(/\s+·\s+/);
      rest = [title, ...fields].join(' · ');
    }
    const existing = LINK_RE.exec(line);
    const linkText = link ? ` <!-- ${link} -->` : existing ? existing[0] : '';
    rest = rest.replace(LINK_RE, '');
    const box = done === undefined ? m[2] : done ? 'x' : ' ';
    return `${m[1]}${box}${m[3]}${m[4]}${m[5]}${rest}${linkText}`;
  }).join(eol);
}

/**
 * @param {{ tasks: object[], remote: { key: string, title: string, done: boolean }[], base: Record<string, { title: string, done: boolean }> }} input
 * @returns {{ push: object[], pull: object[], create: object[], conflicts: object[], proposals: object[], missing: object[] }}
 */
export function planSync({ tasks, remote, base }) {
  const byKey = new Map(remote.map((r) => [String(r.key), r]));
  const linkedKeys = new Set();
  const plan = { push: [], pull: [], create: [], conflicts: [], proposals: [], missing: [] };
  for (const task of tasks) {
    if (!task.link) {
      plan.create.push({ task, title: remoteTitle(task) });
      continue;
    }
    linkedKeys.add(task.link);
    const r = byKey.get(task.link);
    if (!r) {
      // Edge case 20: deleted in the tracker; never deleted locally.
      plan.missing.push({ task, key: task.link });
      continue;
    }
    const b = base[task.id] ?? { title: task.title, done: task.done };
    const localChanged = task.title !== b.title || task.done !== b.done;
    const remoteChanged = localTitleOf(r) !== b.title || Boolean(r.done) !== b.done;
    const differs = task.title !== localTitleOf(r) || task.done !== Boolean(r.done);
    if (!differs) continue;
    if (localChanged && remoteChanged) plan.conflicts.push({ task, remote: r });
    else if (remoteChanged) plan.pull.push({ task, remote: r, title: localTitleOf(r), done: Boolean(r.done) });
    else plan.push.push({ task, remote: r, title: remoteTitle(task), done: task.done });
  }
  // RF-TRK-06: new items in the tracker are only proposals.
  for (const r of remote) if (!linkedKeys.has(String(r.key))) plan.proposals.push({ remote: r, title: localTitleOf(r) });
  return plan;
}

/** Next free task id in a tasks.md. */
export function nextTaskId(tasks) {
  const n = tasks.reduce((max, t) => Math.max(max, Number(t.id.slice(1))), 0);
  return `T${n + 1}`;
}

/**
 * Local side of a sync: links of the items created in the tracker, pulled
 * changes, conflicts the user settled and proposals the user accepted.
 * Never touches the spec (RF-TRK-05). Returns the new tasks.md and base.
 * @param {{ provider: string, links?: Record<string, string>, conflicts?: Record<string, 'local' | 'remote'>, proposals?: string[], base?: object }} decisions
 */
export function applyLocal(text, plan, { provider, links = {}, conflicts = {}, proposals = [], base = {} }) {
  let out = text;
  for (const x of plan.create) if (links[x.task.id]) out = updateTaskLine(out, x.task.id, { link: `${provider}:${links[x.task.id]}` });
  for (const x of plan.pull) out = updateTaskLine(out, x.task.id, { title: x.title, done: x.done });
  for (const c of plan.conflicts) {
    if (conflicts[c.task.id] === 'remote') out = updateTaskLine(out, c.task.id, { title: localTitleOf(c.remote), done: Boolean(c.remote.done) });
  }
  let tasks = linkedTasks(out);
  for (const p of plan.proposals.filter((x) => proposals.includes(String(x.remote.key)))) {
    const id = nextTaskId(tasks);
    out = `${out.replace(/\n*$/, '\n')}- [${p.remote.done ? 'x' : ' '}] ${id} ${p.title} <!-- ${provider}:${p.remote.key} -->\n`;
    tasks = linkedTasks(out);
  }
  // Unsettled conflicts and items gone from the tracker keep their old base,
  // so the next sync asks again instead of picking a side.
  const pending = new Set([
    ...plan.conflicts.filter((c) => !conflicts[c.task.id]).map((c) => c.task.id),
    ...plan.missing.map((m) => m.task.id),
  ]);
  const nextBase = Object.fromEntries(tasks.filter((t) => t.link).map((t) => [
    t.id,
    pending.has(t.id) && base[t.id] ? base[t.id] : { title: t.title, done: t.done, key: t.link },
  ]));
  return { text: out, base: nextBase };
}
