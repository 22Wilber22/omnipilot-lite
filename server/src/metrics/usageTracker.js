// TODO: Un presupuesto mostrado mayor al límite no debe presentarse como límite aplicado hasta validar con prueba dedicada.
export const DEFAULT_BUDGETS = Object.freeze({
  codex: 40000,
  antigravity: 20000,
});

function sanitizeBudget(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 1_000_000);
}

export function extractUsageFromEvents(events = []) {
  let total = 0;
  let found = false;
  for (const ev of events) {
    const u = ev?.usage;
    if (!u || typeof u !== 'object') continue;
    if (typeof u.total_tokens === 'number' && u.total_tokens >= 0) {
      total += u.total_tokens;
      found = true;
    } else if (typeof u.input_tokens === 'number' || typeof u.output_tokens === 'number') {
      total += (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
      found = true;
    }
  }
  return found ? { totalTokens: total } : null;
}

export function extractUsageFromObject(obj) {
  const u = obj?.usage;
  if (!u || typeof u !== 'object') return null;
  if (typeof u.total_tokens === 'number' && u.total_tokens >= 0) return { totalTokens: u.total_tokens };
  if (typeof u.input_tokens === 'number' || typeof u.output_tokens === 'number') {
    return { totalTokens: (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0) };
  }
  return null;
}

export function classifyUsageLevel(tokens, budget) {
  if (tokens === null || tokens === undefined) return { pct: 0, level: 'unavailable', limitReached: false };
  if (tokens <= 0) return { pct: 0, level: 'idle', limitReached: false };
  const pct = budget > 0 ? Math.min(100, Math.round((tokens / budget) * 100)) : 0;
  if (pct >= 100) return { pct: 100, level: 'limit', limitReached: true };
  if (pct >= 85) return { pct, level: 'high', limitReached: false };
  if (pct >= 65) return { pct, level: 'medium', limitReached: false };
  return { pct, level: 'low', limitReached: false };
}

export function createUsageState(budgets = {}) {
  return {
    codex: {
      tokens: 0,
      budget: sanitizeBudget(budgets?.codex, DEFAULT_BUDGETS.codex),
      pct: 0,
      level: 'idle',
      limitReached: false,
      reported: false,
    },
    antigravity: {
      tokens: 0,
      budget: sanitizeBudget(budgets?.antigravity, DEFAULT_BUDGETS.antigravity),
      pct: 0,
      level: 'idle',
      limitReached: false,
      reported: false,
    },
    verifier: {
      tokens: 0,
      budget: 0,
      pct: 0,
      level: 'idle',
      limitReached: false,
      reported: true,
    },
  };
}

export function recordProviderUsage(usageState, provider, totalTokens) {
  const entry = usageState?.[provider];
  if (!entry) return;
  if (totalTokens === null || totalTokens === undefined) {
    if (!entry.reported) {
      entry.tokens = null;
      entry.pct = 0;
      entry.level = 'unavailable';
      entry.limitReached = false;
    }
    return;
  }
  const prev = typeof entry.tokens === 'number' ? entry.tokens : 0;
  entry.tokens = prev + Math.max(0, Math.floor(totalTokens));
  entry.reported = true;
  const classified = classifyUsageLevel(entry.tokens, entry.budget);
  entry.pct = classified.pct;
  entry.level = classified.level;
  entry.limitReached = classified.limitReached;
}

export function isBudgetExceeded(usageState, provider) {
  return Boolean(usageState?.[provider]?.limitReached);
}
