import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, startRun, cancelRun } from '../src/orchestrator/orchestrator.js';
import { readMemory } from '../src/memory/store.js';
import { resolveSafeWorkspacePath } from '../src/security/workspaceGuard.js';

const validPasswordImpl = `export function validatePassword(p) {
  return typeof p === 'string' && p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p);
}\n`;
const brokenPasswordImpl = `export function validatePassword() { return false; }\n`;

let tempRoots = [];
async function makeTempRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'omnipilot-s2-'));
  tempRoots.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of tempRoots) await rm(dir, { recursive: true, force: true });
  tempRoots = [];
});

describe('Sprint 2 — ejecución trazable con Codex (conectores falsos)', () => {
  it('flujo exitoso: implementa, revisa en read-only, verifica y guarda proyecto.json + events.jsonl', async () => {
    const root = await makeTempRoot();
    const calls = [];
    const fakeCodex = {
      async run(prompt, ctx) {
        calls.push({ sandbox: ctx.sandbox, prompt });
        if (ctx.sandbox === 'workspace-write') {
          await writeFile(join(ctx.workspace, 'password.js'), validPasswordImpl);
          return { ok: true, code: 0, output: 'Implementado password.js', ms: 5, cancelled: false };
        }
        return { ok: true, code: 0, output: 'Revisión OK', ms: 3, cancelled: false };
      },
    };
    const run = createRun('Implementar validatePassword', 'codex');
    await startRun(run, root, { codex: fakeCodex });

    expect(run.status).toBe('completed');
    expect(calls.map(c => c.sandbox)).toEqual(['workspace-write', 'read-only']);
    const memory = await readMemory(join(root, run.id));
    expect(memory.goal).toBe('Implementar validatePassword');
    expect(memory.plan).toHaveLength(4);
    expect(memory.steps.map(s => s.agent)).toEqual(['codex-implement', 'codex-review', 'local-verifier']);
    expect(memory.steps[0].files).toContain('password.js');
    const eventsRaw = await readFile(join(root, run.id, 'events.jsonl'), 'utf8');
    expect(eventsRaw).toContain('"type":"plan"');
    expect(eventsRaw).toContain('"type":"review"');
    expect(eventsRaw).toContain('"type":"verify"');
  });

  it('un fallo seguido de una única corrección exitosa', async () => {
    const root = await makeTempRoot();
    let writeCalls = 0;
    const fakeCodex = {
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          writeCalls += 1;
          await writeFile(join(ctx.workspace, 'password.js'), writeCalls === 1 ? brokenPasswordImpl : validPasswordImpl);
          return { ok: true, code: 0, output: `Intento ${writeCalls}`, ms: 4, cancelled: false };
        }
        return { ok: true, code: 0, output: 'Revisión OK', ms: 2, cancelled: false };
      },
    };
    const run = createRun('Corregir validatePassword', 'codex');
    await startRun(run, root, { codex: fakeCodex });

    expect(run.status).toBe('completed');
    expect(writeCalls).toBe(2);
    const memory = await readMemory(join(root, run.id));
    expect(memory.steps.map(s => s.agent)).toEqual([
      'codex-implement',
      'codex-review',
      'local-verifier',
      'codex-fix',
      'local-verifier',
    ]);
  });

  it('corte por falta de progreso tras un único reintento', async () => {
    const root = await makeTempRoot();
    let writeCalls = 0;
    const fakeCodex = {
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          writeCalls += 1;
          await writeFile(join(ctx.workspace, 'password.js'), brokenPasswordImpl);
          return { ok: true, code: 0, output: 'Sin solución real', ms: 4, cancelled: false };
        }
        return { ok: true, code: 0, output: 'Revisión OK', ms: 2, cancelled: false };
      },
    };
    const run = createRun('Tarea sin progreso', 'codex');
    await startRun(run, root, { codex: fakeCodex });

    expect(run.status).toBe('failed');
    expect(writeCalls).toBe(2);
    expect(run.memory.problems.join(' ')).toMatch(/falta de progreso/i);
  });

  it('detiene la ejecución si el revisor modifica archivos', async () => {
    const root = await makeTempRoot();
    const fakeCodex = {
      async run(_prompt, ctx) {
        if (ctx.sandbox === 'workspace-write') {
          await writeFile(join(ctx.workspace, 'password.js'), validPasswordImpl);
          return { ok: true, code: 0, output: 'Implementado', ms: 3, cancelled: false };
        }
        await writeFile(join(ctx.workspace, 'sneaky.txt'), 'modified during review');
        return { ok: true, code: 0, output: 'Modifiqué algo', ms: 3, cancelled: false };
      },
    };
    const run = createRun('Detectar violación en revisión', 'codex');
    await startRun(run, root, { codex: fakeCodex });

    expect(run.status).toBe('failed');
    expect(run.memory.problems.join(' ')).toMatch(/Violación de solo lectura/i);
    expect(run.memory.steps.map(s => s.agent)).toEqual(['codex-implement', 'codex-review']);
  });

  it('rechaza JSON corrupto en proyecto.json', async () => {
    const root = await makeTempRoot();
    await writeFile(join(root, 'proyecto.json'), '{corrupt json');
    await expect(readMemory(root)).rejects.toThrow();
  });

  it('rechaza rutas que intentan salir del workspace', async () => {
    const root = await makeTempRoot();
    expect(() => resolveSafeWorkspacePath(root, '../escape')).toThrow(/fuera del workspace/i);
    expect(() => resolveSafeWorkspacePath(root, '/etc/passwd')).toThrow(/fuera del workspace/i);

    const run = createRun('Escape path', 'codex');
    run.id = '../escape';
    await startRun(run, root, { codex: { async run() { return { ok: true, code: 0, output: '', ms: 1 }; } } });
    expect(run.status).toBe('failed');
    expect(run.memory.problems.join(' ')).toMatch(/fuera del workspace/i);
  });

  it('registra cancelación correctamente', async () => {
    const root = await makeTempRoot();
    const run = createRun('Cancelar durante ejecución', 'codex');
    const fakeCodex = {
      async run(_prompt, ctx) {
        cancelRun(run);
        return { ok: false, code: null, output: '', ms: 5, cancelled: ctx.signal.aborted };
      },
    };
    await startRun(run, root, { codex: fakeCodex });

    expect(run.status).toBe('cancelled');
    const eventsRaw = await readFile(join(root, run.id, 'events.jsonl'), 'utf8');
    expect(eventsRaw).toContain('"type":"cancel"');
  });
});
