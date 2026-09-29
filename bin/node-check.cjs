'use strict';
// Node.js version gate (RF-INS-06). Written in ES5 so that it parses on any
// Node.js version and can report the problem instead of crashing.

function parse(version) {
  var m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version));
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : [0, 0, 0];
}

function minVersion(range) {
  return parse(range).join('.');
}

function satisfies(current, min) {
  var a = parse(current);
  var b = parse(min);
  for (var i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

function message(current, min, env) {
  var lang = String((env && (env.HARNESS_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG)) || '').toLowerCase();
  if (lang.indexOf('en') !== 0) {
    return 'sdd-harness necesita Node.js ' + min + ' o superior (tienes ' + current + '). Actualiza Node.js e inténtalo de nuevo.';
  }
  return 'sdd-harness requires Node.js ' + min + ' or newer (you have ' + current + '). Please upgrade Node.js and try again.';
}

module.exports = { parse: parse, minVersion: minVersion, satisfies: satisfies, message: message };
