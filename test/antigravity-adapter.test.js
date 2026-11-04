import assert from 'node:assert';
import test, { suite } from 'node:test';
import * as antigravity from '../src/generate/adapters/antigravity.js';

suite('Antigravity Adapter', () => {
  test('generates the always-on rule, skills, workflows and hooks', () => {
    const ctx = {
      skills: {
        sdd: 'sdd skill content',
        'clean-code': 'clean code content'
      }
    };
    const { entries } = antigravity.generate({}, ctx);
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));

    // The rule Antigravity loads on every turn: frontmatter trigger, under its 12 000-character limit.
    const rule = byPath['.agents/rules/sdd-harness.md'];
    assert.ok(rule);
    assert.match(rule.content, /^---\ntrigger: always_on\n---\n/);
    assert.ok(rule.content.length < 12000);
    assert.match(rule.content, /sdd\.js brief <TID>/);
    assert.match(rule.content, /Nunca más de 2 subagentes a la vez/);
    assert.match(rule.content, /se registran y se cuentan en el resumen/);

    // Skills and role skills
    assert.ok(byPath['.agents/skills/sdd/SKILL.md']);
    assert.ok(byPath['.agents/skills/clean-code/SKILL.md']);
    assert.ok(byPath['.agents/skills/role-reviewer/SKILL.md']);

    // Workflows: the same shortcuts as Claude Code, delegating with invoke_subagent.
    for (const w of ['status', 'next', 'decisions', 'pause', 'resume']) assert.ok(byPath[`.agents/workflows/sdd-${w}.md`], w);
    assert.match(byPath['.agents/workflows/sdd-next.md'].content, /invoke_subagent/);
    assert.match(byPath['.agents/workflows/sdd-next.md'].content, /brief verbatim/);
    assert.doesNotMatch(byPath['.agents/workflows/sdd-spec.md'].content, /\$ARGUMENTS/);

    // Hooks
    const hooks = byPath['.agents/hooks.json'];
    assert.ok(hooks);
    assert.ok(hooks.appends['sdd-guards.PreToolUse']);
    assert.ok(hooks.appends['sdd-guards.PostToolUse']);
    assert.ok(hooks.appends['sdd-guards.Stop']);
    assert.deepStrictEqual(hooks.enforces, antigravity.RULES);
  });

  test('the rule, the role skills and the workflows follow orchestration.max_parallel and gates.decisions', () => {
    const config = { orchestration: { max_parallel: 3 }, gates: { decisions: 'interview' }, components: { api: { path: 'api', kind: 'backend' } } };
    const { entries } = antigravity.generate(config, { skills: {} });
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    assert.match(byPath['.agents/rules/sdd-harness.md'].content, /Nunca más de 3 subagentes a la vez/);
    assert.match(byPath['.agents/rules/sdd-harness.md'].content, /se entrevista al usuario/);
    assert.match(byPath['.agents/skills/role-architect/SKILL.md'].content, /3 subagents at once at most/);
    assert.match(byPath['.agents/workflows/sdd-next.md'].content, /Never more than 3 subagents/);
  });
});
