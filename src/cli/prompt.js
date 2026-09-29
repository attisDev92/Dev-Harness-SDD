// Line-based prompts without dependencies. They work the same on a terminal
// and with piped input, so the interview is scriptable and testable.
// End of input or Ctrl+C cancels (RF-INI-17): the caller writes nothing.

import readline from 'node:readline';

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.code = 'ECANCELLED';
  }
}

/**
 * Every question has an `id` so tests (and the scripted prompter) can answer
 * by name instead of by position.
 * @typedef {{ value: string, label?: string }} Choice
 * @typedef {{
 *   text(id: string, question: string, opts?: { default?: string }): Promise<string>,
 *   confirm(id: string, question: string, opts?: { default?: boolean }): Promise<boolean>,
 *   select(id: string, question: string, choices: Choice[], opts?: { default?: string }): Promise<string>,
 *   multiselect(id: string, question: string, choices: Choice[], opts?: { default?: string[] }): Promise<string[]>,
 *   say(text: string): void,
 *   close(): void,
 * }} Prompter
 */

/** @returns {Prompter} */
export function createLinePrompter({ input = process.stdin, output = process.stdout, t } = {}) {
  const rl = readline.createInterface({ input, terminal: false });
  const queue = [];
  const waiting = [];
  let ended = false;
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next.resolve(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift().reject(new CancelledError());
  });
  const onSigint = () => {
    ended = true;
    while (waiting.length) waiting.shift().reject(new CancelledError());
  };
  process.on('SIGINT', onSigint);

  const nextLine = (question) => {
    output.write(question);
    if (queue.length) return Promise.resolve(queue.shift());
    if (ended) return Promise.reject(new CancelledError());
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };
  const invalid = () => output.write(`${t?.promptInvalid ?? 'Invalid answer, try again.'}\n`);

  const listChoices = (choices) => choices.map((c, i) => `  ${i + 1}) ${c.label ?? c.value}`).join('\n');
  const pick = (answer, choices) => {
    const a = answer.trim();
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1].value;
    return choices.find((c) => c.value.toLowerCase() === a.toLowerCase())?.value;
  };

  return {
    async text(_id, question, { default: def } = {}) {
      const answer = (await nextLine(`${question}${def ? ` [${def}]` : ''}: `)).trim();
      return answer === '' ? def ?? '' : answer;
    },
    async confirm(_id, question, { default: def = true } = {}) {
      const yes = t?.yesKeys ?? ['y', 'yes', 's', 'si', 'sí'];
      const no = t?.noKeys ?? ['n', 'no'];
      for (;;) {
        const answer = (await nextLine(`${question} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
        if (answer === '') return def;
        if (yes.includes(answer)) return true;
        if (no.includes(answer)) return false;
        invalid();
      }
    },
    async select(_id, question, choices, { default: def } = {}) {
      const defIndex = Math.max(0, choices.findIndex((c) => c.value === def));
      for (;;) {
        const answer = await nextLine(`${question}\n${listChoices(choices)}\n> [${defIndex + 1}] `);
        if (answer.trim() === '') return choices[defIndex].value;
        const value = pick(answer, choices);
        if (value !== undefined) return value;
        invalid();
      }
    },
    async multiselect(_id, question, choices, { default: def = [] } = {}) {
      const defLabel = def.map((v) => choices.findIndex((c) => c.value === v) + 1).filter((n) => n > 0).join(',');
      for (;;) {
        const answer = await nextLine(`${question}\n${listChoices(choices)}\n> [${defLabel}] `);
        if (answer.trim() === '') return [...def];
        const values = answer.split(/[,\s]+/).filter(Boolean).map((a) => pick(a, choices));
        if (values.length && values.every((v) => v !== undefined)) return [...new Set(values)];
        invalid();
      }
    },
    say(text) {
      output.write(`${text}\n`);
    },
    close() {
      process.off('SIGINT', onSigint);
      rl.close();
    },
  };
}

/**
 * Prompter answering from a map of id → answer; unanswered questions take
 * their default. Used by `--yes` (empty map) and by tests.
 * @returns {Prompter & { asked: string[] }}
 */
export function createScriptedPrompter(answers = {}, { cancelAt, output } = {}) {
  const asked = [];
  const answer = (id, def) => {
    asked.push(id);
    if (id === cancelAt) throw new CancelledError();
    if (!Object.hasOwn(answers, id)) return def;
    // A function answers the same question differently each time it is asked.
    return typeof answers[id] === 'function' ? answers[id]() : answers[id];
  };
  return {
    asked,
    async text(id, _q, { default: def = '' } = {}) { return answer(id, def); },
    async confirm(id, _q, { default: def = true } = {}) { return answer(id, def); },
    async select(id, _q, choices, { default: def } = {}) { return answer(id, def ?? choices[0].value); },
    async multiselect(id, _q, _choices, { default: def = [] } = {}) { return answer(id, def); },
    say(text) { output?.write(`${text}\n`); },
    close() {},
  };
}
