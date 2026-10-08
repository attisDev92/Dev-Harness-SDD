import assert from 'node:assert';
import test, { suite } from 'node:test';
import * as antigravity from '../src/generate/adapters/antigravity.js';

suite('Antigravity Adapter', () => {
  test('generates skills, workflows and hooks', () => {
    const ctx = {
      skills: {
        sdd: 'sdd skill content',
        'clean-code': 'clean code content'
      }
    };
    const { entries } = antigravity.generate({}, ctx);

    // Skills
    assert.ok(entries.some((e) => e.path === '.agents/skills/sdd/SKILL.md'));
    assert.ok(entries.some((e) => e.path === '.agents/skills/clean-code/SKILL.md'));

    // Workflows
    assert.ok(entries.some((e) => e.path === '.agents/workflows/sdd-status.md'));
    assert.ok(entries.some((e) => e.path === '.agents/workflows/sdd-next.md'));

    // Hooks
    const hooks = entries.find((e) => e.path === '.agents/hooks.json');
    assert.ok(hooks);
    assert.ok(hooks.appends['sdd-guards.PreToolUse']);
    assert.ok(hooks.appends['sdd-guards.PostToolUse']);
    assert.ok(hooks.appends['sdd-guards.Stop']);
    assert.deepStrictEqual(hooks.enforces, antigravity.RULES);
  });
});
