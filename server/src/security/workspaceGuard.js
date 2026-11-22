import { lstat, realpath, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { runProcess } from '../connectors/processRunner.js';

function isOutside(root, target) {
  const rel = relative(root, target);
  return !rel || rel.startsWith('..') || isAbsolute(rel);
}

async function rejectSymlinks(path) {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) throw new Error('Symlink no permitido en workspace');
  if (!stats.isDirectory()) return;
  for (const entry of await readdir(path)) await rejectSymlinks(join(path, entry));
}

export async function resolveSafeWorkspacePath(root, ...segments) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Ruta raíz inválida');
  if (segments.some(segment => typeof segment !== 'string' || isAbsolute(segment) || segment.split(/[\\/]+/).includes('..'))) {
    throw new Error('Ruta fuera del workspace');
  }
  const base = resolve(root);
  const target = resolve(base, ...segments);
  if (isOutside(base, target)) throw new Error('Ruta fuera del workspace');

  const baseStats = await lstat(base);
  if (baseStats.isSymbolicLink()) throw new Error('Symlink no permitido en workspace');
  const realBase = await realpath(base);
  let current = base;
  for (const part of relative(base, target).split(/[\\/]+/)) {
    current = join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error('Symlink no permitido en workspace');
      if (isOutside(realBase, await realpath(current))) throw new Error('Ruta fuera del workspace');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  try {
    await rejectSymlinks(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return target;
}

export async function initGitWorkspace(workspaceDir, { runner = runProcess, signal } = {}) {
  const res = await runner({ command: 'git', args: ['init', '--quiet'], cwd: workspaceDir, timeoutMs: 10000, signal });
  if (res.cancelled) throw new Error('Cancelado');
  if (res.code !== 0 || res.error) throw new Error(`Error al inicializar Git: ${res.error || res.stderr.trim()}`);
}

export async function commitBaseline(workspaceDir, { runner = runProcess, signal } = {}) {
  const add = await runner({ command: 'git', args: ['add', '-A'], cwd: workspaceDir, timeoutMs: 10000, signal });
  if (add.cancelled) throw new Error('Cancelado');
  if (add.code !== 0 || add.error) throw new Error(`Error en git add: ${add.error || add.stderr.trim()}`);

  const commit = await runner({
    command: 'git',
    args: [
      '-c', 'user.name=OmniPilot Local',
      '-c', 'user.email=omnipilot@local.invalid',
      '-c', 'commit.gpgsign=false',
      'commit', '-m', 'Baseline workspace', '--quiet',
    ],
    cwd: workspaceDir,
    timeoutMs: 10000,
    signal,
  });
  if (commit.cancelled) throw new Error('Cancelado');
  if (commit.code !== 0 || commit.error) throw new Error(`Error en commit base: ${commit.error || commit.stderr.trim()}`);
}

export async function captureGitPatch(workspaceDir, { runner = runProcess, signal } = {}) {
  const add = await runner({ command: 'git', args: ['add', '-A'], cwd: workspaceDir, timeoutMs: 10000, signal });
  if (add.cancelled) throw new Error('Cancelado');
  if (add.code !== 0 || add.error) throw new Error(`Error al preparar parche: ${add.error || add.stderr.trim()}`);
  const diff = await runner({
    command: 'git',
    args: ['diff', '--cached', '--binary', '--no-ext-diff', 'HEAD', '--'],
    cwd: workspaceDir,
    timeoutMs: 10000,
    signal,
  });
  if (diff.cancelled) throw new Error('Cancelado');
  if (diff.code !== 0 || diff.error) throw new Error(`Error al calcular parche: ${diff.error || diff.stderr.trim()}`);
  return diff.stdout;
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
