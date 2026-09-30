// Answers to the two stops of the flow (RF-SDD-13, RF-GAT-08). The user
// approves by talking; no command is needed. Pure functions. Dependency-free.

const YES = [
  'ok', 'okay', 'okey', 'vale', 'si', 'sí', 'yes', 'dale', 'listo', 'perfecto', 'de acuerdo', 'adelante', 'sigue',
  'continua', 'continúa', 'continuar', 'continue', 'go', 'go ahead', 'aprobado', 'aprobada', 'apruebo', 'approved', 'approve',
  'lgtm', 'correcto', 'bien', 'genial', 'todo bien', 'hazlo', 'procede', 'proceed',
];
const YES_RE = new RegExp(`^(?:${YES.map((w) => w.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
// "sí, pero cambia X" is a request for changes, not an approval.
const BUT_RE = /\b(pero|but|aunque|excepto|except|salvo|cambia|change|falta|missing|no\s)/i;

/**
 * @returns {{ approved: boolean, text: string } | null} null when the message
 *   does not look like an answer at all.
 */
export function parseDecision(prompt) {
  const p = String(prompt ?? '').trim();
  if (!p) return null;
  const legacy = /^\/sdd:(approve|reject)\b\s*([\s\S]*)$/i.exec(p);
  if (legacy) return { approved: legacy[1].toLowerCase() === 'approve', text: legacy[2].trim() };
  const m = YES_RE.exec(p);
  if (m) {
    const rest = p.slice(m[0].length).replace(/^[\s.,:;!¡-]+/, '').trim();
    return BUT_RE.test(rest) ? { approved: false, text: p } : { approved: true, text: rest };
  }
  return { approved: false, text: p };
}
