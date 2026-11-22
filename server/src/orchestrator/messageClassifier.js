const GREETING_RE = /^(hola|buenas(\s+(tardes|noches|d[ií]as))?|buenos\s+d[ií]as|hey|hi|hello|qu[eé]\s+tal|gracias|muchas\s+gracias|ok|listo|perfecto)[!.,?\s]*$/i;
const AGENTS_RE = /(qu[eé]\s+agentes|agentes\s+activos|proveedores|qu[eé]\s+conectores|codex\s+y\s+antigravity)/i;
const STATUS_RE = /(en\s+qu[eé]\s+estado|c[oó]mo\s+va|estado\s+actual|progreso|ya\s+termin[oó])/i;
const TASK_VERBS_RE = /(implementa|crea|agrega|a[nñ]ade|corrige|arregla|modifica|actualiza|refactor|construye|haz|genera|escribe|elimina|quita|valida|prueba|fix|build|add|create|implement|update)/i;

export function classifyMessage(text) {
  const clean = String(text ?? '').trim();
  if (GREETING_RE.test(clean)) return 'greeting';
  if (AGENTS_RE.test(clean)) return 'agents';
  if (STATUS_RE.test(clean)) return 'status';
  if (clean.endsWith('?') && !TASK_VERBS_RE.test(clean)) return 'question';
  return 'task';
}
