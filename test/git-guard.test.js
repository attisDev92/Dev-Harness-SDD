// RF-GAT-01, RF-GAT-02 and edge case 10 (evasion of the commit block).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { checkCommand, scanCode } from '../src/guards/git-guard.js';
import { tempDir, git } from './helpers.js';

const noAliases = { aliases: {} };
const blocked = (cmd, opts = noAliases) => checkCommand(cmd, opts).decision === 'block';

test('RF-GAT-01: every history or remote changing git command is blocked', () => {
  for (const cmd of [
    'git commit -m "x"',
    'git commit --amend --no-edit',
    'git push',
    'git push --force origin main',
    'git reset --hard HEAD~1',
    'git reset --soft HEAD^',
    'git rebase main',
    'git rebase -i HEAD~3',
    'git merge feature',
    'git pull',
    'git cherry-pick abc1234',
    'git revert HEAD',
    'git tag v1.0.0',
    'git tag -a v1 -m "release"',
    'git tag -d v1',
    'git stash drop',
    'git stash clear',
    'git branch -D feature',
    'git branch --delete --force feature',
    'git branch -f main HEAD~2',
    'git am patch.mbox',
    'git update-ref refs/heads/main HEAD~1',
    'git commit-tree HEAD^{tree} -m x',
    'git filter-branch --force',
    'git checkout -B main origin/main',
    'git switch -C main',
    'git reflog expire --expire=now --all',
  ]) {
    assert.ok(blocked(cmd), `expected block: ${cmd}`);
  }
});

test('RF-GAT-01: read-only and working-tree git commands are allowed', () => {
  for (const cmd of [
    'git status',
    'git diff --stat',
    'git log --oneline -5',
    'git show HEAD',
    'git add src/app.ts',
    'git stash',
    'git stash list',
    'git stash push -m wip',
    'git branch',
    'git branch -a',
    'git branch -d merged-branch',
    'git tag',
    'git tag -l "v*"',
    'git tag --list',
    'git reset',
    'git reset HEAD',
    'git reset -- src/app.ts',
    'git fetch origin',
    'git checkout -- file.txt',
    'git switch main',
    'git rev-parse --show-toplevel',
    'git --version',
    'git -C sub status',
    'echo "remember to git commit later"',
    'grep -r "git push" docs',
    'npm test',
    'ls -la',
  ]) {
    assert.equal(checkCommand(cmd, noAliases).decision, 'allow', `expected allow: ${cmd}`);
  }
});

test('RF-GAT-01: the verdict names the blocked command', () => {
  const v = checkCommand('npm test && git commit -m wip', noAliases);
  assert.equal(v.decision, 'block');
  assert.equal(v.kind, 'gitBlocked');
  assert.equal(v.match, 'git commit -m wip');
});

test('RF-GAT-02: chained commands (&&, ||, ;, |, &, newlines, subshells)', () => {
  for (const cmd of [
    'npm test && git commit -m x',
    'false || git push',
    'echo a; git commit -m x',
    'git log | git commit -F -',
    'sleep 1 & git push',
    'echo a\ngit commit -m x',
    '(cd sub && git commit -m x)',
    '{ git push; }',
    'if true; then git commit -m x; fi',
    'for f in a; do git push; done',
    'echo $(git commit -m x)',
    'echo `git push`',
    'echo "$(git commit -m x)"',
    'diff <(git push) a',
    'git add . && git commit -m "feat: x" && git push',
    'npm test 2>&1 | tee log.txt; git commit -m x',
    'git commit -m x > out.txt 2>&1',
  ]) {
    assert.ok(blocked(cmd), `expected block: ${JSON.stringify(cmd)}`);
  }
});

