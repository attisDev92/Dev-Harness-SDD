// The `harness init` interview (RF-INI-01..12, RF-CNV-02, RF-CNV-03). It only
// builds a configuration object; nothing is written here.

import { TOOLS, TOPOLOGIES, DESIGN_SOURCES, TRACKERS, COMPONENT_KINDS } from '../config/schema.js';
import { DEFAULT_DOCS_WHITELIST } from '../guards/project.js';

const PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const LANG_KEYS = ['code', 'specs', 'docs', 'commits', 'ui'];
const VERIFY_KEYS = ['lint', 'typecheck', 'test', 'e2e'];

const choices = (values, labels = {}) => values.map((value) => ({ value, label: labels[value] ?? value }));
const splitList = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function askPrefix(p, t, id, proposal, taken) {
  for (let i = 0; i < 3; i += 1) {
    const value = (await p.text(`prefix:${id}`, t.q.prefix(id), { default: proposal })).trim().toUpperCase();
    if (PREFIX_RE.test(value) && !taken.has(value)) return value;
    p.say(t.q.prefixInvalid);
  }
  return proposal;
}

/**
 * @param {{ detected: object, prompter: import('./prompt.js').Prompter, t: object, lang: string, version: string, preset?: { tools?: string[], mode?: string } }} input
 */
