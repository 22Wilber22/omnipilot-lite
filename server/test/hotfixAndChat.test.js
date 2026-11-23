import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSafeWorkspacePath, initGitWorkspace, commitBaseline, getGitStatus, captureGitPatch } from '../src/security/workspaceGuard.js';
import { buildBoundedChatContext } from '../src/orchestrator/chatOrchestrator.js';
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

describe('HOTFIX — symlinks internos seguros de npm', () => {
  it('permite symlink interno en node_modules/.bin/vitest y excluye node_modules de cambios y parche', async () => {
    const root = await makeTempDir('omnipilot-npm-ok-');
    const ws = join(root, 'run1');
    await mkdir(join(ws, 'node_modules', 'vitest'), { recursive: true });
    await mkdir(join(ws, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(ws, 'package.json'), '{"name":"demo"}\n');
    await writeFile(join(ws, 'node_modules', 'vitest', 'vitest.mjs'), 'console.log("ok");\n');
    await symlink(join('..', 'vitest', 'vitest.mjs'), join(ws, 'node_modules', '.bin', 'vitest'));

    const safe = await resolveSafeWorkspacePath(root, 'run1');
    expect(safe).toBe(ws);

    await initGitWorkspace(ws);
    await commitBaseline(ws);
    await writeFile(join(ws, 'node_modules', 'extra.js'), 'ignored\n');
    await writeFile(join(ws, 'app.js'), 'export const x = 1;\n');

    const status = await getGitStatus(ws);
    expect(status.files).toEqual(['app.js']);
    const patch = await captureGitPatch(ws);
    expect(patch).toContain('app.js');
    expect(patch).not.toContain('node_modules');
  });

  it('rechaza node_modules como symlink, .bin que apunta fuera y symlink en src/', async () => {
    const root = await makeTempDir('omnipilot-npm-bad-');
    const outside = await makeTempDir('omnipilot-outside-');
    await writeFile(join(outside, 'secret.txt'), 'secret');

    // 1. node_modules itself as symlink
    const ws1 = join(root, 'ws1');
    await mkdir(ws1, { recursive: true });
    await symlink(outside, join(ws1, 'node_modules'));
    await expect(resolveSafeWorkspacePath(root, 'ws1')).rejects.toThrow(/Symlink no permitido/i);

    // 2. .bin symlink pointing outside node_modules
    const ws2 = join(root, 'ws2');
    await mkdir(join(ws2, 'node_modules', '.bin'), { recursive: true });
    await symlink(join(outside, 'secret.txt'), join(ws2, 'node_modules', '.bin', 'evil'));
    await expect(resolveSafeWorkspacePath(root, 'ws2')).rejects.toThrow(/Symlink no permitido/i);

    // 3. symlink inside src/
    const ws3 = join(root, 'ws3');
    await mkdir(join(ws3, 'src'), { recursive: true });
    await symlink(join(outside, 'secret.txt'), join(ws3, 'src', 'leak.js'));
    await expect(resolveSafeWorkspacePath(root, 'ws3')).rejects.toThrow(/Symlink no permitido/i);
  });
});

describe('SPRINT — Chat ligero con orquestador configurable', () => {
  it('acota contexto a últimos 6 mensajes y máximo 4 KB', () => {
    const msgs = Array.from({ length: 12 }, (_, i) => ({ role: 'user', text: `msg-${i} ` + 'a'.repeat(500) }));
    const bounded = buildBoundedChatContext(msgs);
    expect(bounded.length).toBeLessThanOrEqual(6);
    expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThanOrEqual(4096);
  });

  it('chat normal no crea run, plan conceptual no requiere proyecto y convertir-a-tarea crea plan pendiente', async () => {
    const workspacesDir = await makeTempDir('omnipilot-chat-ws-');
    const conversationsDir = await makeTempDir('omnipilot-chat-conv-');
    const token = 'chat-token';

    const fakeAgy = {
      async isAvailable() { return { available: true, version: 'agy-fake', error: null }; },
      async run(prompt) {
        const isPlan = /plan conceptual/i.test(prompt);
        return {
          ok: true,
          code: 0,
          status: 'SUCCESS',
          untrustedResponse: isPlan ? '1. Mejorar composer\n2. Agregar historial\n3. Validar con pruebas' : 'OmniPilot coordina agentes locales.',
          ms: 5,
          cancelled: false,
        };
      },
    };
    const fakeCodex = {
      async isAvailable() { return { available: false, version: null, error: 'no' }; },
      async run() { throw new Error('No debe llamarse en chat normal'); },
    };

    const app = createApp({ token, port: 0, workspacesDir, conversationsDir, codex: fakeCodex, antigravity: fakeAgy, antigravityValidated: true });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const conv = await (await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    })).json();

    // 1. Normal question -> no run
    const qBody = await (await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '¿Qué puede hacer OmniPilot?', intent: 'chat', orchestratorProvider: 'antigravity' }),
    })).json();
    expect(qBody.run).toBeNull();
    expect(qBody.reply.type).toBe('chat');
    expect(qBody.reply.text).toContain('OmniPilot');

    // 2. Plan request -> conceptual plan without project or run
    const pBody = await (await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Planifica cómo mejorar el chat', intent: 'chat', orchestratorProvider: 'antigravity' }),
    })).json();
    expect(pBody.run).toBeNull();
    expect(pBody.reply.type).toBe('plan-conceptual');

    // 3. Convert to task without projectConfig -> 400
    const noProj = await fetch(`${baseUrl}/api/conversations/${conv.id}/convert-to-task`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: pBody.reply.text }),
    });
    expect(noProj.status).toBe(400);

    // 4. Configure template project and convert -> pending executable plan
    await fetch(`${baseUrl}/api/conversations/${conv.id}/project-config`, {
      method: 'PUT',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'template' }),
    });
    const converted = await (await fetch(`${baseUrl}/api/conversations/${conv.id}/convert-to-task`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceMessageId: pBody.reply.id, mode: 'codex' }),
    })).json();
    expect(converted.run.status).toBe('pending');
    expect(converted.run.goal).toBe('Planifica cómo mejorar el chat');
    expect(converted.reply.type).toBe('tarea');

    // 5. Unavailable provider replies cleanly without executing
    const unavail = await (await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hola', intent: 'chat', orchestratorProvider: 'codex' }),
    })).json();
    expect(unavail.run).toBeNull();
    expect(unavail.reply.text).toMatch(/disponible/i);
  });
});
