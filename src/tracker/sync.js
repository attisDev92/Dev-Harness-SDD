// Two-way sync between tasks.md and a tracker (RF-TRK-01, 04..07). Pure
// planning: given local tasks, remote issues and the last synced state, it
// decides what goes where and what needs the user's choice.

const LINK_RE = /\s*<!--\s*(github|linear|notion|jira):([^\s>]+)\s*-->/;
const TASK_LINE = /^(\s*- \[)( |x|X)(\] )(T\d+)(\b\s*)(.*)$/;

/** Title of the task as shown in the tracker: "T3 Login API". */
export const remoteTitle = (task) => `${task.id} ${task.title}`;
const localTitleOf = (remote) => remote.title.replace(/^T\d+\s+/, '');

/** Tasks of a tasks.md with their tracker link (RF-TRK-01). */
export function linkedTasks(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    const m = TASK_LINE.exec(line);
    if (!m) return;
    const link = LINK_RE.exec(line);
    const title = m[6].replace(LINK_RE, '').split(/\s+·\s+/)[0].trim();
    out.push({ id: m[4], done: m[2] !== ' ', title, link: link ? link[2] : null, line: index });
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
 * @param {{ tasks: object[], remote: { key: string, number: number, title: string, done: boolean }[], base: Record<string, { title: string, done: boolean, key: string }>, provider: string }} input
 * @returns {{ push: object[], pull: object[], create: object[], conflicts: object[], proposals: object[], missing: object[] }}
 */
export function planSync({ tasks, remote, base, provider }) {
  const byKey = new Map(remote.map((r) => [r.key, r]));
  const linkedKeys = new Set();
  const plan = { push: [], pull: [], create: [], conflicts: [], proposals: [], missing: [] };
  for (const task of tasks) {
    if (!task.link) {
      plan.create.push({ task, title: remoteTitle(task) });
      continue;
    }
    const key = task.link.replace(`${provider}:`, '');
    linkedKeys.add(key);
    const r = byKey.get(key);
    if (!r) {
      // Edge case 20: deleted in the tracker; never deleted locally.
      plan.missing.push({ task, key });
      continue;
    }
    const b = base[task.id] ?? { title: task.title, done: task.done };
    const localChanged = task.title !== b.title || task.done !== b.done;
    const remoteChanged = localTitleOf(r) !== b.title || r.done !== b.done;
    const differs = task.title !== localTitleOf(r) || task.done !== r.done;
    if (!differs) continue;
    if (localChanged && remoteChanged) plan.conflicts.push({ task, remote: r });
    else if (remoteChanged) plan.pull.push({ task, remote: r, title: localTitleOf(r), done: r.done });
    else plan.push.push({ task, remote: r, title: remoteTitle(task), done: task.done });
  }
  // RF-TRK-06: new items in the tracker are only proposals.
  for (const r of remote) if (!linkedKeys.has(r.key)) plan.proposals.push({ remote: r, title: localTitleOf(r) });
  return plan;
}

/** Next free task id in a tasks.md. */
export function nextTaskId(tasks) {
  const n = tasks.reduce((max, t) => Math.max(max, Number(t.id.slice(1))), 0);
  return `T${n + 1}`;
}