export async function runInterview({ detected, prompter: p, t, lang, version, preset = {} }) {
  p.say(t.q.intro(detected.root));

  // Topology (RF-INI-02, edge cases 3 and 4).
  if (detected.ambiguous) p.say(t.q.ambiguous(detected.childRepos));
  const topology = preset.topology ?? (await p.select('topology', t.q.topology, choices(TOPOLOGIES, t.topologyLabels), { default: detected.topology ?? 'single' }));
  let comps = [...detected.components];
  if (detected.ambiguous && topology === 'monorepo') {
    for (const repo of detected.childRepos) {
      const keep = await p.confirm(`nested:${repo}`, t.q.nestedRepo(repo), { default: true });
      if (!keep) comps = comps.filter((c) => c.path !== repo && !c.path.startsWith(`${repo}/`));
    }
  }

  // Components, stack, prefixes and verification commands (RF-INI-03, 05, 11).
  if (!comps.length) {
    p.say(t.q.noComponents);
    const path = await p.text('componentPath', t.q.componentPath, { default: '.' });
    const kind = await p.select('componentKind', t.q.kind(path), choices(COMPONENT_KINDS, t.kindLabels), { default: 'other' });
    const stack = await p.text('componentStack', t.q.stack, { default: '' });
    comps = [{ path, kind, stack, id: path === '.' ? 'app' : path.split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-'), id_prefix: 'APP', verify: {} }];
  } else {
    p.say(t.q.componentsFound);
    for (const c of comps) p.say(`  - ${c.id}: ${c.path} · ${c.stack || '?'} · ${t.kindLabels[c.kind] ?? c.kind}`);
  }
  const components = {};
  const taken = new Set();
  for (const c of comps) {
    if (comps.length > 1 && !(await p.confirm(`component:${c.id}`, t.q.includeComponent(c.id, c.path), { default: true }))) continue;
    const kind = await p.select(`kind:${c.id}`, t.q.kind(c.id), choices(COMPONENT_KINDS, t.kindLabels), { default: c.kind });
    const prefix = await askPrefix(p, t, c.id, taken.has(c.id_prefix) ? `${c.id_prefix}2` : c.id_prefix, taken);
    taken.add(prefix);
    let verify = { ...c.verify };
    const shown = VERIFY_KEYS.map((k) => `${k}: ${verify[k] ?? '—'}`).join(' · ');
    if (!(await p.confirm(`verify:${c.id}`, t.q.verify(c.id, shown), { default: true }))) {
      verify = {};
      for (const k of VERIFY_KEYS) {
        const cmd = (await p.text(`verify:${c.id}:${k}`, t.q.verifyCommand(k), { default: c.verify?.[k] ?? '' })).trim();
        if (cmd) verify[k] = cmd;
      }
    }
    components[c.id] = {
      path: c.path,
      id_prefix: prefix,
      ...(c.stack ? { stack: c.stack } : {}),
      kind,
      ...(Object.keys(verify).length ? { verify } : {}),
    };
  }

  // Tools (RF-INI-04).
  let tools = preset.tools;
  while (!tools?.length) {
    tools = await p.multiselect('tools', t.q.tools, choices(TOOLS), { default: detected.tools.length ? detected.tools : ['claude-code'] });
    if (!tools.length) p.say(t.q.toolsRequired);
  }

  // Conventions and languages (RF-CNV-02, RF-CNV-03).
  const conv = detected.conventions;
  p.say(t.q.conventionsFound(conv));
  const accept = await p.confirm('conventions', t.q.conventionsOk, { default: true });
  let commits = conv.commits;
  if (!accept || !commits) {
    commits = await p.select('commits', t.q.commits, choices(['conventional', 'gitmoji', 'custom'], t.commitLabels), { default: commits ?? 'conventional' });
  }
  const language = {};
  for (const key of LANG_KEYS) {
    const detectedValue = accept ? conv.languages[key] : undefined;
    if (detectedValue) { language[key] = detectedValue; continue; }
    const def = conv.languages[key] ?? (key === 'code' || key === 'commits' ? 'en' : lang);
    language[key] = key === 'specs' || key === 'docs'
      ? await p.select(`lang:${key}`, t.q.language(key), choices(['es', 'en'], t.langLabels), { default: def === 'es' ? 'es' : 'en' })
      : (await p.text(`lang:${key}`, t.q.language(key), { default: def })).trim().toLowerCase();
  }

  // Design, tracker, gates, mode and artifacts (RF-INI-06..10).
  const hasFrontend = Object.values(components).some((c) => c.kind === 'frontend');
  const design = hasFrontend ? await p.select('design', t.q.design, choices(DESIGN_SOURCES, t.designLabels), { default: 'none' }) : 'none';
  const tracker = await p.select('tracker', t.q.tracker, choices(['none', ...TRACKERS], t.trackerLabels), { default: 'none' });
  const manual = await p.select('manualTest', t.q.manualTest, choices(['task', 'story', 'spec'], t.manualLabels), { default: 'task' });
  const mode = preset.mode ?? (await p.select('installMode', t.q.installMode, choices(['local', 'team'], t.modeLabels), { default: 'local' }));
  const artifacts = await p.select('artifacts', t.q.artifacts, choices(['versioned', 'local'], t.artifactLabels), { default: mode === 'team' ? 'versioned' : 'local' });

  // Universal safety net (RF-VER-03, RF-VER-06).
  const gitHooks = await p.confirm('gitHooks', t.q.gitHooks, { default: true });
  const ci = await p.select('ci', t.q.ci, choices(['none', 'github'], t.ciLabels), { default: 'none' });

  // Protected zones (RF-INI-12).
  const protectedZones = structuredClone(detected.protected);
  p.say(t.q.protectedFound);
  for (const [cat, globs] of Object.entries(protectedZones)) p.say(`  - ${cat}: ${globs.join(', ')}`);
  if (!(await p.confirm('protectedOk', t.q.protectedOk, { default: true }))) {
    for (const cat of Object.keys(protectedZones)) {
      protectedZones[cat] = splitList(await p.text(`protected:${cat}`, t.q.protectedEdit(cat), { default: protectedZones[cat].join(', ') }));
    }
  }

  return {
    harness_version: version,
    install_mode: mode,
    cli: { language: lang },
    tools,
    language,
    conventions: {
      commits,
      ...(commits === 'custom' && conv.commitsNote ? { commits_note: conv.commitsNote } : {}),
      ...(conv.style.length ? { style: conv.style } : {}),
      ...(conv.sources.length ? { sources: conv.sources } : {}),
    },
    topology,
    components,
    design: { source: design },
    tracker: tracker === 'none' ? { enabled: false } : { enabled: true, provider: tracker },
    gates: { manual_test: manual, commits: 'human-only', deps: 'ask' },
    retries: { in_scope: 2, protected: 0 },
    protected: protectedZones,
    docs_whitelist: [...DEFAULT_DOCS_WHITELIST],
    artifacts: { versioned: artifacts === 'versioned' },
    git_hooks: { enabled: gitHooks },
    ci: { provider: ci },
  };
}
