// Everything `init` detects before the interview (RF-INI-02, 03, 05, 11, 12).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { childRepos, gitTopLevel, isRepoRoot } from '../engine/git.js';
import { detectComponents, componentId, proposePrefix } from './stack.js';
import { detectConventions } from './conventions.js';

const TOOL_MARKERS = {
  'claude-code': ['CLAUDE.md', 'CLAUDE.local.md', '.claude'],
  opencode: ['opencode.json', 'opencode.jsonc', '.opencode'],
  codex: ['.codex'],
  antigravity: ['.agents/workflows', '.agent'],
};

/**
 * Topology proposal. `ambiguous` is set when the root is a git repository
 * that also contains child repositories (edge cases 3 and 4).
 */
export function detectTopology(root) {
  const isRepo = isRepoRoot(root) || gitTopLevel(root) !== null;
  const repos = childRepos(root);
  if (!isRepo && repos.length) return { topology: 'workspace', isRepo, childRepos: repos, ambiguous: false };
  if (!isRepo) return { topology: null, isRepo, childRepos: [], ambiguous: false };
  return { topology: null, isRepo, childRepos: repos, ambiguous: repos.length > 0 };
}

const LOCKFILES = {
  node: ['**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/bun.lock', '**/bun.lockb'],
  python: ['**/poetry.lock', '**/uv.lock', '**/Pipfile.lock'],
  go: ['**/go.sum'],
  rust: ['**/Cargo.lock'],
  php: ['**/composer.lock'],
  ruby: ['**/Gemfile.lock'],
  dotnet: ['**/packages.lock.json'],
};
const DEP_SECTIONS = {
  node: ['package.json#dependencies', 'package.json#devDependencies', 'package.json#peerDependencies', 'package.json#optionalDependencies'],
  python: ['pyproject.toml#dependencies', '**/requirements*.txt'],
  go: ['**/go.mod'],
  rust: ['Cargo.toml#dependencies'],
  php: ['composer.json#require'],
  ruby: ['**/Gemfile'],
  dotnet: ['**/*.csproj'],
};

/** RF-INI-12: protected zones proposed for the detected stack. */
export function proposeProtected(components) {
  const ecosystems = new Set(components.flatMap((c) => c.ecosystems ?? []));
  const databases = new Set(components.flatMap((c) => c.databases ?? []));
  const typescript = components.some((c) => c.typescript);
  const deps = [...ecosystems].flatMap((e) => [...(DEP_SECTIONS[e] ?? []), ...(LOCKFILES[e] ?? [])]);
  const db = ['**/migrations/**', '**/*.sql'];
  if (databases.has('prisma')) db.push('**/schema.prisma');
  if (databases.has('drizzle')) db.push('**/drizzle/**');
  if (ecosystems.has('python')) db.push('**/alembic/**');
  const architecture = ['**/Dockerfile*', '**/docker-compose*.y*ml', '**/.env*', '.github/workflows/**', '**/eslint.config.*', '**/.eslintrc*'];
  if (typescript) architecture.unshift('**/tsconfig*.json');
  if (components.some((c) => c.frameworks?.includes('vite'))) architecture.push('**/vite.config.*');
  if (components.some((c) => c.frameworks?.includes('next'))) architecture.push('**/next.config.*');
  return {
    deps,
    db,
    contracts: ['**/specs/**/contracts/**'],
    architecture,
    security: ['**/auth/**', '**/*.auth.*', '**/security/**', '**/*cors*', '**/*csp*'],
  };
}

function detectTools(root) {
  return Object.entries(TOOL_MARKERS)
    .filter(([, markers]) => markers.some((m) => existsSync(path.join(root, m))))
    .map(([tool]) => tool);
}

/** Full detection report used as defaults by the interview. */
export function detectProject(root) {
  const topo = detectTopology(root);
  const { components: found, rootWorkspace } = detectComponents(root);
  const taken = new Set();
  const ids = new Set();
  const components = found.map((c) => {
    let id = componentId(root, c);
    for (let n = 2; ids.has(id); n += 1) id = `${componentId(root, c)}-${n}`;
    ids.add(id);
    const id_prefix = proposePrefix(id, taken);
    taken.add(id_prefix);
    return { ...c, id, id_prefix };
  });
  let topology = topo.topology;
  // A repository that contains other repositories is proposed as several repos
  // (the interview still asks: edge case 3).
  if (!topology && topo.isRepo) topology = topo.ambiguous ? 'multi-repo' : components.length > 1 || rootWorkspace ? 'monorepo' : 'single';
  const conventions = detectConventions(root, components.map((c) => c.path));
  return {
    root,
    ...topo,
    topology,
    components,
    tools: detectTools(root),
    conventions,
    protected: proposeProtected(components),
  };
}
