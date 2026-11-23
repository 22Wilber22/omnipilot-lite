const GREETING_RE = /^(hola|buenas(\s+(tardes|noches|d[ií]as))?|buenos\s+d[ií]as|hey|hi|hello|qu[eé]\s+tal)[!.,?\s]*$/i;
const CONVERSATION_RE = /^(dale|ok|okay|s[ií]|claro|vale|va|contin[uú]a|continuar|sigue|adelante|entendido|genial|bien|excelente|perfecto|listo|gracias|muchas\s+gracias|de\s+acuerdo)[!.,?\s]*$/i;
const AGENTS_RE = /(qu[eé]\s+agentes|agentes\s+activos|proveedores|qu[eé]\s+conectores|codex\s+y\s+antigravity)/i;
const STATUS_RE = /(en\s+qu[eé]\s+estado|c[oó]mo\s+va|estado\s+actual|progreso|ya\s+termin[oó])/i;
const TASK_VERBS_RE = /(implementa|crea|agrega|a[nñ]ade|corrige|arregla|modifica|actualiza|refactor|construye|haz|genera|escribe|elimina|quita|valida|prueba|fix|build|add|create|implement|update)/i;

export function classifyMessage(text) {
  const clean = String(text ?? '').trim();
  if (GREETING_RE.test(clean)) return 'greeting';
  if (CONVERSATION_RE.test(clean)) return 'conversation';
  if (AGENTS_RE.test(clean)) return 'agents';
  if (STATUS_RE.test(clean)) return 'status';
  if (clean.endsWith('?') && !TASK_VERBS_RE.test(clean)) return 'question';
  return 'task';
}
