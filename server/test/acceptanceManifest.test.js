import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectLocalProject,
  validateLocalProjectSource,
  captureAcceptanceManifest,
  verifyAcceptanceManifest,
} from '../src/projects/localProjects.js';
import { createRun, startRun } from '../src/orchestrator/orchestrator.js';
import { runProcess } from '../src/connectors/processRunner.js';

let tempDirs = [];
async function makeTempDir(prefix = 'omnipilot-sec-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Hotfix Seguridad — Scripts de aceptación prepermitidos e inmutables', () => {
  it('filtra scripts por allowlist y rechaza scripts fuera de allowlist', async () => {
    const projectsRoot = await makeTempDir('omnipilot-proj-');
    const projDir = join(projectsRoot, 'app');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: {
        test: 'node -e "process.exit(0)"',
        lint: 'echo lint',
        dev: 'vite',
        evil: 'rm -rf /',
      },
    }), 'utf8');

    const inspected = await inspectLocalProject({ projectsRoot, projectPath: 'app' });
    expect(inspected.scripts).toEqual(['lint', 'test']);

    const valid = await validateLocalProjectSource({ projectsRoot, projectPath: 'app', acceptanceScript: 'test' });
    expect(valid.acceptanceScript).toBe('test');

    await expect(validateLocalProjectSource({ projectsRoot, projectPath: 'app', acceptanceScript: 'evil' }))
      .rejects.toThrow(/allowlist segura/i);
    await expect(validateLocalProjectSource({ projectsRoot, projectPath: 'app', acceptanceScript: 'dev' }))
      .rejects.toThrow(/allowlist segura/i);
  });

  it('bloquea verificación con acceptance_manifest_changed si package.json cambia durante la ejecución', async () => {
    const projectsRoot = await makeTempDir('omnipilot-proj-');
    const workspacesRoot = await makeTempDir('omnipilot-ws-');
    const projDir = join(projectsRoot, 'app');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { test: 'node -e "process.exit(0)"' },
    }), 'utf8');

    let npmRunCalledAfterTamper = false;
    let tampered = false;
    const customRunner = async (opts) => {
      if (tampered && opts.command.startsWith('npm') && opts.args[0] === 'run') {
        npmRunCalledAfterTamper = true;
      }
      return runProcess(opts);
    };

    const fakeCodex = {
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          tampered = true;
          await writeFile(join(ctx.workspace, 'package.json'), JSON.stringify({
            name: 'app',
            scripts: { test: 'echo pwned' },
          }), 'utf8');
        }
        return { ok: true, code: 0, output: 'ok', ms: 5, cancelled: false };
      },
    };

    const run = createRun('Editar app', 'codex', {
      type: 'local-project',
      projectPath: 'app',
      acceptanceScript: 'test',
    });
    await startRun(run, workspacesRoot, {
      codex: fakeCodex,
      antigravityValidated: false,
      runner: customRunner,
      projectsRoot,
    });

    expect(run.status).toBe('acceptance_manifest_changed');
    expect(npmRunCalledAfterTamper).toBe(false);
    expect(run.memory.problems.join(' ')).toContain('La definición de la prueba de aceptación cambió durante la ejecución.');
  });

  it('detecta modificación de package-lock.json mediante lockfileHash', async () => {
    const ws = await makeTempDir('omnipilot-lock-');
    await writeFile(join(ws, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { test: 'node -e "process.exit(0)"' },
    }), 'utf8');
    await writeFile(join(ws, 'package-lock.json'), '{"name":"app","lockfileVersion":3}\n', 'utf8');

    const manifest = await captureAcceptanceManifest(ws, 'test');
    expect(manifest.lockfileHash).toBeTruthy();
    expect(await verifyAcceptanceManifest(ws, manifest)).toBe(true);

    await writeFile(join(ws, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"tampered":true}\n', 'utf8');
    await expect(verifyAcceptanceManifest(ws, manifest))
      .rejects.toThrow('La definición de la prueba de aceptación cambió durante la ejecución.');
  });
});
