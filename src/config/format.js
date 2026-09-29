// Rendering and writing of harness.config.yaml.

import { stringify } from 'yaml';

export function formatPath(p, rootLabel = '(root)') {
  if (!p.length) return rootLabel;
  return p.map((seg, i) => (typeof seg === 'number' ? `[${seg}]` : i === 0 ? seg : `.${seg}`)).join('');
}

/** Issues as { path, code, message, line, col } in the CLI language. */
export function describeIssues(issues, t) {
  return issues.map((i) => ({
    path: formatPath(i.path, t.root),
    code: i.code,
    message: t.issue[i.code]?.(i.params ?? {}) ?? i.code,
    line: i.line,
    col: i.col,
  }));
}

export function issueLines(issues, t, shown) {
  return describeIssues(issues, t).map((i) => `  ${i.line ? `${shown}:${i.line}:${i.col}` : shown}  ${i.path}: ${i.message}`);
}

const HEADER = '# sdd-harness configuration. Edit it and run "sdd-harness sync" to apply the changes.\n# Reference: README.md → Configuration.\n';

/** RF-INI-14: the configuration as written by init (LF, stable key order). */
export function serializeConfig(config) {
  return HEADER + stringify(config, { lineWidth: 0, indent: 2 });
}
