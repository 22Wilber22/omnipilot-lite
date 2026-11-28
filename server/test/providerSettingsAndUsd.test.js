import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsStore } from '../src/memory/settingsStore.js';
import { DEFAULT_BUDGETS } from '../src/metrics/usageTracker.js';
import { canAgentRun } from '../src/orchestrator/router.js';
import { createRun, startRun } from '../src/orchestrator/orchestrator.js';
import { createApp } from '../src/api/app.js';

let tempDirs = [];
let servers = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'omnipilot-settings-usd-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  servers = [];
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Tarea 3 (segura) — settingsStore estricto, snapshot por run y tope USD', () => {
  it('carga settings.json viejo con defaults y PUT /api/settings rechaza capabilities, id desconocido, negativos o campos extra con 400', async () => {
    const dir = await makeTempDir();
    const settingsPath = join(dir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ chatProvider: 'auto', chatModel: null, chatStyle: 'fast' }), 'utf8');

    const store = createSettingsStore(settingsPath);
    const loaded = await store.get();
    expect(loaded.providers.codex).toEqual({ enabled: true, usdPer1kTokens: 0, tokenBudget: DEFAULT_BUDGETS.codex });
    expect(loaded.providers.antigravity).toEqual({ enabled: true, usdPer1kTokens: 0, tokenBudget: DEFAULT_BUDGETS.antigravity });
    expect(loaded.runBudgetUsd).toBeNull();

    const port = 4780 + Math.floor(Math.random() * 180);
    const token = 'tok-strict-settings';
    const app = createApp({
      token,
      port,
      workspacesDir: join(dir, 'ws'),
      conversationsDir: join(dir, 'conv'),
      settingsPath,
    });
    const server = await new Promise(resolve => {
      const s = app.listen(port, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    const base = `http://127.0.0.1:${port}`;
    const headers = { 'X-Omni-Token': token, 'Content-Type': 'application/json' };

    const badPayloads = [
      { providers: { antigravity: { capabilities: ['code-write'], allowedPermissions: ['workspace-write'] } } },
      { providers: { unknown: { enabled: true } } },
      { providers: { codex: { usdPer1kTokens: -1 } } },
      { providers: { codex: { tokenBudget: 0 } } },
      { runBudgetUsd: -5 },
      { extraField: true },
    ];
    for (const payload of badPayloads) {
      const res = await fetch(`${base}/api/settings`, { method: 'PUT', headers, body: JSON.stringify(payload) });
      expect(res.status).toBe(400);
    }
  });

  it('antigravity enabled:false impide fallback aunque esté disponible y validado (log provider_disabled)', async () => {
    const root = await makeTempDir();
    let agyCalled = false;
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run() { agyCalled = true; return { ok: true, untrustedResponse: 'ok', ms: 5, cancelled: false }; },
    };
    const fakeCodex = {
      async run(_p, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          await writeFile(
            join(ctx.workspace, 'password.js'),
            'export function validatePassword(p){return typeof p==="string"&&p.length>=8&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p);}\n',
          );
        }
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };

    const run = createRun('Antigravity disabled', 'codex', { type: 'template' });
    await startRun(run, root, {
      codex: fakeCodex,
      antigravity: fakeAgy,
      antigravityValidated: true,
      providerSettings: {
        providers: {
          codex: { enabled: true, usdPer1kTokens: 0, tokenBudget: 12345 },
          antigravity: { enabled: false, usdPer1kTokens: 0, tokenBudget: 6789 },
        },
        runBudgetUsd: null,
      },
    });

    expect(run.status).toBe('completed');
    expect(agyCalled).toBe(false);
    expect(run.usage.codex.budget).toBe(12345);
    expect(run.usage.antigravity.budget).toBe(6789);
    expect(run.events.some(e => e.type === 'log' && e.reason === 'provider_disabled')).toBe(true);
  });

  it('codex enabled:false falla antes de llamar a cualquier conector', async () => {
    const root = await makeTempDir();
    let codexCalled = false;
    let agyCalled = false;
    const fakeCodex = { async run() { codexCalled = true; return { ok: true, code: 0, output: 'ok', ms: 5 }; } };
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run() { agyCalled = true; return { ok: true, untrustedResponse: 'ok', ms: 5 }; },
    };

    const run = createRun('Codex disabled', 'codex', { type: 'template' });
    await startRun(run, root, {
      codex: fakeCodex,
      antigravity: fakeAgy,
      antigravityValidated: true,
      providerSettings: {
        providers: {
          codex: { enabled: false, usdPer1kTokens: 0, tokenBudget: 40000 },
          antigravity: { enabled: true, usdPer1kTokens: 0, tokenBudget: 20000 },
        },
      },
    });

    expect(run.status).toBe('failed');
    expect(codexCalled).toBe(false);
    expect(agyCalled).toBe(false);
    expect(run.events.some(e => e.type === 'step.failed' && e.reason === 'provider_disabled')).toBe(true);
  });

  it('corta con budget_usd_exceeded con enforceBudget y tarifa > 0; con tarifa 0 marca costUsdPartial y no corta', async () => {
    const root1 = await makeTempDir();
    let reviewCalled = false;
    const fakeCodex = {
      async run(_p, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          await writeFile(
            join(ctx.workspace, 'password.js'),
            'export function validatePassword(p){return typeof p==="string"&&p.length>=8&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p);}\n',
          );
          return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false, usage: { totalTokens: 5000 } };
        }
        reviewCalled = true;
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };

    const run1 = createRun('Tope USD activo', 'codex', { type: 'template' });
    await startRun(run1, root1, {
      codex: fakeCodex,
      antigravityValidated: false,
      enforceBudget: true,
      providerSettings: {
        providers: {
          codex: { enabled: true, usdPer1kTokens: 0.02, tokenBudget: 40000 },
          antigravity: { enabled: true, usdPer1kTokens: 0.01, tokenBudget: 20000 },
        },
        runBudgetUsd: 0.05,
      },
    });
    expect(reviewCalled).toBe(false);
    expect(run1.status).toBe('failed');
    expect(run1.usage.costUsd).toBe(0.1);
    expect(run1.usage.costUsdPartial).toBe(false);
    expect(run1.events.some(e => e.type === 'step.failed' && e.reason === 'budget_usd_exceeded')).toBe(true);

    // Tarifa 0 -> costUsdPartial: true y sin corte
    const root2 = await makeTempDir();
    const run2 = createRun('Tarifa cero parcial', 'codex', { type: 'template' });
    await startRun(run2, root2, {
      codex: fakeCodex,
      antigravityValidated: false,
      enforceBudget: true,
      providerSettings: {
        providers: {
          codex: { enabled: true, usdPer1kTokens: 0, tokenBudget: 40000 },
          antigravity: { enabled: true, usdPer1kTokens: 0, tokenBudget: 20000 },
        },
        runBudgetUsd: 0.05,
      },
    });
    expect(run2.status).toBe('completed');
    expect(run2.usage.costUsdPartial).toBe(true);
  });

  it('mutar settings durante un run no cambia el snapshot del run en curso y AGENT_REGISTRY sigue inmutable', async () => {
    expect(canAgentRun('antigravity', 'code-write', 'workspace-write')).toBe(false);

    const root = await makeTempDir();
    const mutableSettings = {
      providers: {
        codex: { enabled: true, usdPer1kTokens: 0.01, tokenBudget: 30000 },
        antigravity: { enabled: true, usdPer1kTokens: 0.01, tokenBudget: 15000 },
      },
      runBudgetUsd: 1,
    };
    const fakeCodex = {
      async run(_p, ctx) {
        // Simulate PUT /api/settings mutating settings mid-run
        mutableSettings.providers.codex.enabled = false;
        mutableSettings.providers.codex.usdPer1kTokens = 999;
        mutableSettings.runBudgetUsd = 0.01;
        if (ctx.sandbox === 'workspace-write') {
          await writeFile(
            join(ctx.workspace, 'password.js'),
            'export function validatePassword(p){return typeof p==="string"&&p.length>=8&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p);}\n',
          );
        }
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false, usage: { totalTokens: 1000 } };
      },
    };

    const run = createRun('Snapshot inmutable', 'codex', { type: 'template' });
    await startRun(run, root, {
      codex: fakeCodex,
      antigravityValidated: false,
      enforceBudget: true,
      providerSettings: mutableSettings,
    });

    expect(run.status).toBe('completed');
    expect(run.usage.codex.usdPer1kTokens).toBe(0.01);
    expect(run.usage.budgetUsd).toBe(1);
  });
});
