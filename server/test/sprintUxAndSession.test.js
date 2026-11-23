import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, DEFAULT_CONVERSATIONS_DIR } from '../src/api/app.js';
import { sanitizePlainReply, runOrchestratorChat } from '../src/orchestrator/chatOrchestrator.js';
import { createConversationStore } from '../src/memory/conversationStore.js';

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

describe('SPRINT UX + HOTFIX Sesión', () => {
  it('DEFAULT_CONVERSATIONS_DIR apunta a data/conversations desde la raíz del proyecto', () => {
    expect(DEFAULT_CONVERSATIONS_DIR.endsWith(join('data', 'conversations'))).toBe(true);
  });

  it('elimina Markdown crudo y limita respuestas del orquestador a máximo 90 palabras', () => {
    const raw = '## Plan\n- **Paso 1:** hacer `algo`\n\n' + Array.from({ length: 110 }, (_, i) => `palabra${i}`).join(' ');
    const clean = sanitizePlainReply(raw);
    expect(clean).not.toContain('**');
    expect(clean).not.toContain('##');
    expect(clean.split(/\s+/).length).toBeLessThanOrEqual(91);
  });

  it('"Vamos a programar" sin proyecto responde needs-project sin crear run', async () => {
    const res = await runOrchestratorChat({ text: 'Vamos a programar el login', hasProject: false });
    expect(res.type).toBe('needs-project');
    expect(res.text).toMatch(/selecciona un proyecto/i);
  });

  it('rechaza targetScope inválido (ruta absoluta o ..) y guarda targetScope válido en projectConfig', async () => {
    const workspacesDir = await makeTempDir('omnipilot-ux-ws-');
    const conversationsDir = await makeTempDir('omnipilot-ux-conv-');
    const token = 'ux-token';
    const app = createApp({
      token,
      port: 0,
      workspacesDir,
      conversationsDir,
      codex: { async isAvailable() { return { available: true, version: 'fake', error: null }; } },
      antigravity: { async isAvailable() { return { available: false, version: null, error: 'no' }; } },
    });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const conv = await (await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    })).json();

    const bad = await fetch(`${baseUrl}/api/conversations/${conv.id}/project-config`, {
      method: 'PUT',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'template', targetScope: '../secret.txt' }),
    });
    expect(bad.status).toBe(400);

    const ok = await fetch(`${baseUrl}/api/conversations/${conv.id}/project-config`, {
      method: 'PUT',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'template', targetScope: 'src/App.jsx' }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.projectConfig.targetScope).toBe('src/App.jsx');

    // Recreate store to confirm persistence
    const store2 = createConversationStore(conversationsDir);
    const reloaded = await store2.get(conv.id);
    expect(reloaded.projectConfig.targetScope).toBe('src/App.jsx');
  });
});
