// RF-INS-01 end to end: pack the repo, install it globally into a throwaway
// prefix and run `harness`. Needs the npm registry, so it is opt-in:
//   HARNESS_TEST_INSTALL=1 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, tempDir } from './helpers.js';

const npm = (args, cwd) =>
  spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });

test('RF-INS-01: npm install -g exposes the harness command', { skip: !process.env.HARNESS_TEST_INSTALL }, (t) => {
  const dir = tempDir(t, 'harness-install-');
  const pack = npm(['pack', ROOT, '--pack-destination', dir, '--silent'], dir);
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = path.join(dir, pack.stdout.trim().split(/\r?\n/).pop());
  const prefix = path.join(dir, 'prefix');
  const install = npm(['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tarball], dir);
  assert.equal(install.status, 0, install.stderr);
  const bin = process.platform === 'win32' ? path.join(prefix, 'sdd-harness.cmd') : path.join(prefix, 'bin', 'sdd-harness');
  const run = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
