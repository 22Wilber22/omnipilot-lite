import { lstat, realpath, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, sep } from 'node:path';
import { runProcess } from '../connectors/processRunner.js';

function isOutside(root, target) {
  const rel = relative(root, target);
  return !rel || rel.startsWith('..') || isAbsolute(rel);
}

async function isAllowedNpmBinSymlink(linkPath, workspaceRoot) {
  const rel = relative(workspaceRoot, linkPath);
  const parts = rel.split(/[\\/]+/);
  if (parts.length !== 3 || parts[0] !== 'node_modules' || parts[1] !== '.bin') return false;

  const nodeModulesPath = join(workspaceRoot, 'node_modules');
  const nmStats = await lstat(nodeModulesPath);
  if (nmStats.isSymbolicLink() || !nmStats.isDirectory()) return false;

  let realNodeModules;
  let realTarget;
  try {
    realNodeModules = await realpath(nodeModulesPath);
    realTarget = await realpath(linkPath);
  } catch {
    return false;
  }
  return realTarget.startsWith(realNodeModules + sep);
}

async function rejectSymlinks(currentPath, workspaceRoot, state) {
  const stats = await lstat(currentPath);
  if (stats.isSymbolicLink()) {
    if (await isAllowedNpmBinSymlink(currentPath, workspaceRoot)) {
      state.allowedNpmBinSymlinks += 1;
      return;
    }
    throw new Error('Symlink no permitido en workspace');
  }
  if (!stats.isDirectory()) return;
  for (const entry of await readdir(currentPath)) {
    await rejectSymlinks(join(currentPath, entry), workspaceRoot, state);
  }
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
  const state = { allowedNpmBinSymlinks: 0 };
  try {
    await rejectSymlinks(target, target, state);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return target;
}

const GIT_EXCLUDE_RULES = [
  'node_modules/',
  '**/node_modules/',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '.DS_Store',
].join('\n') + '\n';

const IGNORED_STATUS_RE = /(?:^|\/)(?:node_modules|\.git|\.env(?:\.[^/]+)?)(?:\/|$)/i;

export async function initGitWorkspace(workspaceDir, { runner = runProcess, signal } = {}) {
  const res = await runner({ command: 'git', args: ['init', '--quiet'], cwd: workspaceDir, timeoutMs: 10000, signal });
  if (res.cancelled) throw new Error('Cancelado');
  if (res.code !== 0 || res.error) throw new Error(`Error al inicializar Git: ${res.error || res.stderr.trim()}`);
  await writeFile(resolve(workspaceDir, '.git', 'info', 'exclude'), GIT_EXCLUDE_RULES, 'utf8');
}

export async function commitBaseline(workspaceDir, { runner = runProcess, signal } = {}) {
  const add = await runner({
    command: 'git',
    args: ['add', '-A'],
    cwd: workspaceDir,
    timeoutMs: 10000,
    signal,
  });
  if (add.cancelled) throw new Error('Cancelado');
  if (add.code !== 0 || add.error) throw new Error(`Error en git add: ${add.error || add.stderr.trim()}`);

  const commit = await runner({
    command: 'git',
    args: [
      '-c', 'user.name=OmniPilot Local',
      '-c', 'user.email=omnipilot@local.invalid',
      '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '-m', 'Baseline workspace', '--quiet',
    ],
    cwd: workspaceDir,
    timeoutMs: 10000,
    signal,
  });
  if (commit.cancelled) throw new Error('Cancelado');
  if (commit.code !== 0 || commit.error) throw new Error(`Error en commit base: ${commit.error || commit.stderr.trim()}`);
}

export async function captureGitPatch(workspaceDir, { runner = runProcess, signal } = {}) {
  const add = await runner({
    command: 'git',
    args: ['add', '-A'],
    cwd: workspaceDir,
    timeoutMs: 10000,
    signal,
  });
  if (add.cancelled) throw new Error('Cancelado');
  if (add.code !== 0 || add.error) throw new Error(`Error al preparar parche: ${add.error || add.stderr.trim()}`);
  const diff = await runner({
    command: 'git',
    args: [
      'diff', '--cached', '--binary', '--no-ext-diff', 'HEAD', '--',
      '.', ':(exclude)node_modules', ':(exclude)**/node_modules', ':(exclude).env', ':(exclude).env.*',
    ],
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
  const files = lines
    .map(line => line.slice(3).trim())
    .filter(f => Boolean(f) && !IGNORED_STATUS_RE.test(f));
  return { raw: lines.join('\n'), files };
}
