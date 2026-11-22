import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  copyLocalProject,
  inspectLocalProject,
  validateLocalProjectSource,
} from '../src/projects/localProjects.js';
import { createRun, startRun } from '../src/orchestrator/orchestrator.js';
import { readMemory } from '../src/memory/store.js';

let tempDirs = [];

async function makeTempDir(prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

async function createProject(root, name = 'sample-project') {
  const project = join(root, name);
  await mkdir(join(project, '.git'), { recursive: true });
  await mkdir(join(project, 'node_modules'), { recursive: true });
  await writeFile(join(project, 'package.json'), JSON.stringify({
    name,
    type: 'module',
    scripts: { test: 'node --test', lint: 'node --check value.js' },
  }));
  await writeFile(join(project, 'value.js'), 'export const value = 1;\n');
  await writeFile(join(project, 'value.test.js'), `
    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { value } from './value.js';
    test('value', () => assert.equal(value, 2));
  `);
  await writeFile(join(project, '.env'), 'SECRET=not-copied\n');
  await writeFile(join(project, 'private.pem'), 'not-copied\n');
  await writeFile(join(project, 'node_modules', 'ignored.js'), 'not copied\n');
  return project;
}

afterEach(async () => {
  for (const path of tempDirs) await rm(path, { recursive: true, force: true });
  tempDirs = [];
});

describe('proyectos locales permitidos', () => {
  it('inspecciona package.json sin ejecutar scripts', async () => {
    const projectsRoot = await makeTempDir('omnipilot-projects-');
    await createProject(projectsRoot);

    await expect(inspectLocalProject({ projectsRoot, projectPath: 'sample-project' })).resolves.toEqual({
      name: 'sample-project',
      projectPath: 'sample-project',
      scripts: ['lint', 'test'],
      isGitRepository: true,
    });
  });

  it('rechaza escapes, rutas absolutas y PROJECTS_ROOT inexistente', async () => {
    const projectsRoot = await makeTempDir('omnipilot-projects-');
    await expect(inspectLocalProject({ projectsRoot, projectPath: '../escape' })).rejects.toThrow(/fuera de PROJECTS_ROOT/i);
    await expect(inspectLocalProject({ projectsRoot, projectPath: '/tmp/escape' })).rejects.toThrow(/fuera de PROJECTS_ROOT/i);
    await expect(inspectLocalProject({ projectsRoot: join(projectsRoot, 'missing'), projectPath: 'project' })).rejects.toThrow(/PROJECTS_ROOT no existe/i);
  });

  it('rechaza un projectPath que es symlink', async () => {
    const projectsRoot = await makeTempDir('omnipilot-projects-');
    const outside = await makeTempDir('omnipilot-outside-');
    await createProject(outside, 'outside-project');
    await symlink(join(outside, 'outside-project'), join(projectsRoot, 'linked-project'));

    await expect(inspectLocalProject({ projectsRoot, projectPath: 'linked-project' })).rejects.toThrow(/symlink/i);
  });

  it('rechaza symlinks en componentes intermedios de projectPath', async () => {
    const projectsRoot = await makeTempDir('omnipilot-projects-');
    const realParent = join(projectsRoot, 'real-parent');
    await mkdir(realParent);
    await createProject(realParent, 'nested-project');
    await symlink(realParent, join(projectsRoot, 'linked-parent'));

    await expect(inspectLocalProject({
      projectsRoot,
      projectPath: 'linked-parent/nested-project',
    })).rejects.toThrow(/symlink/i);
  });

  it('acepta solo una clave de scripts existente', async () => {
    const projectsRoot = await makeTempDir('omnipilot-projects-');
    await createProject(projectsRoot);

    await expect(validateLocalProjectSource({
      projectsRoot,
      projectPath: 'sample-project',
      acceptanceScript: 'test',
    })).resolves.toEqual({ type: 'local-project', projectPath: 'sample-project', acceptanceScript: 'test' });
    await expect(validateLocalProjectSource({
      projectsRoot,
      projectPath: 'sample-project',
      acceptanceScript: 'missing',
    })).rejects.toThrow(/inexistente/i);
  });

  it('copia sin dependencias, Git ni secretos comunes', async () => {
    const projectsRoot = await makeTempDir('omnipilot-projects-');
    const destinationRoot = await makeTempDir('omnipilot-copy-');
    await createProject(projectsRoot);
    const destination = join(destinationRoot, 'project');

    await copyLocalProject({
      projectsRoot,
      projectPath: 'sample-project',
      acceptanceScript: 'test',
      destination,
    });

    await expect(access(join(destination, 'package.json'))).resolves.toBeUndefined();
    await expect(access(join(destination, '.git'))).rejects.toThrow();
    await expect(access(join(destination, '.env'))).rejects.toThrow();
    await expect(access(join(destination, 'private.pem'))).rejects.toThrow();
    await expect(access(join(destination, 'node_modules'))).rejects.toThrow();
  });

  it('modifica solo la copia y ejecuta el script de aceptación validado', async () => {
    const projectsRoot = await makeTempDir('omnipilot-projects-');
    const workspacesRoot = await makeTempDir('omnipilot-workspaces-');
    const sourceProject = await createProject(projectsRoot);
    const source = await validateLocalProjectSource({
      projectsRoot,
      projectPath: 'sample-project',
      acceptanceScript: 'test',
    });
    const fakeCodex = {
      async run(_prompt, context) {
        if (context.sandbox === 'workspace-write') {
          await writeFile(join(context.workspace, 'value.js'), 'export const value = 2;\n');
        }
        return { ok: true, code: 0, output: 'OK', ms: 2, cancelled: false };
      },
    };
    const run = createRun('Corregir value', 'codex', source);

    await startRun(run, workspacesRoot, {
      codex: fakeCodex,
      antigravityValidated: false,
      projectsRoot,
    });

    expect(run.status).toBe('completed');
    expect(await readFile(join(sourceProject, 'value.js'), 'utf8')).toBe('export const value = 1;\n');
    expect(await readFile(join(workspacesRoot, run.id, 'project', 'value.js'), 'utf8')).toBe('export const value = 2;\n');
    expect(await readFile(join(workspacesRoot, run.id, 'changes.patch'), 'utf8')).toContain('value.js');
    const memory = await readMemory(join(workspacesRoot, run.id));
    expect(memory.source).toEqual(source);
    expect(memory.acceptance).toBe('npm run test');
    expect(memory.steps.at(-1).files).toContain('value.js');
    expect(run.events.some(event => event.type === 'verification.completed' && event.passed)).toBe(true);
  });
});
