export function route(role, available = { codex: true, gemini: true }) {
  const preferred = role === 'review' ? 'gemini' : 'codex';
  if (available[preferred]) return { agent: preferred, reason: `Regla ${role} → ${preferred}` };
  const fallback = preferred === 'codex' ? 'gemini' : 'codex';
  return available[fallback] ? { agent: fallback, reason: `Respaldo: ${preferred} no disponible` } : null;
}
