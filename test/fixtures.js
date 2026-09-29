// Project fixtures built on the fly (criterion 3 of the spec) and an
// in-process runner for the CLI.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { main } from '../src/cli/main.js';
import { createScriptedPrompter } from '../src/cli/prompt.js';
import { tempDir } from './helpers.js';

export function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
}

export function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=dev@example.com', '-c', 'user.name=Dev', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

export function initRepo(dir, { commit = true, messages = ['chore: initial commit'] } = {}) {
  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  if (commit) {
    git(dir, 'add', '-A');
    for (const m of messages) git(dir, 'commit', '-q', '--allow-empty', '-m', m);
  }
}

/**
 * Every file with its content. Inside .git only what the harness may touch
 * (info/exclude and config) is compared: git writes the rest on its own,
 * sometimes in the background (auto gc, info/refs).
 */
export function snapshot(root) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      const inGit = /(^|\/)\.git(\/|$)/.test(rel);
      if (e.isDirectory()) {
        if (!inGit) out[`${rel}/`] = 'dir';
        walk(full);
      } else if (!inGit || /(^|\/)\.git\/(info\/exclude|config)$/.test(rel)) {
        out[rel] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return out;
}

export const FIXTURES = {
  /** Only a frontend: React + Vite + TypeScript, npm. */
  frontend(t) {
    const root = tempDir(t);
    write(root, {
      'package.json': { name: 'shop-web', scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run', 'test:e2e': 'playwright test' }, dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^6.0.0', typescript: '^5.6.0' } },
      'package-lock.json': '{}\n',
      'index.html': '<!doctype html><html lang="en"><body></body></html>\n',
      'src/main.tsx': 'export {};\n',
      'README.md': '# Shop\n\nThis is the web shop for the store. It is used by the customers to browse and buy the products that are in stock, and it is built with React.\n',
    });
    initRepo(root, { messages: ['feat: shop', 'fix: cart', 'feat(ui): header', 'docs: readme', 'chore: deps'] });
    return root;
  },

  /** Monorepo: Next.js web + NestJS/Prisma API, pnpm workspaces. */
  monorepo(t) {
    const root = tempDir(t);
    write(root, {
      'package.json': { name: 'clinic', private: true, workspaces: ['apps/*'] },
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'apps/web/package.json': { name: 'web', scripts: { lint: 'next lint', test: 'vitest run' }, dependencies: { next: '^15.0.0', react: '^19.0.0' }, devDependencies: { typescript: '^5.6.0' } },
      'apps/api/package.json': { name: 'api', scripts: { test: 'jest', 'test:e2e': 'jest -c e2e' }, dependencies: { '@nestjs/core': '^11.0.0', '@prisma/client': '^6.0.0' } },
      'apps/api/prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n}\n',
      'README.md': '# Clínica\n\nEste es el sistema de la clínica para la gestión de las citas y de los pacientes que se atienden en el centro, con una web y una API.\n',
    });
    initRepo(root);
    return root;
  },

  /** Workspace: a plain folder with two repositories. */
  workspace(t) {
    const root = tempDir(t);
    write(root, {
      'api/go.mod': 'module example.com/api\n\ngo 1.23\n\nrequire github.com/go-chi/chi/v5 v5.1.0\n',
      'api/main.go': 'package main\n',
      'web/package.json': { name: 'web', dependencies: { vue: '^3.5.0' }, scripts: { test: 'vitest' } },
    });
    initRepo(path.join(root, 'api'));
    initRepo(path.join(root, 'web'));
    return root;
  },

  /** Several repos: the root is a repo that also contains another one. */
  multiRepo(t) {
    const root = tempDir(t);
    write(root, {
      'pyproject.toml': '[project]\nname = "svc"\ndependencies = ["fastapi", "psycopg"]\n[tool.ruff]\n',
      'tests/test_app.py': 'def test_ok():\n    assert True\n',
      'client/package.json': { name: 'client', dependencies: { svelte: '^5.0.0' } },
    });
    initRepo(path.join(root, 'client'));
    initRepo(root);
    return root;
  },

  /** Existing agent configuration, conventions and a git hooks manager. */
  existingConfig(t) {
    const root = tempDir(t);
    write(root, {
      'package.json': { name: 'legacy', scripts: { test: 'node --test' }, dependencies: { express: '^5.0.0' }, commitlint: { extends: ['@commitlint/config-conventional'] } },
      'AGENTS.md': '# Team rules\n\nUse 2 spaces. Commit messages in English.\n',
      'CLAUDE.md': '# Claude\n\nRead AGENTS.md.\n',
      'CONTRIBUTING.md': '# Contributing\n\nOpen a pull request.\n',
      '.editorconfig': 'root = true\n[*]\nindent_style = space\nindent_size = 2\n',
      '.husky/pre-commit': 'npm test\n',
      'src/index.js': 'export {};\n',
    });
    initRepo(root);
    git(root, 'config', 'core.hooksPath', '.husky');
    return root;
  },
};

/** Runs the CLI in-process. `answers` feed the scripted prompter by question id. */
export async function run(argv, { cwd, answers, cancelAt, fs, env = {} } = {}) {
  let stdout = '';
  let stderr = '';
  const output = { write: (s) => { stdout += s; } };
  const io = {
    stdout: output,
    stderr: { write: (s) => { stderr += s; } },
    env: { ...process.env, HARNESS_LANG: 'en', NO_COLOR: '1', ...env },
    cwd,
    readStdin: async () => '',
    fs,
    prompter: answers || cancelAt ? createScriptedPrompter(answers ?? {}, { cancelAt, output }) : undefined,
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
