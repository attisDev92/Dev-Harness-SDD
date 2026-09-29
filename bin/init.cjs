#!/usr/bin/env node
'use strict';
// `sdd-harness-init [options]` is a shortcut for `sdd-harness init [options]`.
process.argv.splice(2, 0, 'init');
require('./harness.cjs');
