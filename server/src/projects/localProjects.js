import { cp, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, win32 } from 'node:path';

const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.git', '.aws', '.ssh']);
const EXCLUDED_FILES = new Set([
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'secrets.json',
]);
const SECRET_EXTENSIONS = new Set(['.key', '.p12', '.pem', '.pfx']);

function isOutside(root, target) {
  const rel = relative(root, target);
  return !rel || rel.startsWith('..') || isAbsolute(rel);
}

export function isExcludedProjectPath(relativePath) {
  if (!relativePath) return false;
  const parts = relativePath.split(/[\\/]+/);
  const name = parts.at(-1);
  const lowerName = name.toLowerCase();
  return parts.some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()))
    || EXCLUDED_FILES.has(lowerName)
    || lowerName === '.env'
    || lowerName.startsWith('.env.')
    || [...SECRET_EXTENSIONS].some(extension => lowerName.endsWith(extension));
}

export function normalizeProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) throw new Error('projectPath requerido');
  const value = projectPath.trim();
  const parts = value.split(/[\\/]+/);
  if (isAbsolute(value) || win32.isAbsolute(value) || parts.includes('..')) {
    throw new Error('projectPath fuera de PROJECTS_ROOT');
  }
  return value;
}

export async function resolveProjectsRoot(configuredRoot = process.env.PROJECTS_ROOT) {
  const input = configuredRoot?.trim() || join(homedir(), 'OmniPilotProjects');
  const expanded = input === '~' || input.startsWith('~/')
    ? join(homedir(), input.slice(2))
    : input;
  const path = resolve(expanded);
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error('PROJECTS_ROOT no puede ser un symlink');
    if (!stats.isDirectory()) throw new Error('PROJECTS_ROOT debe ser una carpeta');
    return await realpath(path);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`PROJECTS_ROOT no existe: ${path}`);
    throw error;
  }
}

async function rejectIncludedSymlinks(root, current = root) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const rel = relative(root, path);
    if (isExcludedProjectPath(rel)) continue;
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error(`Symlink no permitido en proyecto: ${rel}`);
    if (stats.isDirectory()) await rejectIncludedSymlinks(root, path);
  }
}

async function resolveProject(projectsRoot, projectPath) {
  const root = await resolveProjectsRoot(projectsRoot);
  const normalizedPath = normalizeProjectPath(projectPath);
  const candidate = resolve(root, normalizedPath);
  if (isOutside(root, candidate)) throw new Error('projectPath fuera de PROJECTS_ROOT');
  try {
    let current = root;
    for (const part of normalizedPath.split(/[\\/]+/)) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink no permitido en projectPath');
    }
    const stats = await lstat(candidate);
    if (!stats.isDirectory()) throw new Error('El proyecto debe ser una carpeta');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Proyecto no existe: ${normalizedPath}`);
    throw error;
  }
  const sourceDir = await realpath(candidate);
  if (isOutside(root, sourceDir)) throw new Error('projectPath fuera de PROJECTS_ROOT');
  await rejectIncludedSymlinks(sourceDir);
  return { root, sourceDir, projectPath: relative(root, sourceDir) };
}

async function readPackage(sourceDir) {
  let raw;
  try {
    raw = await readFile(join(sourceDir, 'package.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('El proyecto no contiene package.json');
    throw error;
  }
  let packageJson;
  try {
    packageJson = JSON.parse(raw);
  } catch {
    throw new Error('package.json contiene JSON inválido');
  }
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
    ? Object.fromEntries(Object.entries(packageJson.scripts).filter(([, value]) => typeof value === 'string'))
    : {};
  return {
    name: typeof packageJson?.name === 'string' && packageJson.name.trim()
      ? packageJson.name.trim()
      : basename(sourceDir),
    scripts,
  };
}

async function hasGitMetadata(sourceDir) {
  try {
    const stats = await lstat(join(sourceDir, '.git'));
    if (stats.isSymbolicLink()) throw new Error('Symlink no permitido en .git');
    return stats.isDirectory() || stats.isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function inspectLocalProject({ projectsRoot, projectPath }) {
  const project = await resolveProject(projectsRoot, projectPath);
  const packageInfo = await readPackage(project.sourceDir);
  return {
    name: packageInfo.name,
    projectPath: project.projectPath,
    scripts: Object.keys(packageInfo.scripts).sort(),
    isGitRepository: await hasGitMetadata(project.sourceDir),
  };
}

export async function validateLocalProjectSource({ projectsRoot, projectPath, acceptanceScript }) {
  if (typeof acceptanceScript !== 'string' || !acceptanceScript.trim()) {
    throw new Error('acceptanceScript requerido');
  }
  const project = await resolveProject(projectsRoot, projectPath);
  const packageInfo = await readPackage(project.sourceDir);
  const script = acceptanceScript.trim();
  if (!Object.hasOwn(packageInfo.scripts, script)) {
    throw new Error(`Script de aceptación inexistente: ${script}`);
  }
  return { type: 'local-project', projectPath: project.projectPath, acceptanceScript: script };
}

export async function copyLocalProject({ projectsRoot, projectPath, acceptanceScript, destination }) {
  const source = await validateLocalProjectSource({ projectsRoot, projectPath, acceptanceScript });
  const { sourceDir } = await resolveProject(projectsRoot, source.projectPath);
  await cp(sourceDir, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: path => !isExcludedProjectPath(relative(sourceDir, path)),
  });
  return source;
}