test('RF-GAT-02: wrapped in another shell (bash -c, cmd /c, powershell)', () => {
  const encoded = Buffer.from('git commit -m x', 'utf16le').toString('base64');
  for (const cmd of [
    'bash -c "git commit -m x"',
    "sh -c 'git push'",
    'bash -lc "npm test && git push"',
    'zsh -c "git commit -am x"',
    'busybox sh -c "git push"',
    'cmd /c git commit -m x',
    'cmd.exe /C "git push"',
    'cmd /s /c "npm test && git commit -m x"',
    'powershell -Command "git commit -m x"',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "git push"',
    'pwsh -c "git commit -m x"',
    `powershell -EncodedCommand ${encoded}`,
    `pwsh -enc ${encoded}`,
    'powershell "git push"',
    "bash -c \"bash -c 'git commit -m x'\"",
    'eval "git commit -m x"',
    'eval git push',
    'Invoke-Expression "git commit -m x"',
    'iex "git push"',
    'echo "git commit -m x" | bash',
    "printf 'git push' | sh",
    'Write-Output "git push" | iex',
    "echo 'git commit -m x' | powershell -Command -",
    'env git commit -m x',
    'env -i PATH=/usr/bin git push',
    'sudo git push',
    'sudo -u bob git commit -m x',
    'nohup git push &',
    'time git commit -m x',
    'timeout 10 git push',
    'nice -n 5 git commit -m x',
    'exec git push',
    'command git commit -m x',
    'winpty git commit -m x',
    'xargs git commit -m x < files.txt',
    'echo commit | xargs git',
    'find . -name x -exec git commit -m x {} ;',
    'start /b git push',
    '& git commit -m x',
    '& "C:\\Program Files\\Git\\cmd\\git.exe" commit -m x',
    'Start-Process git -ArgumentList "commit -m x"',
    "Start-Process -FilePath git.exe -ArgumentList 'push','origin'",
  ]) {
    assert.ok(blocked(cmd), `expected block: ${JSON.stringify(cmd)}`);
  }
});

test('RF-GAT-02: alternative spellings of the git executable', () => {
  for (const cmd of [
    '/usr/bin/git commit -m x',
    'C:\\Git\\cmd\\git.exe push',
    '"C:\\Program Files\\Git\\bin\\git.exe" commit -m x',
    'GIT.EXE push',
    "g'i't commit -m x",
    'g"it" push',
    'g\\it commit -m x',
    'g^it push',
    "$'\\x67it' commit -m x",
    "$'\\147it' push",
    'git-commit -m x',
    'hub push',
    'git --no-pager -c user.name=x -C . commit -m x',
    'git --git-dir=.git --work-tree=. push',
    'GIT_AUTHOR_NAME=x git commit -m x',
  ]) {
    assert.ok(blocked(cmd), `expected block: ${JSON.stringify(cmd)}`);
  }
});

test('RF-GAT-02: variables and substitutions (edge case 10)', () => {
  for (const cmd of [
    'G=git; $G commit -m x',
    'G=git && ${G} push',
    'export G=git; $G push',
    'C=commit; git $C -m x',
    'set G=git && %G% commit -m x',
    '$g = "git"; & $g commit -m x',
    '$g="git"; & $g push',
    '$env:G = "git"; & $env:G push',
    'Set-Variable -Name g -Value git; & $g push',
    '$(which git) commit -m x',
    '`command -v git` push',
    '$(printf gi)t commit -m x',
    '"$(where git)" push',
    '$UNKNOWN_BIN commit -m x',
    'git $SUBCOMMAND',
  ]) {
    assert.ok(blocked(cmd), `expected block: ${JSON.stringify(cmd)}`);
  }
  assert.equal(checkCommand('X=1; echo $X', noAliases).decision, 'allow');
});

test('RF-GAT-02: git aliases (configured and inline)', () => {
  const aliases = { ci: 'commit', p: 'push', save: '!git add -A && git commit -m wip', st: 'status', sh: '!sh -c "git push"', ci2: 'ci' };
  for (const cmd of ['git ci -m x', 'git p', 'git save', 'git sh', 'git ci2 -m x', 'git -c alias.zz=commit zz -m x', "git -c 'alias.yy=!git push' yy"]) {
    assert.ok(blocked(cmd, { aliases }), `expected block: ${cmd}`);
  }
  assert.equal(checkCommand('git st', { aliases }).decision, 'allow');
  assert.equal(checkCommand('git unknown-alias', { aliases }).decision, 'allow');
});

test('RF-GAT-02: aliases are read from the real git configuration', (t) => {
  const dir = tempDir(t);
  git(dir, 'init', '-q');
  git(dir, 'config', 'alias.ship', 'push origin HEAD');
  git(dir, 'config', 'alias.lg', 'log --oneline');
  assert.equal(checkCommand('git ship', { cwd: dir }).decision, 'block');
  assert.equal(checkCommand('git lg', { cwd: dir }).decision, 'allow');
});

