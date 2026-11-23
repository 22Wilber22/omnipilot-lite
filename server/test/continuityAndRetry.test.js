import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/api/app.js';

const TOKEN = 'test-token-continuity';
let tempDirs = [];
let servers = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'omnipilot-cont-'));
  tempDirs.push(dir);
  return dir;
}

async function startServer({ codex, antigravity } = {}) {
  const ws = await makeTempDir();
  const data = await makeTempDir();
  const port = 4600 + Math.floor(Math.random() * 350);
  const app = createApp({
    token: TOKEN,
    port,
    workspacesDir: ws,
    conversationsDir: join(data, 'conversations'),
    settingsPath: join(data, 'settings.json'),
    codex,
    antigravity,
  });
  const server = await new Promise(resolve => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return { base: `http://127.0.0.1:${port}`, ws };
}

const headers = { 'X-Omni-Token': TOKEN, 'Content-Type': 'application/json' };

afterEach(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  servers = [];
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Sprint — Continuidad del orquestador y reintento conversacional', () => {
  it('resuelve pendingAction con "Prepara el plan" y con botón sin llamar proveedor adicional', async () => {
    let agyCalls = 0;
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run() {
        agyCalls += 1;
        return { ok: true, untrustedResponse: 'Puedo ayudarte con eso. ¿Quieres plan o ejecución?' };
      },
    };
    const { base } = await startServer({ antigravity: fakeAgy });

    const conv = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers })).json();
    const r1 = await (await fetch(`${base}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Quiero mejorar el login', intent: 'chat', orchestratorProvider: 'antigravity' }),
    })).json();
    expect(r1.conversation.pendingAction?.type).toBe('prepare-plan');
    expect(agyCalls).toBe(1);

    // Resolve via text "Prepara el plan" -> no extra provider call
    const r2 = await (await fetch(`${base}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Prepara el plan', intent: 'chat' }),
    })).json();
    expect(r2.reply.type).toBe('plan-conceptual');
    expect(r2.conversation.pendingAction).toBeNull();
    expect(agyCalls).toBe(1);

    // Resolve via button resolveAction -> no extra provider call
    const r3 = await (await fetch(`${base}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Preparar plan', intent: 'chat', resolveAction: 'prepare-plan' }),
    })).json();
    expect(r3.reply.type).toBe('plan-conceptual');
    expect(agyCalls).toBe(1);
  });

  it('maneja timeout y respuesta vacía con un único reintento sin duplicar burbujas ni crear run/workspace', async () => {
    let calls = 0;
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run() {
        calls += 1;
        if (calls === 1) return { ok: false, timedOut: true, untrustedResponse: '' };
        if (calls === 2) return { ok: true, untrustedResponse: '   ' };
        return { ok: true, untrustedResponse: 'Respuesta recuperada correctamente.' };
      },
    };
    const { base, ws } = await startServer({ antigravity: fakeAgy });

    const conv = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers })).json();
    const first = await (await fetch(`${base}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Hola orquestador', intent: 'chat', orchestratorProvider: 'antigravity' }),
    })).json();
    expect(first.reply.type).toBe('chat-error');
    expect(first.reply.errorCause).toBe('timeout');
    expect(first.reply.retryable).toBe(true);
    expect(first.run).toBeNull();
    const countBeforeRetry = first.conversation.messages.length;

    // First retry -> returns empty response -> safe final error, no duplicate messages
    const retry1 = await (await fetch(`${base}/api/conversations/${conv.id}/messages/${first.reply.id}/retry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orchestratorProvider: 'antigravity' }),
    })).json();
    expect(retry1.reply.type).toBe('chat-error');
    expect(retry1.reply.errorCause).toBe('empty-response');
    expect(retry1.reply.retryable).toBe(false);
    expect(retry1.reply.retried).toBe(true);
    expect(retry1.conversation.messages.length).toBe(countBeforeRetry);
    expect(retry1.run).toBeNull();

    // Second retry blocked with 409
    const retry2 = await fetch(`${base}/api/conversations/${conv.id}/messages/${first.reply.id}/retry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orchestratorProvider: 'antigravity' }),
    });
    expect(retry2.status).toBe(409);

    // No workspace created
    expect(await readdir(ws)).toEqual([]);
  });

  it('"hazlo" con plan conceptual + proyecto válido crea plan ejecutable pending sin iniciar agentes', async () => {
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run() { return { ok: true, untrustedResponse: 'Plan conceptual de prueba.' }; },
    };
    const { base } = await startServer({ antigravity: fakeAgy });

    const conv = await (await fetch(`${base}/api/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectConfig: { sourceType: 'template' } }),
    })).json();

    await fetch(`${base}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Preparar plan', intent: 'chat', resolveAction: 'prepare-plan' }),
    });

    const res = await (await fetch(`${base}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'hazlo', intent: 'chat' }),
    })).json();

    expect(res.run).toBeTruthy();
    expect(res.run.status).toBe('pending');
    expect(res.reply.type).toBe('tarea');
  });

  it('sanea respuestas con "modo ejecución" y valida JSON estructurado de acciones', async () => {
    const fakeAgy = {
      async isAvailable() { return { available: true }; },
      async run() {
        return {
          ok: true,
          untrustedResponse: JSON.stringify({
            reply: 'Para seguir, cambia a modo ejecución usando el selector de modo.',
            intent: 'conceptual-plan',
            actions: ['convert-to-task'],
          }),
        };
      },
    };
    const { base } = await startServer({ antigravity: fakeAgy });
    const conv = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers })).json();

    const res = await (await fetch(`${base}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Planifica el cambio', intent: 'chat', orchestratorProvider: 'antigravity' }),
    })).json();

    expect(res.reply.text.toLowerCase()).not.toContain('modo ejecución');
    expect(res.reply.text.toLowerCase()).not.toContain('selector de modo');
    expect(res.reply.actions).toEqual(['convert-to-task']);
    expect(res.run).toBeNull();
  });

  it('"Pasemos a ejecución" con plan y sin proyecto pide Seleccionar proyecto; con proyecto crea plan pending', async () => {
    const { base } = await startServer({});

    // Without project -> needs-project + select-project, no run
    const convNoProj = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers })).json();
    await fetch(`${base}/api/conversations/${convNoProj.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Preparar plan', intent: 'chat', resolveAction: 'prepare-plan' }),
    });
    const rNoProj = await (await fetch(`${base}/api/conversations/${convNoProj.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Pasemos a ejecución', intent: 'chat' }),
    })).json();
    expect(rNoProj.run).toBeNull();
    expect(rNoProj.reply.type).toBe('needs-project');
    expect(rNoProj.reply.actions).toEqual(['select-project']);

    // With project -> pending executable plan, never starts agents
    const convWithProj = await (await fetch(`${base}/api/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectConfig: { sourceType: 'template' } }),
    })).json();
    await fetch(`${base}/api/conversations/${convWithProj.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Preparar plan', intent: 'chat', resolveAction: 'prepare-plan' }),
    });
    const rWithProj = await (await fetch(`${base}/api/conversations/${convWithProj.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Pasemos a ejecución', intent: 'chat' }),
    })).json();
    expect(rWithProj.run).toBeTruthy();
    expect(rWithProj.run.status).toBe('pending');
  });
});
