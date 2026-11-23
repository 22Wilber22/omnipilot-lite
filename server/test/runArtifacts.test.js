import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/api/app.js';
import { writeMemory, newMemory } from '../src/memory/store.js';

const TOKEN = 'test-local-token-sprint9';
let tempDirs = [];
let servers = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'omnipilot-s9-'));
  tempDirs.push(dir);
  return dir;
}

async function startTestServer(workspacesDir) {
  const dataDir = await makeTempDir();
  const port = 4500 + Math.floor(Math.random() * 500);
  const app = createApp({
    token: TOKEN,
    port,
    workspacesDir,
    conversationsDir: join(dataDir, 'conversations'),
    settingsPath: join(dataDir, 'settings.json'),
  });
  const server = await new Promise(resolve => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  servers = [];
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Sprint 9 — Descarga segura de evidencia y parche', () => {
  it('rechaza peticiones sin token con 401', async () => {
    const ws = await makeTempDir();
    const base = await startTestServer(ws);
    const id = randomUUID();

    const r1 = await fetch(`${base}/api/runs/${id}/evidence`);
    const r2 = await fetch(`${base}/api/runs/${id}/patch`);
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
  });

  it('rechaza run IDs inválidos o traversal con 400/404', async () => {
    const ws = await makeTempDir();
    const base = await startTestServer(ws);
    const headers = { 'X-Omni-Token': TOKEN };

    const r1 = await fetch(`${base}/api/runs/not-a-uuid/evidence`, { headers });
    const r2 = await fetch(`${base}/api/runs/..%2F..%2Fetc%2Fpasswd/patch`, { headers });
    expect([400, 404]).toContain(r1.status);
    expect([400, 404]).toContain(r2.status);
  });

  it('descarga evidencia JSON saneada sin secretos y con headers correctos', async () => {
    const ws = await makeTempDir();
    const base = await startTestServer(ws);
    const id = randomUUID();
    const runDir = join(ws, id);

    const mem = newMemory('Implementar auth con token=supersecret123 y sk-FAKEKEY1234567890', {
      acceptance: 'node --test password.test.js',
      skills: ['orchestrator-driven-development', 'clean-code'],
    });
    mem.steps.push({
      id: 1,
      agent: 'codex-implement',
      status: 'ok',
      summary: 'Actualizado con Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
      ms: 420,
      files: ['password.js'],
    });
    await writeMemory(runDir, mem);

    const res = await fetch(`${base}/api/runs/${id}/evidence`, {
      headers: { 'X-Omni-Token': TOKEN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="omnipilot-evidence-${id}.json"`);

    const text = await res.text();
    expect(text).not.toContain('supersecret123');
    expect(text).not.toContain('sk-FAKEKEY1234567890');
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');

    const json = JSON.parse(text);
    expect(json.runId).toBe(id);
    expect(json.skills).toContain('orchestrator-driven-development');
    expect(json.archivosModificados).toEqual(['password.js']);
    expect(json.agentes).toEqual(['codex-implement']);
  });

  it('descarga parche Git saneado excluyendo node_modules/.env y devuelve error claro si no hay cambios', async () => {
    const ws = await makeTempDir();
    const base = await startTestServer(ws);
    const headers = { 'X-Omni-Token': TOKEN };

    const idWithPatch = randomUUID();
    await mkdir(join(ws, idWithPatch), { recursive: true });
    const rawPatch = [
      'diff --git a/password.js b/password.js',
      '--- a/password.js',
      '+++ b/password.js',
      '@@ -1 +1 @@',
      '+export const ok = true; // api_key=mysecretvalue999',
      'diff --git a/node_modules/pkg/index.js b/node_modules/pkg/index.js',
      '+should be excluded',
      'diff --git a/.env b/.env',
      '+SECRET=12345678',
    ].join('\n');
    await writeFile(join(ws, idWithPatch, 'changes.patch'), rawPatch, 'utf8');

    const res = await fetch(`${base}/api/runs/${idWithPatch}/patch`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/x-diff');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="omnipilot-changes-${idWithPatch}.diff"`);

    const diff = await res.text();
    expect(diff).toContain('password.js');
    expect(diff).not.toContain('node_modules');
    expect(diff).not.toContain('.env');
    expect(diff).not.toContain('mysecretvalue999');

    // Run without changes
    const idEmpty = randomUUID();
    await mkdir(join(ws, idEmpty), { recursive: true });
    await writeFile(join(ws, idEmpty, 'changes.patch'), '   \n', 'utf8');

    const emptyRes = await fetch(`${base}/api/runs/${idEmpty}/patch`, { headers });
    expect(emptyRes.status).toBe(404);
    const body = await emptyRes.json();
    expect(body.error).toMatch(/No hay cambios/i);
  });
});
