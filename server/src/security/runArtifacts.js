import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { readMemory } from '../memory/store.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_PATTERNS = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/X-Omni-Token\s*[:=]\s*[^\s"',;]+/gi, 'X-Omni-Token: [REDACTED]'],
  [/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]'],
  [/(\b(?:api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*["']?)([^\s"',;]{6,})(["']?)/gi, '$1[REDACTED]$3'],
];

const EXCLUDED_DIFF_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const SENSITIVE_PATH_RE = /(?:^|\/)(?:node_modules|\.git|\.env(?:\.[^/]+)?|id_rsa|id_ed25519)(?:\/|$)/i;

export function assertValidRunId(runId) {
  if (typeof runId !== 'string' || !UUID_RE.test(runId)) {
    const err = new Error('ID de ejecución inválido');
    err.statusCode = 400;
    throw err;
  }
  return runId;
}

export function resolveRunDir(workspacesDir, runId) {
  assertValidRunId(runId);
  const root = resolve(workspacesDir);
  const dir = resolve(root, runId);
  if (dir === root || !dir.startsWith(root + sep)) {
    const err = new Error('Ruta de ejecución fuera del workspace permitido');
    err.statusCode = 400;
    throw err;
  }
  return dir;
}

export function redact(value) {
  if (typeof value === 'string') {
    let out = value;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

export async function buildEvidenceDocument({ runId, workspacesDir, run = null }) {
  const dir = resolveRunDir(workspacesDir, runId);
  let memory = null;
  try {
    memory = await readMemory(dir);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (run?.memory) memory = run.memory;
  }
  if (!memory) {
    const err = new Error('Evidencia no encontrada para esta ejecución');
    err.statusCode = 404;
    throw err;
  }

  const steps = Array.isArray(memory.steps) ? memory.steps : [];
  const agents = [...new Set(steps.map(s => s.agent).filter(Boolean))];
  const modifiedFiles = [...new Set(steps.flatMap(s => s.files || []).filter(Boolean))];
  const retries = steps.filter(s => s.agent === 'codex-fix').length;
  const durationMs = run?.startedAt && run?.completedAt
    ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
    : steps.reduce((acc, s) => acc + (Number(s.ms) || 0), 0);

  const evidence = {
    runId,
    objetivo: memory.goal || run?.goal || '',
    fuente: memory.source || run?.source || { type: 'template' },
    prueba: memory.acceptance || '',
    skills: memory.skills || run?.activeSkills || [],
    delegacionODD: memory.delegation || [],
    agentes: agents,
    archivosModificados: modifiedFiles,
    duracionMs: durationMs,
    reintentos: retries,
    estado: run?.status || 'completed',
    resultados: {
      pasos: steps.map(s => ({
        id: s.id,
        agent: s.agent,
        status: s.status,
        summary: s.summary,
        ms: s.ms,
        files: s.files || [],
      })),
      problemas: memory.problems || [],
    },
    updatedAt: memory.updatedAt,
  };

  return redact(evidence);
}

function filterPatchSections(rawPatch) {
  const lines = String(rawPatch || '').split('\n');
  const kept = [];
  let skipping = false;

  for (const line of lines) {
    const match = line.match(EXCLUDED_DIFF_HEADER_RE);
    if (match) {
      const [, aPath, bPath] = match;
      const unsafe = aPath.includes('..') || bPath.includes('..')
        || aPath.startsWith('/') || bPath.startsWith('/')
        || SENSITIVE_PATH_RE.test(aPath) || SENSITIVE_PATH_RE.test(bPath);
      skipping = unsafe;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').trim();
}

export async function readSafePatch({ runId, workspacesDir }) {
  const dir = resolveRunDir(workspacesDir, runId);
  let raw = '';
  try {
    raw = await readFile(join(dir, 'changes.patch'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      const err = new Error('No hay parche disponible para esta ejecución');
      err.statusCode = 404;
      throw err;
    }
    throw e;
  }

  const filtered = filterPatchSections(raw);
  if (!filtered) {
    const err = new Error('No hay cambios registrados para exportar en esta ejecución');
    err.statusCode = 404;
    throw err;
  }
  return `${redact(filtered)}\n`;
}
