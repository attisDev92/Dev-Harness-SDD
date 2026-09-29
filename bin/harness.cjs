#!/usr/bin/env node
'use strict';

var check = require('./node-check.cjs');
var pkg = require('../package.json');

var current = process.env.HARNESS_TEST_NODE_VERSION || process.versions.node;
var min = check.minVersion(pkg.engines.node);
if (!check.satisfies(current, min)) {
  process.stderr.write(check.message(current, min, process.env) + '\n');
  process.exit(1);
}

import('../src/cli/main.js').then(
  function (cli) {
    return cli.main(process.argv.slice(2));
  }
).then(
  function (code) {
    process.exitCode = code || 0;
  },
  function (err) {
    process.stderr.write(String((err && err.stack) || err) + '\n');
    process.exitCode = 1;
  }
);
