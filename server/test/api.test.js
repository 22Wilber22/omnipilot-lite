import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/api/app.js';

const validPasswordImpl = `export function validatePassword(p) {
  return typeof p === 'string' && p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p);
}\n`;

let servers = [];
let tempDirs = [];

async function startTestServer(options = {}) {
  const workspacesDir = await mkdtemp(join(tmpdir(), 'omnipilot-api-'));
  tempDirs.push(workspacesDir);
  const token = 'test-local-token';
  const app = createApp({ token, port: 0, workspacesDir, ...options });
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return { baseUrl, token, workspacesDir };
}

afterEach(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  servers = [];
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

async function waitForTerminal(baseUrl, token, id) {
  for (let i = 0; i < 60; i += 1) {
    const r = await fetch(`${baseUrl}/api/runs/${id}`, { headers: { 'X-Omni-Token': token } });
    const data = await r.json();
    if (data.completedAt && !['pending', 'running'].includes(data.status)) return data;
    await new Promise(res => setTimeout(res, 50));
  }
  throw new Error('Timeout esperando estado terminal');
}

describe('Sprint 3A — API local y SSE (conectores falsos)', () => {
  it('inspecciona un proyecto permitido y valida source local-project al crear el run', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'omnipilot-projects-api-'));
    tempDirs.push(projectsRoot);
    const project = join(projectsRoot, 'allowed-project');
    await mkdir(join(project, '.git'), { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      name: 'allowed-project',
      scripts: { test: 'node --test' },
    }));
    const { baseUrl, token } = await startTestServer({ projectsRoot });

    const inspected = await fetch(`${baseUrl}/api/projects/inspect`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: 'allowed-project' }),
    });
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toEqual({
      name: 'allowed-project',
      projectPath: 'allowed-project',
      scripts: ['test'],
      isGitRepository: true,
    });

    const created = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Ejecutar proyecto permitido',
        mode: 'codex',
        source: { type: 'local-project', projectPath: 'allowed-project', acceptanceScript: 'test' },
      }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).source).toEqual({
      type: 'local-project',
      projectPath: 'allowed-project',
      acceptanceScript: 'test',
    });
  });

  it('protege /api con token y rechaza Origin externo', async () => {
    const { baseUrl, token } = await startTestServer({
      codex: { async isAvailable() { return { available: true, version: 'codex-fake', error: null }; } },
      antigravity: { async isAvailable() { return { available: false, version: null, error: 'missing' }; } },
    });

    const noToken = await fetch(`${baseUrl}/api/diagnostics`);
    expect(noToken.status).toBe(401);

    const badOrigin = await fetch(`${baseUrl}/api/diagnostics`, {
      headers: { 'X-Omni-Token': token, Origin: 'https://evil.example' },
    });
    expect(badOrigin.status).toBe(403);

    const ok = await fetch(`${baseUrl}/api/diagnostics`, { headers: { 'X-Omni-Token': token } });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.codex.available).toBe(true);
    expect(body.antigravity.available).toBe(false);
  });

  it('ejecuta flujo completo con Antigravity revisor y entrega eventos SSE', async () => {
    const fakeCodex = {
      async isAvailable() { return { available: true, version: 'codex-fake', error: null }; },
      async run(_prompt, ctx) {
        await writeFile(join(ctx.workspace, 'password.js'), validPasswordImpl);
        return { ok: true, code: 0, output: 'Implementado', ms: 5, cancelled: false };
      },
    };
    const fakeAgy = {
      async isAvailable() { return { available: true, version: 'agy-fake', error: null }; },
      async run() {
        return { ok: true, code: 0, status: 'SUCCESS', untrustedResponse: 'Revisión OK', ms: 4, cancelled: false };
      },
    };

    const { baseUrl, token } = await startTestServer({
      codex: fakeCodex,
      antigravity: fakeAgy,
      antigravityValidated: true,
    });

    const created = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Implementar validatePassword', mode: 'codex', acceptance: 'node --test password.test.js' }),
    });
    expect(created.status).toBe(201);
    const run = await created.json();
    expect(run.plan).toHaveLength(4);

    const approved = await fetch(`${baseUrl}/api/runs/${run.id}/approve`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    });
    expect(approved.status).toBe(200);

    const finalRun = await waitForTerminal(baseUrl, token, run.id);
    expect(finalRun.status).toBe('completed');
    expect(finalRun.memory.steps.map(s => s.agent)).toEqual(['codex-implement', 'antigravity-review', 'local-verifier']);

    // Read SSE stream (replays all events) and close
    const ac = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/runs/${run.id}/events`, {
      headers: { 'X-Omni-Token': token },
      signal: ac.signal,
    });
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
    const reader = sseRes.body.getReader();
    const { value } = await reader.read();
    ac.abort();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('"type":"plan.created"');
    expect(text).toContain('"type":"run.approved"');
    expect(text).toContain('"type":"step.started"');
    expect(text).toContain('"type":"step.completed"');
    expect(text).toContain('"type":"files.changed"');
    expect(text).toContain('"type":"verification.completed"');
    expect(text).toContain('"type":"run.completed"');

    // Cancel on completed run returns 409
    const cancelCompleted = await fetch(`${baseUrl}/api/runs/${run.id}/cancel`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    });
    expect(cancelCompleted.status).toBe(409);
  });

  it('cancela una ejecución activa vía API y emite run.cancelled', async () => {
    let release;
    const fakeCodex = {
      async isAvailable() { return { available: true, version: 'codex-fake', error: null }; },
      async run(_prompt, ctx) {
        return new Promise(resolve => {
          release = () => resolve({ ok: false, code: null, output: '', ms: 10, cancelled: true });
          ctx.signal.addEventListener('abort', release, { once: true });
        });
      },
    };
    const fakeAgy = { async isAvailable() { return { available: false, version: null, error: 'no' }; } };

    const { baseUrl, token } = await startTestServer({ codex: fakeCodex, antigravity: fakeAgy });
    const created = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Cancelar en vivo', mode: 'codex' }),
    });
    const run = await created.json();
    await fetch(`${baseUrl}/api/runs/${run.id}/approve`, { method: 'POST', headers: { 'X-Omni-Token': token } });
    await new Promise(r => setTimeout(r, 80));

    const cancelled = await fetch(`${baseUrl}/api/runs/${run.id}/cancel`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    });
    expect(cancelled.status).toBe(200);

    const finalRun = await waitForTerminal(baseUrl, token, run.id);
    expect(finalRun.status).toBe('cancelled');
    expect(finalRun.events.some(e => e.type === 'run.cancelled')).toBe(true);
  });

  it('hace fallback a Codex read-only si Antigravity no está validado o disponible', async () => {
    const fakeCodex = {
      async isAvailable() { return { available: true, version: 'codex-fake', error: null }; },
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          await writeFile(join(ctx.workspace, 'password.js'), validPasswordImpl);
        }
        return { ok: true, code: 0, output: `OK ${ctx.sandbox}`, ms: 4, cancelled: false };
      },
    };
    const fakeAgy = {
      async isAvailable() { return { available: true, version: 'agy-fake', error: null }; },
      async run() { throw new Error('No debe llamarse si no está validado'); },
    };

    const { baseUrl, token } = await startTestServer({
      codex: fakeCodex,
      antigravity: fakeAgy,
      antigravityValidated: false,
    });

    const created = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Fallback test', mode: 'codex' }),
    });
    const run = await created.json();
    await fetch(`${baseUrl}/api/runs/${run.id}/approve`, { method: 'POST', headers: { 'X-Omni-Token': token } });
    const finalRun = await waitForTerminal(baseUrl, token, run.id);

    expect(finalRun.status).toBe('completed');
    expect(finalRun.memory.steps.map(s => s.agent)).toEqual(['codex-implement', 'codex-review', 'local-verifier']);
    expect(finalRun.events.some(e => e.type === 'log' && /Fallback/i.test(e.message))).toBe(true);
  });
});
