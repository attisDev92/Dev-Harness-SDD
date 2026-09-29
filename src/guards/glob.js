// Minimal glob matcher for the guards (dependency-free).
// Supports **, *, ?, {a,b} and [...] classes over POSIX-style relative paths.
// Patterns without a slash match the file name at any depth, like .gitignore.

const cache = new Map();

export function globToRegExp(pattern) {
  const key = pattern;
  if (cache.has(key)) return cache.get(key);
  let p = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const anchored = p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  let re = '';
  let braces = 0;
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        const slashAfter = p[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { re += '(?:'; braces += 1; }
    else if (c === '}' && braces) { re += ')'; braces -= 1; }
    else if (c === ',' && braces) re += '|';
    else if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else { re += '[' + p.slice(i + 1, end).replace(/^!/, '^') + ']'; i = end; }
    } else re += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  const regex = new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}$`);
  cache.set(key, regex);
  return regex;
}

export function matchesAny(relPath, patterns) {
  const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return patterns.some((pattern) => globToRegExp(pattern).test(p));
}
