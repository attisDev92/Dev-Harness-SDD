// Detection of the conventions a project already declares (RF-CNV-01..03, RF-CNV-06).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { recentCommitSubjects, gitTopLevel } from '../engine/git.js';

export const CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CONTRIBUTING.md', '.editorconfig'];

const STYLE_FILES = [
  [/^\.prettierrc|^prettier\.config\./, 'Prettier'],
  [/^eslint\.config\.|^\.eslintrc/, 'ESLint'],
  [/^biome\.jsonc?$/, 'Biome'],
  [/^\.stylelintrc|^stylelint\.config\./, 'Stylelint'],
  [/^ruff\.toml$|^\.ruff\.toml$/, 'Ruff'],
  [/^\.golangci\.ya?ml$/, 'golangci-lint'],
  [/^rustfmt\.toml$|^\.rustfmt\.toml$/, 'rustfmt'],
  [/^\.rubocop\.yml$/, 'RuboCop'],
  [/^phpcs\.xml|^\.php-cs-fixer/, 'PHP-CS'],
];

const COMMITLINT = /^(commitlint\.config\.|\.commitlintrc|\.czrc$|\.cz\.(json|toml|ya?ml)$)/;
const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|test|tests|ci|build|perf|style|revert)(\([^)]*\))?!?:\s/;
const GITMOJI = /^(:[a-z0-9_+-]+:|\p{Extended_Pictographic})/u;

const STOPWORDS = {
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'para', 'con', 'una', 'por', 'es', 'se', 'como', 'al', 'lo', 'más', 'este'],
  en: ['the', 'and', 'of', 'to', 'is', 'for', 'with', 'that', 'this', 'in', 'on', 'it', 'be', 'are', 'as', 'by', 'from', 'an', 'or', 'you'],
};

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 'es', 'en' or undefined when the text gives no clear signal. */
export function detectTextLanguage(text, minHits = 12) {
  const words = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .toLowerCase()
    .match(/\p{L}+/gu) ?? [];
  const score = { es: 0, en: 0 };
  const sets = { es: new Set(STOPWORDS.es), en: new Set(STOPWORDS.en) };
  for (const w of words) {
    if (sets.es.has(w)) score.es += 1;
    if (sets.en.has(w)) score.en += 1;
  }
  const total = score.es + score.en;
  if (total < minHits) return undefined;
  if (score.es / total >= 0.65) return 'es';
  if (score.en / total >= 0.65) return 'en';
  return undefined;
}

const LANG_WORDS = { english: 'en', inglés: 'en', ingles: 'en', spanish: 'es', español: 'es', espanol: 'es', castellano: 'es' };

/** Explicit declarations such as "commit messages in English" or "código en inglés". */
function declaredLanguages(text) {
  const out = {};
  const lw = '(english|spanish|inglés|ingles|español|espanol|castellano)';
  const rules = [
    ['commits', new RegExp(`(commit(?: messages?)?|commits|mensajes de commit)[^.\\n]{0,30}?\\b(?:in|en)\\s+${lw}`, 'i')],
    ['code', new RegExp(`(code|identifiers|código|codigo|identificadores)[^.\\n]{0,30}?\\b(?:in|en)\\s+${lw}`, 'i')],
    ['docs', new RegExp(`(docs|documentation|documentación|documentacion)[^.\\n]{0,30}?\\b(?:in|en)\\s+${lw}`, 'i')],
    ['ui', new RegExp(`(ui|user interface|interfaz)[^.\\n]{0,30}?\\b(?:in|en)\\s+${lw}`, 'i')],
  ];
  for (const [key, re] of rules) {
    const m = re.exec(text);
    if (m) out[key] = LANG_WORDS[m[2].toLowerCase()];
  }
  return out;
}

function uiLanguage(root, componentPaths) {
  for (const comp of componentPaths) {
    for (const rel of ['index.html', 'public/index.html', 'src/app/layout.tsx', 'app/layout.tsx', 'src/index.html']) {
      const text = read(path.join(root, comp, rel));
      const m = text && /<html[^>]*\blang=["']([a-z]{2})/i.exec(text);
      if (m) return m[1].toLowerCase();
    }
  }
  return undefined;
}

/**
 * @param {string} root
 * @param {string[]} componentPaths
 * @returns {{ sources: string[], languages: Record<string, string|undefined>, commits?: string, commitsNote?: string, style: string[] }}
 */
export function detectConventions(root, componentPaths = ['.']) {
  const sources = [];
  const texts = [];
  for (const f of CONTEXT_FILES) {
    const text = read(path.join(root, f));
    if (text == null) continue;
    sources.push(f);
    if (f.endsWith('.md')) texts.push(text);
  }

  const style = [];
  const rootFiles = safeList(root);
  const dirs = [...new Set(['.', ...componentPaths])];
  for (const dir of dirs) {
    for (const file of safeList(path.join(root, dir))) {
      const hit = STYLE_FILES.find(([re]) => re.test(file));
      const rel = dir === '.' ? file : `${dir}/${file}`;
      if (hit && !style.includes(hit[1])) { style.push(hit[1]); sources.push(rel); }
    }
  }
  const editorconfig = read(path.join(root, '.editorconfig'));
  if (editorconfig) {
    const indent = /indent_style\s*=\s*(\w+)/.exec(editorconfig)?.[1];
    const size = /indent_size\s*=\s*(\d+)/.exec(editorconfig)?.[1];
    if (indent) style.unshift(`indent: ${size ? `${size} ` : ''}${indent}`);
  }

  // Commit convention: tooling, then written guidance, then history.
  let commits;
  let commitsNote;
  const pkg = safeJson(path.join(root, 'package.json'));
  if (rootFiles.some((f) => COMMITLINT.test(f)) || pkg?.commitlint || pkg?.config?.commitizen) commits = 'conventional';
  const contributing = read(path.join(root, 'CONTRIBUTING.md')) ?? '';
  const allText = [...texts].join('\n');
  if (!commits && /conventional commits/i.test(allText)) commits = 'conventional';
  if (!commits && /gitmoji/i.test(allText)) commits = 'gitmoji';
  const subjects = gitTopLevel(root) ? recentCommitSubjects(root, 50) : [];
  if (!commits && subjects.length >= 5) {
    const ratio = (re) => subjects.filter((s) => re.test(s)).length / subjects.length;
    if (ratio(CONVENTIONAL) >= 0.6) commits = 'conventional';
    else if (ratio(GITMOJI) >= 0.6) commits = 'gitmoji';
  }
  if (!commits) {
    const section = /^#+\s*(commit[^\n]*|mensajes? de commit[^\n]*)\n([\s\S]*?)(?=^#|$(?![\s\S]))/im.exec(contributing);
    if (section && section[2].trim()) {
      commits = 'custom';
      commitsNote = 'CONTRIBUTING.md';
    }
  }

  const declared = declaredLanguages(allText);
  const docsLang = detectTextLanguage([read(path.join(root, 'README.md')), contributing, ...texts].filter(Boolean).join('\n'));
  const commitsLang = subjects.length >= 5 ? detectTextLanguage(subjects.join('\n'), 8) : undefined;
  const languages = {
    code: declared.code,
    specs: declared.docs ?? docsLang,
    docs: declared.docs ?? docsLang,
    commits: declared.commits ?? commitsLang,
    ui: declared.ui ?? uiLanguage(root, componentPaths),
  };
  return { sources: [...new Set(sources)], languages, commits, commitsNote, style };
}

function safeList(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
