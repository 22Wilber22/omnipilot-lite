import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsStore } from '../src/memory/settingsStore.js';
import { createApp } from '../src/api/app.js';

let tempDirs = [];
let servers = [];

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  servers = [];
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('HOTFIX UX — Configuración conversacional persistente y fallback', () => {
  it('persiste preferencia conversacional en data/settings.json tras recrear el store', async () => {
    const dir = await makeTempDir('omnipilot-settings-');
    const file = join(dir, 'settings.json');
    const store1 = createSettingsStore(file);
    await store1.update({ chatProvider: 'antigravity', chatModel: 'gemini-3-flash', chatStyle: 'detailed' });

    const store2 = createSettingsStore(file);
    const loaded = await store2.get();
    expect(loaded.chatProvider).toBe('antigravity');
    expect(loaded.chatModel).toBe('gemini-3-flash');
    expect(loaded.chatStyle).toBe('detailed');
  });

  it('GET/PUT /api/settings expone modelos detectados y hace fallback seguro cuando no hay proveedor disponible', async () => {
    const workspacesDir = await makeTempDir('omnipilot-s7-ws-');
    const conversationsDir = await makeTempDir('omnipilot-s7-conv-');
    const settingsPath = join(await makeTempDir('omnipilot-s7-set-'), 'settings.json');
    const token = 's7-token';

    const app = createApp({
      token,
      port: 0,
      workspacesDir,
      conversationsDir,
      settingsPath,
      codex: { async isAvailable() { return { available: false, version: null, error: 'no' }; } },
      antigravity: {
        async isAvailable() { return { available: false, version: null, error: 'no' }; },
        async listModels() { return ['gemini-3-flash', 'gemini-3-pro']; },
      },
      antigravityValidated: true,
    });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const getRes = await (await fetch(`${baseUrl}/api/settings`, { headers: { 'X-Omni-Token': token } })).json();
    expect(getRes.availableModels.antigravity).toEqual(['gemini-3-flash', 'gemini-3-pro']);
    expect(getRes.settings.chatProvider).toBe('auto');

    const putRes = await (await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatProvider: 'antigravity', chatModel: 'gemini-3-flash', chatStyle: 'fast' }),
    })).json();
    expect(putRes.settings.chatModel).toBe('gemini-3-flash');

    const conv = await (await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    })).json();
    const chatRes = await (await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hola', intent: 'chat' }),
    })).json();
    expect(chatRes.run).toBeNull();
    expect(chatRes.reply.text).toMatch(/Ningún proveedor conversacional está disponible/i);
  });
});
