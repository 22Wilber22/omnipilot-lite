import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsageState, recordProviderUsage, isBudgetExceeded } from '../src/metrics/usageTracker.js';
import { createRun, startRun, publicRun } from '../src/orchestrator/orchestrator.js';

let tempDirs = [];
async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'omnipilot-usage-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('usageTracker — presupuesto local por proveedor', () => {
  it('inicia sin uso (idle) y mantiene verifier en 0 tokens', () => {
    const state = createUsageState({ codex: 1000, antigravity: 500 });
    expect(state.codex.level).toBe('idle');
    expect(state.codex.pct).toBe(0);
    expect(state.verifier.tokens).toBe(0);
  });

  it('clasifica verde (1-64%), amarillo (65-84%), rojo (85-99%) y límite (100%)', () => {
    const state = createUsageState({ codex: 1000 });
    recordProviderUsage(state, 'codex', 400);
    expect(state.codex.level).toBe('low');
    expect(state.codex.pct).toBe(40);

    recordProviderUsage(state, 'codex', 300);
    expect(state.codex.level).toBe('medium');
    expect(state.codex.pct).toBe(70);

    recordProviderUsage(state, 'codex', 200);
    expect(state.codex.level).toBe('high');
    expect(state.codex.pct).toBe(90);

    recordProviderUsage(state, 'codex', 150);
    expect(state.codex.level).toBe('limit');
    expect(state.codex.pct).toBe(100);
    expect(isBudgetExceeded(state, 'codex')).toBe(true);
  });

  it('marca unavailable si el proveedor no reporta usage (sin inventar datos)', () => {
    const state = createUsageState({ antigravity: 1000 });
    recordProviderUsage(state, 'antigravity', null);
    expect(state.antigravity.level).toBe('unavailable');
    expect(state.antigravity.tokens).toBeNull();
    expect(state.antigravity.pct).toBe(0);
  });

  it('detiene pasos futuros del proveedor cuando se alcanza 100% del presupuesto local y no expone secretos', async () => {
    const root = await makeTempDir();
    let codexCalls = 0;
    const fakeCodex = {
      async run(_p, ctx) {
        codexCalls += 1;
        await writeFile(join(ctx.workspace, 'password.js'), 'export function validatePassword(){return false;}\n');
        return { ok: true, code: 0, output: 'done', ms: 4, cancelled: false, usage: { totalTokens: 1000 } };
      },
    };
    const run = createRun('Probar corte por presupuesto', 'codex', { type: 'template' }, { codex: 1000 });
    await startRun(run, root, { codex: fakeCodex, antigravityValidated: false });

    expect(run.status).toBe('failed');
    expect(codexCalls).toBe(1);
    expect(run.usage.codex.limitReached).toBe(true);
    expect(run.memory.problems.join(' ')).toMatch(/Presupuesto local alcanzado/i);
    expect(JSON.stringify(publicRun(run))).not.toContain('X-Omni-Token');
  });
});
