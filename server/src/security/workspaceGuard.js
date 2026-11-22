import { resolve, relative, isAbsolute } from 'node:path';
import { runProcess } from '../connectors/processRunner.js';

export function resolveSafeWorkspacePath(root, ...segments) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Ruta raíz inválida');
  const base = resolve(root);
  const target = resolve(base, ...segments);
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Ruta fuera del workspace');
  }
  return target;
}

export async function initGitWorkspace(workspaceDir, { runner = runProcess, signal } = {}) {
  const res = await runner({ command: 'git', args: ['init', '--quiet'], cwd: workspaceDir, timeoutMs: 10000, signal });
  if (res.cancelled) throw new Error('Cancelado');
  if (res.code !== 0 || res.error) throw new Error(`Error al inicializar Git: ${res.error || res.stderr.trim()}`);
}

export async function getGitStatus(workspaceDir, { runner = runProcess, signal } = {}) {
  const res = await runner({
    command: 'git',
    args: ['status', '--porcelain', '--untracked-files=all'],
    cwd: workspaceDir,
    timeoutMs: 10000,
    signal,
  });
  if (res.cancelled) throw new Error('Cancelado');
  if (res.code !== 0 || res.error) throw new Error(`Error al consultar git status: ${res.error || res.stderr.trim()}`);
  const lines = res.stdout.split(/\r?\n/).filter(Boolean).sort();
  const files = lines.map(line => line.slice(3).trim()).filter(Boolean);
  return { raw: lines.join('\n'), files };
}
