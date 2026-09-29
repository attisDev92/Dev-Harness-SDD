// Component and stack detection from existing manifests (RF-INI-03, RF-INI-11).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { posix } from '../engine/text.js';

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', 'bin', 'obj', 'venv', '.venv', '__pycache__']);
const CONTAINERS = ['apps', 'packages', 'services', 'libs', 'modules'];

const FRONTEND = [
  ['next', 'next'], ['nuxt', 'nuxt'], ['@sveltejs/kit', 'sveltekit'], ['svelte', 'svelte'], ['@angular/core', 'angular'],
  ['vue', 'vue'], ['react', 'react'], ['solid-js', 'solid'], ['astro', 'astro'], ['@remix-run/react', 'remix'], ['vite', 'vite'],
];
const BACKEND = [
  ['@nestjs/core', 'nestjs'], ['express', 'express'], ['fastify', 'fastify'], ['koa', 'koa'], ['hono', 'hono'],
  ['@hapi/hapi', 'hapi'], ['@adonisjs/core', 'adonis'],
];
const DATABASE = [
  ['@prisma/client', 'prisma'], ['prisma', 'prisma'], ['drizzle-orm', 'drizzle'], ['typeorm', 'typeorm'], ['sequelize', 'sequelize'],
  ['knex', 'knex'], ['mongoose', 'mongodb'], ['pg', 'postgres'], ['postgres', 'postgres'], ['mysql2', 'mysql'], ['better-sqlite3', 'sqlite'],
];

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text == null) return null;
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORED_DIRS.has(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function listFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Package manager used in `dir` (or its ancestors up to `root`). */
export function packageManager(dir, root = dir) {
  let d = dir;
  for (;;) {
    if (existsSync(path.join(d, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(path.join(d, 'yarn.lock'))) return 'yarn';
    if (existsSync(path.join(d, 'bun.lockb')) || existsSync(path.join(d, 'bun.lock'))) return 'bun';
    if (existsSync(path.join(d, 'package-lock.json'))) return 'npm';
    if (path.resolve(d) === path.resolve(root)) return 'npm';
    const parent = path.dirname(d);
    if (parent === d) return 'npm';
    d = parent;
  }
}

const MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'composer.json', 'Cargo.toml', 'Gemfile'];

function manifestsIn(dir) {
  const files = listFiles(dir);
  const found = MANIFESTS.filter((m) => files.includes(m));
  const csproj = files.filter((f) => f.endsWith('.csproj'));
  return [...found, ...csproj];
}

/**
 * Analyses one directory. Returns null when it has no known manifest.
 * @returns {{ path: string, manifests: string[], kind: string, stack: string, frameworks: string[], ecosystems: string[], verify: Record<string,string>, workspaces: boolean } | null}
 */
export function analyzeDir(root, rel) {
  const dir = path.join(root, rel);
  const manifests = manifestsIn(dir);
  if (!manifests.length) return null;
  const frameworks = [];
  const databases = [];
  const ecosystems = [];
  const verify = {};
  let frontend = false;
  let backend = false;
  let workspaces = false;
  let typescript = false;

  const pkg = manifests.includes('package.json') ? readJson(path.join(dir, 'package.json')) : null;
  if (pkg) {
    ecosystems.push('node');
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    workspaces = Boolean(pkg.workspaces) || existsSync(path.join(dir, 'pnpm-workspace.yaml'));
    typescript = 'typescript' in deps || existsSync(path.join(dir, 'tsconfig.json'));
    for (const [dep, name] of FRONTEND) if (dep in deps && !frameworks.includes(name)) { frameworks.push(name); frontend = true; }
    if (frameworks.includes('next') || frameworks.includes('nuxt') || frameworks.includes('sveltekit')) {
      // Meta-frameworks imply their UI library; keep the name short.
      for (const implied of ['react', 'vue', 'svelte']) {
        const i = frameworks.indexOf(implied);
        if (i !== -1) frameworks.splice(i, 1);
      }
    }
    for (const [dep, name] of BACKEND) if (dep in deps && !frameworks.includes(name)) { frameworks.push(name); backend = true; }
    for (const [dep, name] of DATABASE) if (dep in deps && !databases.includes(name)) databases.push(name);
    if (databases.includes('prisma')) {
      const schema = readText(path.join(dir, 'prisma', 'schema.prisma')) ?? '';
      const provider = /provider\s*=\s*"(postgresql|mysql|sqlite|mongodb|sqlserver)"/.exec(schema)?.[1];
      if (provider) databases.push(provider === 'postgresql' ? 'postgres' : provider);
    }
    Object.assign(verify, nodeVerify(pkg.scripts ?? {}, packageManager(dir, root)));
  }

  const pyText = [readText(path.join(dir, 'pyproject.toml')), readText(path.join(dir, 'requirements.txt'))].filter(Boolean).join('\n').toLowerCase();
  if (pyText) {
    ecosystems.push('python');
    for (const name of ['django', 'fastapi', 'flask']) if (new RegExp(`\\b${name}\\b`).test(pyText)) { frameworks.push(name); backend = true; }
    if (/psycopg|asyncpg/.test(pyText)) databases.push('postgres');
    if (/sqlalchemy/.test(pyText)) databases.push('sqlalchemy');
    if (/\bpytest\b/.test(pyText) || existsSync(path.join(dir, 'tests'))) verify.test ??= 'pytest';
    if (/\bruff\b/.test(pyText)) verify.lint ??= 'ruff check .';
    if (/\bmypy\b/.test(pyText)) verify.typecheck ??= 'mypy .';
  }

  const goMod = manifests.includes('go.mod') ? readText(path.join(dir, 'go.mod')) : null;
  if (goMod != null) {
    ecosystems.push('go');
    for (const [mod, name] of [['gin-gonic/gin', 'gin'], ['labstack/echo', 'echo'], ['gofiber/fiber', 'fiber'], ['go-chi/chi', 'chi']]) {
      if (goMod.includes(mod)) frameworks.push(name);
    }
    backend = true;
    if (/jackc\/pgx|lib\/pq/.test(goMod)) databases.push('postgres');
    verify.lint ??= 'go vet ./...';
    verify.test ??= 'go test ./...';
  }

  const composer = manifests.includes('composer.json') ? readJson(path.join(dir, 'composer.json')) : null;
  if (composer) {
    ecosystems.push('php');
    const req = { ...composer.require, ...composer['require-dev'] };
    if ('laravel/framework' in req) frameworks.push('laravel');
    if (Object.keys(req).some((k) => k.startsWith('symfony/framework'))) frameworks.push('symfony');
    backend = true;
    if (composer.scripts?.test) verify.test ??= 'composer test';
  }

  const cargo = manifests.includes('Cargo.toml') ? readText(path.join(dir, 'Cargo.toml')) : null;
  if (cargo != null) {
    ecosystems.push('rust');
    for (const name of ['axum', 'actix-web', 'rocket']) if (new RegExp(`^\\s*${name}\\s*=`, 'm').test(cargo)) { frameworks.push(name); backend = true; }
    verify.lint ??= 'cargo clippy';
    verify.test ??= 'cargo test';
  }

  const gemfile = manifests.includes('Gemfile') ? readText(path.join(dir, 'Gemfile')) : null;
  if (gemfile != null) {
    ecosystems.push('ruby');
    if (/gem ['"]rails['"]/.test(gemfile)) { frameworks.push('rails'); backend = true; }
    if (existsSync(path.join(dir, 'spec'))) verify.test ??= 'bundle exec rspec';
  }

  const csproj = manifests.filter((m) => m.endsWith('.csproj'));
  if (csproj.length) {
    ecosystems.push('dotnet');
    const text = csproj.map((f) => readText(path.join(dir, f)) ?? '').join('\n');
    if (/Microsoft\.NET\.Sdk\.Web/.test(text)) { frameworks.push('aspnet'); backend = true; }
    verify.test ??= 'dotnet test';
  }

  const parts = [...new Set([...frameworks, ...databases])];
  if (typescript) parts.push('ts');
  const kind = frontend ? 'frontend' : backend ? 'backend' : databases.length && !frameworks.length && ecosystems.length === 1 && !pkg?.main ? 'db' : 'other';
  return {
    path: posix(rel) || '.',
    manifests,
    kind,
    stack: parts.join('+') || ecosystems.join('+'),
    frameworks,
    databases,
    ecosystems,
    typescript,
    verify,
    workspaces,
  };
}

const NO_TEST = /no test specified/;

function nodeVerify(scripts, pm) {
  const run = (name) => (pm === 'npm' ? (name === 'test' ? 'npm test' : `npm run ${name}`) : `${pm} ${name === 'test' ? 'test' : `run ${name}`}`);
  const pick = (...names) => names.find((n) => typeof scripts[n] === 'string' && !NO_TEST.test(scripts[n]));
  const out = {};
  const lint = pick('lint', 'lint:check');
  const typecheck = pick('typecheck', 'type-check', 'check-types', 'tsc', 'types');
  const test = pick('test', 'test:unit');
  const e2e = pick('e2e', 'test:e2e', 'e2e:test', 'playwright');
  if (lint) out.lint = run(lint);
  if (typecheck) out.typecheck = run(typecheck);
  if (test) out.test = run(test);
  if (e2e) out.e2e = run(e2e);
  return out;
}

/**
 * Finds components: the root and, for monorepos, child packages directly
 * under the root or under apps/, packages/, services/…
 */
export function detectComponents(root) {
  const rootInfo = analyzeDir(root, '');
  const candidates = [];
  for (const child of listDirs(root)) {
    if (CONTAINERS.includes(child)) {
      for (const inner of listDirs(path.join(root, child))) candidates.push(`${child}/${inner}`);
    } else {
      candidates.push(child);
    }
  }
  const children = candidates.map((rel) => analyzeDir(root, rel)).filter(Boolean);
  const components = [];
  const rootIsOnlyWorkspace = rootInfo && (rootInfo.workspaces || !rootInfo.frameworks.length) && children.length > 0;
  if (rootInfo && !rootIsOnlyWorkspace) components.push(rootInfo);
  components.push(...children);
  return { components, rootWorkspace: Boolean(rootInfo?.workspaces) };
}

/** Name declared by the component's manifest, if any. */
function declaredName(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  if (pkg?.name) return pkg.name;
  const composer = readJson(path.join(dir, 'composer.json'));
  if (composer?.name) return composer.name;
  for (const [file, re] of [['pyproject.toml', /^\s*name\s*=\s*"([^"]+)"/m], ['Cargo.toml', /^\s*name\s*=\s*"([^"]+)"/m], ['go.mod', /^module\s+(\S+)/m]]) {
    const m = re.exec(readText(path.join(dir, file)) ?? '');
    if (m) return m[1];
  }
  return null;
}

/** Component id: the name its manifest declares, else its folder. */
export function componentId(root, comp) {
  let base = comp.path === '.' ? path.basename(root) : comp.path.split('/').pop();
  const name = declaredName(path.join(root, comp.path));
  if (name) base = name.split('/').pop();
  const id = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '');
  return id || 'app';
}

/** RF-INI-05: proposed spec ID prefix, unique among `taken`. */
export function proposePrefix(id, taken = new Set()) {
  const words = id.split('-').filter(Boolean);
  let base = (words.length > 1 ? words.map((w) => w[0]).join('') : id.replace(/[^a-z0-9]/g, '').slice(0, 3)).toUpperCase();
  if (!/^[A-Z]/.test(base)) base = `C${base}`;
  if (base.length < 2) base = (base + 'X').slice(0, 2);
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}${n}`;
  return candidate;
}
