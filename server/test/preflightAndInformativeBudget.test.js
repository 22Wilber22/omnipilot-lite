import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, startRun } from '../src/orchestrator/orchestrator.js';
import { createApp } from '../src/api/app.js';
import { readMemory } from '../src/memory/store.js';
import { runProcess } from '../src/connectors/processRunner.js';

let tempDirs = [];
async function makeTempDir(prefix = 'omnipilot-pf-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Hotfix E2E — Preflight de dependencias, evidencia de test y presupuesto informativo', () => {
  it('ejecuta npm ci --ignore-scripts antes de agentes cuando hay package-lock.json y excluye node_modules del patch', async () => {
    const projectsRoot = await makeTempDir('omnipilot-proj-');
    const workspacesRoot = await makeTempDir('omnipilot-ws-');
    const projDir = join(projectsRoot, 'demo-app');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'package.json'), JSON.stringify({
      name: 'demo-app',
      dependencies: { fake: '1.0.0' },
      scripts: { test: 'node -e "process.exit(0)"' },
    }), 'utf8');
    await writeFile(join(projDir, 'package-lock.json'), '{"name":"demo-app","lockfileVersion":3}\n', 'utf8');
    await writeFile(join(projDir, 'README.md'), '# Demo\n', 'utf8');

    const order = [];
    const customRunner = async (opts) => {
      if (opts.command.startsWith('npm') && opts.args[0] === 'ci') {
        order.push('preflight-npm-ci');
        await mkdir(join(opts.cwd, 'node_modules', 'fake'), { recursive: true });
        await writeFile(join(opts.cwd, 'node_modules', 'fake', 'index.js'), 'module.exports = 1;\n', 'utf8');
        return { code: 0, stdout: 'added 1 package', stderr: '', ms: 5, cancelled: false };
      }
      return runProcess(opts);
    };

    const fakeCodex = {
      async run(_prompt, ctx) {
        order.push(`codex-${ctx.sandbox}`);
        if (ctx.sandbox === 'workspace-write') {
          await writeFile(join(ctx.workspace, 'README.md'), '# Demo updated\n', 'utf8');
        }
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };

    const run = createRun('Actualizar README', 'codex', {
      type: 'local-project',
      projectPath: 'demo-app',
      acceptanceScript: 'test',
    });
    await startRun(run, workspacesRoot, {
      codex: fakeCodex,
      antigravityValidated: false,
      runner: customRunner,
      projectsRoot,
    });

    expect(run.status).toBe('completed');
    expect(order[0]).toBe('preflight-npm-ci');
    expect(order[1]).toBe('codex-workspace-write');

    const patch = await readFile(join(workspacesRoot, run.id, 'changes.patch'), 'utf8');
    expect(patch).toContain('README.md');
    expect(patch).not.toContain('node_modules');
  });

  it('reintenta una vez el fallo transitorio de IPC de Vitest y conserva el bloqueo para fallos reales', async () => {
    const projectsRoot = await makeTempDir('omnipilot-proj-');
    const workspacesRoot = await makeTempDir('omnipilot-ws-');
    const projDir = join(projectsRoot, 'ipc-app');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'package.json'), JSON.stringify({
      name: 'ipc-app',
      devDependencies: { vitest: '3.2.7' },
      scripts: { test: 'vitest run' },
    }), 'utf8');
    await writeFile(join(projDir, 'package-lock.json'), '{"name":"ipc-app","lockfileVersion":3}\n', 'utf8');
    await writeFile(join(projDir, 'README.md'), '# Antes\n', 'utf8');

    let acceptanceCalls = 0;
    const acceptanceArgs = [];
    const customRunner = async opts => {
      if (opts.command.startsWith('npm') && opts.args[0] === 'ci') {
        await mkdir(join(opts.cwd, 'node_modules'), { recursive: true });
        return { code: 0, stdout: 'installed', stderr: '', ms: 1, cancelled: false };
      }
      if (opts.command.startsWith('npm') && opts.args[0] === 'run') {
        acceptanceCalls += 1;
        acceptanceArgs.push(opts.args);
        if (acceptanceCalls === 1) {
          return {
            code: 1,
            stdout: 'Vitest Tinypool deserialize Serialized Error: ERR_INVALID_ARG_TYPE',
            stderr: '',
            ms: 1,
            timedOut: false,
            cancelled: false,
          };
        }
        return { code: 0, stdout: '39 passed', stderr: '', ms: 1, cancelled: false };
      }
      return runProcess(opts);
    };
    const fakeCodex = {
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') await writeFile(join(ctx.workspace, 'README.md'), '# Después\n', 'utf8');
        return { ok: true, code: 0, output: 'ok', ms: 1, cancelled: false };
      },
    };
    const run = createRun('Actualizar README', 'codex', {
      type: 'local-project', projectPath: 'ipc-app', acceptanceScript: 'test',
    });

    await startRun(run, workspacesRoot, {
      codex: fakeCodex,
      antigravityValidated: false,
      runner: customRunner,
      projectsRoot,
    });

    expect(run.status).toBe('completed');
    expect(acceptanceCalls).toBe(3);
    expect(acceptanceArgs[1]).toEqual(['run', 'test', '--', '--pool=threads', '--maxWorkers=1']);
    expect(run.events.some(event => event.type === 'step.retrying' && event.reason === 'vitest-ipc-threads-fallback')).toBe(true);
  });

  it('detiene antes de Codex si hay dependencias pero falta package-lock.json', async () => {
    const projectsRoot = await makeTempDir('omnipilot-proj-');
    const workspacesRoot = await makeTempDir('omnipilot-ws-');
    const projDir = join(projectsRoot, 'no-lock');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'package.json'), JSON.stringify({
      name: 'no-lock',
      dependencies: { fake: '1.0.0' },
      scripts: { test: 'node -e "process.exit(0)"' },
    }), 'utf8');

    let codexCalled = false;
    const fakeCodex = {
      async run() {
        codexCalled = true;
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };

    const run = createRun('Editar algo', 'codex', {
      type: 'local-project',
      projectPath: 'no-lock',
      acceptanceScript: 'test',
    });
    await startRun(run, workspacesRoot, {
      codex: fakeCodex,
      antigravityValidated: false,
      projectsRoot,
    });

    expect(run.status).toBe('failed');
    expect(codexCalled).toBe(false);
    expect(run.memory.problems.join(' ')).toMatch(/package-lock\.json/i);
  });

  it('guarda salida sanitizada al fallar npm test y permite el único reintento aunque usage supere presupuesto informativo', async () => {
    const workspacesRoot = await makeTempDir('omnipilot-ws-');
    let writeCalls = 0;
    const fakeCodex = {
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          writeCalls += 1;
          if (writeCalls === 1) {
            await writeFile(join(ctx.workspace, 'password.js'), 'export function validatePassword() { console.error("token=secret999"); return false; }\n', 'utf8');
          } else {
            await writeFile(join(ctx.workspace, 'password.js'), 'export function validatePassword(p) { return typeof p === "string" && p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p); }\n', 'utf8');
          }
        }
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false, usage: { totalTokens: 99999 } };
      },
    };

    const run = createRun('Implementar validatePassword', 'codex', { type: 'template' }, { codex: 1000 });
    await startRun(run, workspacesRoot, { codex: fakeCodex, antigravityValidated: false });

    expect(run.status).toBe('completed');
    expect(writeCalls).toBe(2);
    const failedVerify = run.events.find(e => e.type === 'verification.completed' && e.passed === false);
    expect(failedVerify?.output).toBeTruthy();
    expect(failedVerify.output).not.toContain('secret999');
    const memory = await readMemory(join(workspacesRoot, run.id));
    expect(memory.steps.some(s => s.agent === 'codex-fix')).toBe(true);
  });

  it('usa npm ci sin --ignore-scripts en approved-scripts y detiene con baseline_failed sin llamar agentes si falla prueba base', async () => {
    const projectsRoot = await makeTempDir('omnipilot-proj-');
    const workspacesRoot = await makeTempDir('omnipilot-ws-');
    const projDir = join(projectsRoot, 'prueba-omnipilot');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'package.json'), JSON.stringify({
      name: 'omnipilot-lite',
      dependencies: { fake: '1.0.0' },
      scripts: { test: 'node -e "process.exit(1)"' },
    }), 'utf8');
    await writeFile(join(projDir, 'package-lock.json'), '{"name":"omnipilot-lite","lockfileVersion":3}\n', 'utf8');

    const capturedArgs = [];
    const customRunner = async (opts) => {
      if (opts.command.startsWith('npm') && opts.args[0] === 'ci') {
        capturedArgs.push(opts.args);
        return { code: 0, stdout: 'installed', stderr: '', ms: 5, cancelled: false };
      }
      return runProcess(opts);
    };

    let codexCalled = false;
    const fakeCodex = {
      async run() {
        codexCalled = true;
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };

    const run = createRun('Editar README', 'codex', {
      type: 'local-project',
      projectPath: 'prueba-omnipilot',
      acceptanceScript: 'test',
      dependencyInstallMode: 'approved-scripts',
    });
    await startRun(run, workspacesRoot, {
      codex: fakeCodex,
      antigravityValidated: false,
      runner: customRunner,
      projectsRoot,
    });

    expect(capturedArgs).toEqual([['ci']]);
    expect(run.status).toBe('baseline_failed');
    expect(codexCalled).toBe(false);
    expect(run.memory.preflight?.dependencyInstallMode).toBe('approved-scripts');
    expect(run.memory.preflight?.installStatus).toBe('ok');
    expect(run.memory.preflight?.baselineStatus).toBe('failed');
    expect(run.memory.source.projectPath).toBe('prueba-omnipilot');
  });

  it('persiste dependencyInstallMode=approved-scripts vía PUT/GET /api/conversations y lo propaga al run', async () => {
    const projectsRoot = await makeTempDir('omnipilot-proj-');
    const dataDir = await makeTempDir('omnipilot-data-');
    const wsDir = await makeTempDir('omnipilot-ws-');
    const projDir = join(projectsRoot, 'prueba-omnipilot');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'package.json'), JSON.stringify({
      name: 'omnipilot-lite',
      scripts: { test: 'node -e "process.exit(0)"' },
    }), 'utf8');

    const port = 4700 + Math.floor(Math.random() * 250);
    const token = 'tok-dep-mode';
    const app = createApp({
      token,
      port,
      projectsRoot,
      workspacesDir: wsDir,
      conversationsDir: join(dataDir, 'conversations'),
      settingsPath: join(dataDir, 'settings.json'),
    });
    const server = await new Promise(resolve => {
      const s = app.listen(port, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const headers = { 'X-Omni-Token': token, 'Content-Type': 'application/json' };
      const conv = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers })).json();

      const putRes = await (await fetch(`${base}/api/conversations/${conv.id}/project-config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          sourceType: 'local-project',
          projectPath: 'prueba-omnipilot',
          acceptanceScript: 'test',
          dependencyInstallMode: 'approved-scripts',
        }),
      })).json();
      expect(putRes.projectConfig.dependencyInstallMode).toBe('approved-scripts');
      expect(putRes.projectConfig.projectName).toBe('prueba-omnipilot');

      const getConv = await (await fetch(`${base}/api/conversations/${conv.id}`, { headers })).json();
      expect(getConv.projectConfig.dependencyInstallMode).toBe('approved-scripts');

      const taskRes = await (await fetch(`${base}/api/conversations/${conv.id}/convert-to-task`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ goal: 'Actualizar README', mode: 'codex' }),
      })).json();
      expect(taskRes.run.source.dependencyInstallMode).toBe('approved-scripts');
    } finally {
      await new Promise(r => server.close(r));
    }
  });
});
