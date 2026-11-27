import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_REGISTRY, canAgentRun } from '../src/orchestrator/router.js';
import { createRun, startRun } from '../src/orchestrator/orchestrator.js';

let tempDirs = [];
async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'omnipilot-perm-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Permisos de agentes y cumplimiento de AGENT_REGISTRY', () => {
  it('valida permisos y capacidades de Antigravity, Codex y agentes no registrados', () => {
    expect(canAgentRun('antigravity', 'code-write', 'accept-edits')).toBe(true);
    expect(canAgentRun('antigravity', 'code-write', 'workspace-write')).toBe(false);
    expect(canAgentRun('codex', 'review', 'accept-edits')).toBe(false);
    expect(canAgentRun('unknown-agent', 'code-write', 'workspace-write')).toBe(false);

    // accept-edits exige code-write aunque allowedPermissions incluya accept-edits
    const registryWithoutWrite = {
      custom: {
        id: 'custom',
        provider: 'Custom',
        capabilities: ['fix'],
        allowedPermissions: ['accept-edits'],
      },
    };
    expect(canAgentRun('custom', 'fix', 'accept-edits', registryWithoutWrite)).toBe(false);
  });

  it('emite step.failed con reason agent_not_permitted y no ejecuta el conector si el registro niega permiso', async () => {
    const root = await makeTempDir();
    let codexCalled = false;
    const fakeCodex = {
      async run() {
        codexCalled = true;
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };
    const restrictedRegistry = {
      ...AGENT_REGISTRY,
      codex: {
        id: 'codex',
        provider: 'Codex',
        capabilities: ['code-read'],
        allowedPermissions: ['read-only'],
      },
    };

    const run = createRun('Probar bloqueo de permisos', 'codex', { type: 'template' });
    await startRun(run, root, {
      codex: fakeCodex,
      antigravityValidated: false,
      agentRegistry: restrictedRegistry,
    });

    expect(codexCalled).toBe(false);
    expect(run.status).toBe('failed');
    const deniedEvent = run.events.find(e => e.type === 'step.failed' && e.reason === 'agent_not_permitted');
    expect(deniedEvent).toBeTruthy();
    expect(deniedEvent.agentId).toBe('codex');
    expect(deniedEvent.capability).toBe('code-write');
    expect(deniedEvent.permission).toBe('workspace-write');
  });

  it('T1: si el registro niega review a Antigravity, revisa Codex read-only y el run completa', async () => {
    const root = await makeTempDir();
    const agyCalls = [];
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run(_prompt, ctx) {
        agyCalls.push(ctx);
        return { ok: true, untrustedResponse: 'ok', ms: 5, cancelled: false };
      },
    };
    const fakeCodex = {
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          await writeFile(
            join(ctx.workspace, 'password.js'),
            'export function validatePassword(p){return typeof p==="string"&&p.length>=8&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p);}\n',
          );
        }
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };
    const registryNoReview = {
      ...AGENT_REGISTRY,
      antigravity: {
        ...AGENT_REGISTRY.antigravity,
        capabilities: ['plan', 'chat', 'code-write', 'fix'],
      },
    };

    const run = createRun('T1 review fallback', 'codex', { type: 'template' });
    await startRun(run, root, {
      codex: fakeCodex,
      antigravity: fakeAgy,
      antigravityValidated: true,
      agentRegistry: registryNoReview,
    });

    expect(run.status).toBe('completed');
    expect(agyCalls).toHaveLength(0);
    const reviewFallbackLog = run.events.find(e => e.type === 'log' && e.fallback && /denegado por registro/i.test(e.message));
    expect(reviewFallbackLog).toBeTruthy();
  });

  it('T2: si Codex falla en implement y Antigravity no tiene accept-edits, no hace fallback y falla con error de Codex', async () => {
    const root = await makeTempDir();
    const agyCalls = [];
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run(_prompt, ctx) {
        agyCalls.push(ctx);
        return { ok: true, untrustedResponse: 'ok', ms: 5, cancelled: false };
      },
    };
    const fakeCodex = {
      async run() {
        return { ok: false, code: 1, error: 'codex failed', stderr: 'err', ms: 5, cancelled: false };
      },
    };
    const registryReadOnlyAgy = {
      ...AGENT_REGISTRY,
      antigravity: {
        ...AGENT_REGISTRY.antigravity,
        allowedPermissions: ['read-only'],
      },
    };

    const run = createRun('T2 implement sin fallback', 'codex', { type: 'template' });
    await startRun(run, root, {
      codex: fakeCodex,
      antigravity: fakeAgy,
      antigravityValidated: true,
      agentRegistry: registryReadOnlyAgy,
    });

    expect(run.status).toBe('failed');
    expect(agyCalls).toHaveLength(0);
    expect(run.events.some(e => e.type === 'step.started' && e.step === 'implement' && String(e.agent || '').startsWith('antigravity-'))).toBe(false);
    expect(run.events.some(e => e.type === 'step.failed' && e.reason === 'agent_not_permitted')).toBe(false);
  });

  it('T3: en fix, si Antigravity no tiene permiso fix/accept-edits, nunca se llama con mode accept-edits', async () => {
    const root = await makeTempDir();
    const agyCalls = [];
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run(_prompt, ctx) {
        agyCalls.push(ctx);
        return { ok: true, untrustedResponse: 'ok', ms: 5, cancelled: false };
      },
    };
    let writeCalls = 0;
    const fakeCodex = {
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          writeCalls += 1;
          if (writeCalls === 1) {
            await writeFile(join(ctx.workspace, 'password.js'), 'export function validatePassword(){return false;}\n');
            return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
          }
          return { ok: false, code: 1, error: 'codex fix failed', stderr: 'err', ms: 5, cancelled: false };
        }
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };
    const registryNoFix = {
      ...AGENT_REGISTRY,
      antigravity: {
        ...AGENT_REGISTRY.antigravity,
        capabilities: ['plan', 'review', 'chat'],
        allowedPermissions: ['read-only'],
      },
    };

    const run = createRun('T3 fix sin fallback', 'codex', { type: 'template' });
    await startRun(run, root, {
      codex: fakeCodex,
      antigravity: fakeAgy,
      antigravityValidated: true,
      agentRegistry: registryNoFix,
    });

    expect(run.status).toBe('failed');
    expect(agyCalls.some(c => c.mode === 'accept-edits')).toBe(false);
    expect(run.events.some(e => e.type === 'step.failed' && e.reason === 'agent_not_permitted')).toBe(false);
  });

  it('T4: con AGENT_REGISTRY por defecto, si Codex falla en implement hace fallback a Antigravity accept-edits', async () => {
    const root = await makeTempDir();
    const agyCalls = [];
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run(_prompt, ctx) {
        agyCalls.push(ctx);
        if (ctx.mode === 'accept-edits') {
          await writeFile(
            join(ctx.workspace, 'password.js'),
            'export function validatePassword(p){return typeof p==="string"&&p.length>=8&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p);}\n',
          );
        }
        return { ok: true, untrustedResponse: 'ok', ms: 5, cancelled: false };
      },
    };
    const fakeCodex = {
      async run() {
        return { ok: false, code: 1, error: 'codex quota', stderr: '429', ms: 5, cancelled: false };
      },
    };

    const run = createRun('T4 fallback activo', 'codex', { type: 'template' });
    await startRun(run, root, {
      codex: fakeCodex,
      antigravity: fakeAgy,
      antigravityValidated: true,
    });

    expect(run.status).toBe('completed');
    expect(agyCalls.some(c => c.mode === 'accept-edits')).toBe(true);
  });
});
