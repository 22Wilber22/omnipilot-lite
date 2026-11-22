const API = 'http://127.0.0.1:4317';

export async function apiRequest(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'X-Omni-Token': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    throw new Error(data?.error || text || `Error HTTP ${res.status}`);
  }
  return data;
}

export async function streamRunEvents(token, runId, { onEvent, onError, signal }) {
  const res = await fetch(`${API}/api/runs/${runId}/events`, {
    method: 'GET',
    headers: { 'X-Omni-Token': token },
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `No se pudo abrir SSE (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            onEvent(JSON.parse(raw));
          } catch {
            // Ignore malformed SSE chunk
          }
        }
      }
    }
  } catch (err) {
    if (err?.name !== 'AbortError' && onError) onError(err);
  }
}
