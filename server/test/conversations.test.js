import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationStore } from '../src/memory/conversationStore.js';
import { createApp } from '../src/api/app.js';

let servers = [];
let tempDirs = [];

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function startServer(options = {}) {
  const workspacesDir = await makeTempDir('omnipilot-conv-ws-');
  const conversationsDir = await makeTempDir('omnipilot-conv-data-');
  const token = 'secret-local-token-xyz';
  const app = createApp({ token, port: 0, workspacesDir, conversationsDir, ...options });
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, token, conversationsDir };
}

afterEach(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  servers = [];
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Sprint 4 — Conversaciones locales y clasificación determinista', () => {
  it('crea, lista, abre y persiste conversaciones tras recrear el store', async () => {
    const dir = await makeTempDir('omnipilot-store-');
    const store1 = createConversationStore(dir);
    const conv = await store1.create();
    await store1.appendMessage(conv.id, { role: 'user', text: 'Hola' });

    const store2 = createConversationStore(dir);
    const list = await store2.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(conv.id);

    const loaded = await store2.get(conv.id);
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].text).toBe('Hola');
  });

  it('rechaza JSON corrupto al leer conversación', async () => {
    const dir = await makeTempDir('omnipilot-corrupt-');
    const store = createConversationStore(dir);
    const conv = await store.create();
    await writeFile(join(dir, `${conv.id}.json`), '{not-valid-json');
    await expect(store.get(conv.id)).rejects.toThrow();
  });

  it('POST de "Hola" responde sin crear run y no guarda el token en disco', async () => {
    let codexCalled = false;
    const { baseUrl, token, conversationsDir } = await startServer({
      codex: {
        async isAvailable() { return { available: true, version: 'fake', error: null }; },
        async run() { codexCalled = true; return { ok: true, code: 0, output: '', ms: 1 }; },
      },
      antigravity: { async isAvailable() { return { available: false, version: null, error: 'no' }; } },
    });

    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    });
    expect(created.status).toBe(201);
    const conv = await created.json();

    const msgRes = await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hola' }),
    });
    expect(msgRes.status).toBe(201);
    const body = await msgRes.json();
    expect(body.run).toBeNull();
    expect(body.reply.text).toMatch(/Describe el cambio/i);
    expect(codexCalled).toBe(false);

    const rawFile = await readFile(join(conversationsDir, `${conv.id}.json`), 'utf8');
    expect(rawFile).not.toContain(token);
  });

  it('POST de "dale" responde como conversación sin crear run ni llamar agentes', async () => {
    let codexCalled = false;
    const { baseUrl, token } = await startServer({
      codex: {
        async isAvailable() { return { available: true }; },
        async run() { codexCalled = true; return { ok: true, code: 0, output: '', ms: 1 }; },
      },
    });
    const conv = await (await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST', headers: { 'X-Omni-Token': token },
    })).json();

    const response = await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'dale', mode: 'codex' }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.run).toBeNull();
    expect(body.reply.text).toMatch(/Entendido/i);
    expect(codexCalled).toBe(false);
  });

  it('solicitud de código crea plan pendiente sin ejecutar; solo aprobación inicia el run', async () => {
    let codexCalled = false;
    const { baseUrl, token } = await startServer({
      codex: {
        async isAvailable() { return { available: true, version: 'fake', error: null }; },
        async run(_p, ctx) {
          codexCalled = true;
          await writeFile(join(ctx.workspace, 'password.js'), 'export function validatePassword(){return false;}\n');
          return { ok: true, code: 0, output: 'done', ms: 2, cancelled: false };
        },
      },
      antigravity: { async isAvailable() { return { available: false, version: null, error: 'no' }; } },
    });

    const conv = await (await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectConfig: { sourceType: 'template' } }),
    })).json();

    const msgRes = await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Implementa validatePassword con pruebas', mode: 'codex' }),
    });
    const body = await msgRes.json();
    expect(body.run).toBeTruthy();
    expect(body.run.status).toBe('pending');
    expect(body.reply.text).toMatch(/Aprobar y ejecutar/i);
    expect(codexCalled).toBe(false);

    const listRes = await (await fetch(`${baseUrl}/api/conversations`, {
      headers: { 'X-Omni-Token': token },
    })).json();
    expect(listRes.conversations[0].status).toBe('plan_pending');

    const approveRes = await fetch(`${baseUrl}/api/runs/${body.run.id}/approve`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    });
    expect(approveRes.status).toBe(200);
    for (let i = 0; i < 60 && !codexCalled; i += 1) {
      await new Promise(r => setTimeout(r, 50));
    }
    expect(codexCalled).toBe(true);
    let finalRun;
    for (let i = 0; i < 60; i += 1) {
      finalRun = await (await fetch(`${baseUrl}/api/runs/${body.run.id}`, {
        headers: { 'X-Omni-Token': token },
      })).json();
      if (finalRun.completedAt) break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(finalRun.completedAt).toBeTruthy();
  });
});
