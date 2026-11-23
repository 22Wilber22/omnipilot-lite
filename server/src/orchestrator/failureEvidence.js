const MAX_STDERR_LENGTH = 2000;

export function sanitizeStderr(value) {
  return String(value ?? '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(token|api[_-]?key|password)\s*[:=]\s*[^\s]+/gi, '$1=[REDACTED]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_STDERR_LENGTH);
}

export function buildAgentFailure(stage, result) {
  const timedOut = Boolean(result?.timedOut);
  const cancelled = Boolean(result?.cancelled);
  const stderr = sanitizeStderr(result?.stderr);
  let message = `${stage} fallida.`;
  if (timedOut) message = `${stage} detenida: límite de 5 minutos alcanzado.`;
  else if (cancelled) message = `${stage} cancelada por el usuario.`;
  else if (result?.signal) message = `${stage} detenida por señal ${result.signal}.`;
  else if (result?.code !== null && result?.code !== undefined) message = `${stage} fallida con código ${result.code}.`;
  else if (result?.error) message = `${stage} fallida: ${String(result.error).slice(0, 300)}`;

  return {
    message,
    evidence: {
      code: result?.code ?? null,
      signal: result?.signal ?? null,
      timedOut,
      cancelled,
      stderr,
      stderrUntrusted: Boolean(stderr),
    },
  };
}
