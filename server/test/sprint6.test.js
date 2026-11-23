import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/api/app.js';

let servers = [];
let tempDirs = [];

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setupServerWithProject() {
  const projectsRoot = await makeTempDir('omnipilot-s6-root-');
  const workspacesDir = await makeTempDir('omnipilot-s6-ws-');
  const conversationsDir = await makeTempDir('omnipilot-s6-conv-');
  const projectDir = join(projectsRoot, 'prueba-omnipilot');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'package.json'), JSON.stringify({
    name: 'prueba-omnipilot',
    scripts: { test: 'node --test' },
  }));

  const token = 's6-local-token';
  const app = createApp({
    token,
    port: 0,
    projectsRoot,
    workspacesDir,
    conversationsDir,
    codex: {
      async isAvailable() { return { available: true, version: 'fake', error: null }; },
      async run() { return { ok: true, code: 0, output: 'ok', ms: 2, cancelled: false }; },
    },
    antigravity: { async isAvailable() { return { available: false, version: null, error: 'no' }; } },
  });
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, token, projectsRoot, projectDir };
}

afterEach(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  servers = [];
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Sprint 6 — Proyecto persistente por chat y flujo unificado', () => {
  it('persiste projectConfig por conversación, "dale" no crea run, y tarea concreta usa prueba-omnipilot', async () => {
    const { baseUrl, token } = await setupServerWithProject();

    const conv = await (await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    })).json();

    const cfgRes = await fetch(`${baseUrl}/api/conversations/${conv.id}/project-config`, {
      method: 'PUT',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'local-project',
        projectPath: 'prueba-omnipilot',
        acceptanceScript: 'test',
      }),
    });
    expect(cfgRes.status).toBe(200);
    const cfgBody = await cfgRes.json();
    expect(cfgBody.projectConfig.projectName).toBe('prueba-omnipilot');
    expect(cfgBody.projectConfig.acceptanceScript).toBe('test');

    // "dale" must NOT create a run
    const daleRes = await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'dale', mode: 'codex' }),
    });
    expect(daleRes.status).toBe(201);
    const daleBody = await daleRes.json();
    expect(daleBody.run).toBeNull();

    // Concrete task creates pending plan with exact prueba-omnipilot source
    const taskRes = await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Agrega una función sum en index.js', mode: 'codex' }),
    });
    expect(taskRes.status).toBe(201);
    const taskBody = await taskRes.json();
    expect(taskBody.run.status).toBe('pending');
    expect(taskBody.run.source).toEqual({
      type: 'local-project',
      projectPath: 'prueba-omnipilot',
      acceptanceScript: 'test',
    });

    // Reloading conversation returns persisted projectConfig and runId
    const reloaded = await (await fetch(`${baseUrl}/api/conversations/${conv.id}`, {
      headers: { 'X-Omni-Token': token },
    })).json();
    expect(reloaded.projectConfig.projectName).toBe('prueba-omnipilot');
    expect(reloaded.runIds).toContain(taskBody.run.id);

    // New conversation preselects last valid config
    const nextConv = await (await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectConfig: reloaded.projectConfig }),
    })).json();
    expect(nextConv.projectConfig.projectPath).toBe('prueba-omnipilot');
  });

  it('rechaza aprobación si se manipula package.json o se convierte en symlink antes de ejecutar', async () => {
    const { baseUrl, token, projectDir } = await setupServerWithProject();

    const conv = await (await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    })).json();

    await fetch(`${baseUrl}/api/conversations/${conv.id}/project-config`, {
      method: 'PUT',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'local-project',
        projectPath: 'prueba-omnipilot',
        acceptanceScript: 'test',
      }),
    });

    const taskBody = await (await fetch(`${baseUrl}/api/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Corrige helper.js', mode: 'codex' }),
    })).json();

    // Tamper package.json (remove test script)
    await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'prueba-omnipilot', scripts: {} }));
    const tampered = await fetch(`${baseUrl}/api/runs/${taskBody.run.id}/approve`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    });
    expect(tampered.status).toBe(400);

    // Restore package.json but replace projectDir with a symlink
    const outside = await makeTempDir('omnipilot-outside-');
    await rm(projectDir, { recursive: true, force: true });
    await symlink(outside, projectDir);
    const symlinkRes = await fetch(`${baseUrl}/api/runs/${taskBody.run.id}/approve`, {
      method: 'POST',
      headers: { 'X-Omni-Token': token },
    });
    expect(symlinkRes.status).toBe(400);
  });
});
