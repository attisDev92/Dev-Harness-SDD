import assert from 'node:assert/strict';
import test, { suite } from 'node:test';
import * as antigravity from '../src/generate/adapters/antigravity.js';
import * as claudeCode from '../src/generate/adapters/claude-code.js';

suite('Antigravity Adapter', () => {
  test('RF-AGH-01/02 & RF-AGN-01..05: generates rules, orchestrator + subagents with Gemini 4 model equivalence, /sdd-* skills, mcp_config and hooks.json', () => {
    // Direct equivalence with Claude Code's 4 tiers:
    assert.deepEqual(claudeCode.DEFAULT_MODELS, { orchestrator: 'opus', high: 'opus', mid: 'sonnet', low: 'haiku' });
    assert.deepEqual(antigravity.DEFAULT_MODELS, {
      orchestrator: 'gemini-4-neon-high',
      high: 'gemini-4-carbon-high',
      mid: 'gemini-4-hydrogen-high',
      low: 'gemini-4-hydrogen-low',
    });

    const config = {
      topology: 'monorepo',
      design: { source: 'figma' },
      tracker: { enabled: true, provider: 'linear', project: 'APP' },
      components: {
        web: { path: 'apps/web', kind: 'frontend', stack: 'react+ts', verify: { test: 'npm test' } },
        api: { path: 'apps/api', kind: 'backend', stack: 'nestjs+postgres', verify: { test: 'npm test' } },
      },
    };
    const ctx = {
      skills: {
        sdd: '---\nname: sdd\ndescription: flow\n---\nsdd skill content\n',
        'clean-code': '---\nname: clean-code\ndescription: clean\n---\nclean code content\n',
        'backend-architecture': '---\nname: backend-architecture\ndescription: arch\n---\narch content\n',
      },
      installedSkills: [{ name: 'test-driven-development', roles: ['frontend-dev', 'backend-dev'] }],
    };
    const { entries } = antigravity.generate(config, ctx);
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));

    // Always-on rule: frontmatter trigger + description, Gemini 4 model mapping, under 24 KB.
    const rule = byPath['.agents/rules/sdd-harness.md'];
    assert.ok(rule);
    assert.match(rule.content, /^---\ntrigger: always_on\ndescription: ".+"\n---\n/);
    assert.ok(rule.content.length < 24000);
    assert.match(rule.content, /gemini-4-neon-high/);
    assert.match(rule.content, /gemini-4-carbon-high.*Model: "pro"/);
    assert.match(rule.content, /gemini-4-hydrogen-high.*Model: "flash"/);
    assert.match(rule.content, /gemini-4-hydrogen-low.*Model: "flash_lite"/);
    assert.match(rule.content, /sdd\.js brief <TID>/);
    assert.match(rule.content, /Nunca más subagentes a la vez de los que indica `next`/);
    assert.match(rule.content, /se registran y se cuentan en el resumen/);
    assert.match(rule.content, /termina tu turno sin llamar más herramientas/);
    assert.match(rule.content, /brain\//);

    // RF-AGN-03: glob rules for sub-directory components.
    assert.match(byPath['.agents/rules/component-web.md'].content, /^---\ntrigger: glob\nglobs: "\*\*\/apps\/web\/\*\*"\n/);
    assert.match(byPath['.agents/rules/component-api.md'].content, /^---\ntrigger: glob\nglobs: "\*\*\/apps\/api\/\*\*"\n/);

    // Primary orchestrator agent (Neon High, mainAgent: true, subagent: false)
    const orch = byPath['.agents/agents/sdd-orchestrator.md'].content;
    assert.match(orch, /mainAgent: true\nsubagent: false/);
    assert.match(orch, /Target model: gemini-4-neon-high/);

    // RF-AGN-01: specialized subagents with valid frontmatter enums AND concrete Gemini 4 targets.
    for (const r of ['spec-reviewer', 'architect', 'frontend-dev', 'backend-dev', 'qa-tester', 'reviewer', 'debugger', 'doc-writer']) {
      assert.ok(byPath[`.agents/agents/${r}.md`], r);
      assert.equal(byPath[`.agents/skills/role-${r}/SKILL.md`], undefined, 'deprecated role-* skills are replaced by custom agents');
    }
    const architect = byPath['.agents/agents/architect.md'].content;
    assert.match(architect, /subagent: true\nmainAgent: false\nmodel: "pro"/);
    assert.match(architect, /Target model: gemini-4-carbon-high \(tier: high · invoke_subagent Model: "pro"\)/);

    const reviewer = byPath['.agents/agents/reviewer.md'].content;
    assert.match(reviewer, /model: "pro"/);
    assert.doesNotMatch(reviewer, /edit_file|write_file/, 'read-only role cannot edit files');

    // Implementers and QA run on Hydrogen High (`flash`), NOT `inherit`, so they do not burn Neon quota when the orchestrator is Neon.
    const backend = byPath['.agents/agents/backend-dev.md'].content;
    assert.match(backend, /model: "flash"/);
    assert.match(backend, /Target model: gemini-4-hydrogen-high \(tier: mid · invoke_subagent Model: "flash"\)/);
    assert.match(backend, /- edit_file\n  - write_file\n  - run_command/);
    assert.match(backend, /skills:\n  - skills\/clean-code\n  - skills\/backend-architecture\n  - skills\/test-driven-development/);

    assert.match(byPath['.agents/agents/qa-tester.md'].content, /Target model: gemini-4-hydrogen-high/);
    const docWriter = byPath['.agents/agents/doc-writer.md'].content;
    assert.match(docWriter, /model: "flash"/);
    assert.match(docWriter, /Target model: gemini-4-hydrogen-low \(tier: low · invoke_subagent Model: "flash_lite"\)/);

    // RF-AGN-02: /sdd-<cmd> slash-command skills instead of deprecated .agents/workflows/*.md.
    assert.equal(entries.some((e) => e.path.startsWith('.agents/workflows/')), false);
    for (const w of ['status', 'spec', 'next', 'docs', 'review', 'validate', 'commit', 'decisions', 'pause', 'resume', 'tracker']) {
      assert.ok(byPath[`.agents/skills/sdd-${w}/SKILL.md`], w);
    }
    assert.match(byPath['.agents/skills/sdd-next/SKILL.md'].content, /invoke_subagent/);
    assert.match(byPath['.agents/skills/sdd-next/SKILL.md'].content, /brief verbatim/);
    assert.doesNotMatch(byPath['.agents/skills/sdd-spec/SKILL.md'].content, /\$ARGUMENTS/);
    assert.doesNotMatch(byPath['.agents/skills/sdd-pause/SKILL.md'].content, /\/sdd:resume/);
    assert.match(byPath['.agents/skills/sdd-pause/SKILL.md'].content, /\/sdd-resume/);

    // RF-AGN-04: Figma Streamable HTTP MCP server without legacy `type: "http"`.
    const mcp = byPath['.agents/mcp_config.json'];
    assert.deepEqual(mcp.values, { 'mcpServers.figma': { url: 'https://mcp.figma.com/mcp' } });

    // RF-AGH-01/02: hooks run from .agents/ via ../.harness, grouped only on Pre/PostToolUse, flat on lifecycle events.
    const hooks = byPath['.agents/hooks.json'];
    assert.ok(hooks);
    assert.deepEqual(hooks.enforces, antigravity.RULES);
    const pre = hooks.appends['sdd-guards.PreToolUse'][0];
    assert.match(pre.matcher, /write_file/);
    assert.match(pre.matcher, /edit_file/);
    assert.match(pre.matcher, /run_command/);
    assert.match(pre.matcher, /invoke_subagent/);
    assert.equal(pre.hooks[0].command, 'node ../.harness/scripts/hook.js PreToolUse');
    assert.equal(hooks.appends['sdd-guards.UserPromptSubmit'], undefined);
    for (const ev of ['SessionStart', 'PreInvocation', 'PostInvocation', 'Stop']) {
      const flat = hooks.appends[`sdd-guards.${ev}`];
      assert.equal(flat.length, 1, ev);
      assert.equal(flat[0].hooks, undefined, `${ev} must be a flat handler object, not wrapped in { hooks }`);
      assert.equal(flat[0].command, `node ../.harness/scripts/hook.js ${ev}`);
    }
  });

  test('supports per-tier and per-role model overrides, gates.decisions and local mode tracked files', () => {
    const config = {
      install_mode: 'local',
      orchestration: { max_parallel: 3 },
      gates: { decisions: 'interview' },
      models: {
        antigravity: {
          orchestrator: 'gemini-4-neon-high',
          high: 'gemini-4-carbon-high',
          debugger: 'gemini-4-neon-xhigh',
          mid: 'inherit',
          low: 'gemini-4-hydrogen-low',
        },
      },
      components: { api: { path: '.', kind: 'backend' } },
    };
    const { entries, notices } = antigravity.generate(config, { skills: {}, tracked: new Set(['.agents/hooks.json']) });
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    const rule = byPath['.agents/rules/sdd-harness.md'].content;
    assert.match(rule, /Nunca más subagentes a la vez de los que indica `[^`]*next`/);
    assert.match(rule, /agents <1-4>/);
    assert.match(rule, /se entrevista al usuario/);
    assert.match(rule, /gemini-4-neon-high/);
    assert.equal(byPath['.agents/rules/component-api.md'], undefined, 'root component already covered by AGENTS.md');
    assert.equal(byPath['.agents/agents/frontend-dev.md'], undefined, 'no frontend component');
    assert.match(byPath['.agents/agents/architect.md'].content, /Target model: gemini-4-carbon-high/);
    assert.match(byPath['.agents/agents/debugger.md'].content, /Target model: gemini-4-neon-xhigh \(tier: high · invoke_subagent Model: "pro"\)/);
    assert.match(byPath['.agents/agents/backend-dev.md'].content, /model: "inherit"/);
    assert.equal(byPath['.agents/hooks.json'], undefined, 'committed hooks.json is not modified in local mode');
    assert.deepEqual(notices.map((n) => n.code), ['toolNeedsTeam']);
    for (const e of entries.filter((x) => typeof x.content === 'string')) {
      assert.doesNotMatch(e.content, /\b3 subagent|3 subagentes/, `${e.path} must not embed the project limit`);
    }
  });
});