test('RF-GAT-02: intermediate scripts, package scripts and npx (edge case 10)', (t) => {
  const dir = tempDir(t);
  mkdirSync(path.join(dir, 'scripts'));
  writeFileSync(path.join(dir, 'scripts', 'release.sh'), '#!/bin/sh\nnpm test\ngit commit -am release\n');
  writeFileSync(path.join(dir, 'scripts', 'ok.sh'), '#!/bin/sh\nnpm test\n');
  writeFileSync(path.join(dir, 'deploy.ps1'), 'Write-Host "hi"\r\n& git push origin main\r\n');
  writeFileSync(path.join(dir, 'ship.cmd'), '@echo off\r\ngit commit -m x\r\n');
  writeFileSync(path.join(dir, 'noext'), '#!/usr/bin/env bash\ngit push\n');
  writeFileSync(path.join(dir, 'c.js'), "const { execSync } = require('child_process');\nexecSync('git commit -m x');\n");
  writeFileSync(path.join(dir, 's.mjs'), "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['push', 'origin']);\n");
  writeFileSync(path.join(dir, 'lib.js'), "import simpleGit from 'simple-git';\nawait simpleGit().commit('x');\n");
  writeFileSync(path.join(dir, 'p.py'), "import subprocess\nsubprocess.run(['git', 'commit', '-m', 'x'])\n");
  writeFileSync(path.join(dir, 'safe.js'), "console.log('hello');\n");
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      scripts: {
        test: 'node safe.js',
        release: 'npm test && git push --follow-tags',
        prebuild: 'git commit -am prebuild',
        build: 'node safe.js',
        chain: 'npm run release',
        lint: 'node safe.js',
      },
    }),
  );
  const opts = { cwd: dir, aliases: {} };
  for (const cmd of [
    'bash scripts/release.sh',
    'sh ./scripts/release.sh',
    './scripts/release.sh',
    'source scripts/release.sh',
    '. scripts/release.sh',
    'cat scripts/release.sh | bash',
    'pwsh -File deploy.ps1',
    'powershell -ExecutionPolicy Bypass -File .\\deploy.ps1',
    '.\\deploy.ps1',
    'ship.cmd',
    'cmd /c ship.cmd',
    './noext',
    'node c.js',
    'node s.mjs',
    'node lib.js',
    'python p.py',
    'python3 -u p.py',
    'npm run release',
    'npm run build',
    'npm run chain',
    'pnpm release',
    'yarn release',
    'bun run release',
    'npm --prefix . run release',
    'node -e "require(\'child_process\').execSync(\'git commit -m x\')"',
    'node --eval="require(\'child_process\').execSync(\'git push\')"',
    "python -c \"import os; os.system('git push')\"",
    'npx git-cz',
    'npx --yes semantic-release',
    'npx standard-version@9',
    'npx -c "git commit -m x"',
    'npm exec -- git commit -m x',
    'pnpm dlx release-it',
    'npm version patch',
    'pnpm version minor',
    'yarn version --patch',
    'npx lerna version',
    'npx changeset publish',
  ]) {
    assert.ok(blocked(cmd, opts), `expected block: ${cmd}`);
  }
  for (const cmd of ['bash scripts/ok.sh', 'npm test', 'npm run lint', 'node safe.js', 'npx prettier --check .', 'npm version', 'npm version patch --no-git-tag-version', 'bash missing.sh']) {
    assert.equal(checkCommand(cmd, opts).decision, 'allow', `expected allow: ${cmd}`);
  }
});

test('remote-changing forge commands are blocked', () => {
  for (const cmd of ['gh pr merge 12', 'gh pr create --fill', 'gh release create v1', 'gh repo sync', 'gh api -X POST repos/o/r/merges', 'glab mr merge 3']) {
    assert.ok(blocked(cmd), `expected block: ${cmd}`);
  }
  for (const cmd of ['gh pr view 12', 'gh pr list', 'gh api repos/o/r/pulls', 'gh issue list']) {
    assert.equal(checkCommand(cmd, noAliases).decision, 'allow', `expected allow: ${cmd}`);
  }
});

test('deeply nested wrappers fail safe', () => {
  let cmd = 'git status';
  for (let i = 0; i < 12; i += 1) cmd = `bash -c ${JSON.stringify(cmd)}`;
  assert.equal(checkCommand(cmd, noAliases).decision, 'block');
});

test('code scanner ignores unrelated mentions', () => {
  assert.equal(scanCode("console.log('digit commits')"), null);
  assert.equal(scanCode("const gitCommit = 'abc'"), null);
  assert.ok(scanCode("execFileSync('git', ['-C', dir, 'commit', '-m', 'x'])"));
});

test('RNF-08: the git guard decides in under 300 ms', () => {
  const start = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) {
    checkCommand('npm test && bash -c "echo ok | cat" && git status && git log --oneline', noAliases);
  }
  const perCall = Number(process.hrtime.bigint() - start) / 1e6 / 20;
  assert.ok(perCall < 300, `took ${perCall} ms`);
});
