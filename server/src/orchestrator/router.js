import { isBudgetExceeded } from '../metrics/usageTracker.js';

export const AGENT_REGISTRY = Object.freeze({
  codex: Object.freeze({
    id: 'codex',
    provider: 'Codex',
    capabilities: Object.freeze(['code-write', 'code-read', 'fix']),
    allowedPermissions: Object.freeze(['workspace-write', 'read-only']),
  }),
  antigravity: Object.freeze({
    id: 'antigravity',
    provider: 'Antigravity',
    capabilities: Object.freeze(['plan', 'review', 'chat', 'code-write', 'fix']),
    allowedPermissions: Object.freeze(['read-only', 'accept-edits']),
  }),
  'local-verifier': Object.freeze({
    id: 'local-verifier',
    provider: 'Node local',
    capabilities: Object.freeze(['verify']),
    allowedPermissions: Object.freeze(['local-fixed-command']),
  }),
});

export function canAgentRun(agentId, requiredCapability, permission, registry = AGENT_REGISTRY) {
  const entry = registry?.[agentId];
  if (!entry) return false;
  if (!entry.capabilities.includes(requiredCapability)) return false;
  if (!entry.allowedPermissions.includes(permission)) return false;
  const isWritePermission = permission === 'workspace-write' || permission === 'accept-edits';
  if (isWritePermission && !entry.capabilities.includes('code-write')) return false;
  return true;
}

function isProviderUsable(agentId, availability, usage) {
  if (agentId === 'local-verifier') return true;
  if (availability[agentId] === false) return false;
  if (usage && isBudgetExceeded(usage, agentId)) return false;
  return true;
}

export function routePhase({
  phase,
  availability = { codex: true, antigravity: false },
  usage = null,
  recommendation = null,
  acceptanceLabel = 'node --test password.test.js',
} = {}) {
  if (phase === 'verify') {
    return {
      agent: 'local-verifier',
      provider: AGENT_REGISTRY['local-verifier'].provider,
      permission: 'local-fixed-command',
      reason: `Evidencia final fija (${acceptanceLabel}).`,
      fallbackReason: null,
    };
  }

  if (phase === 'plan') {
    return {
      agent: 'local-orchestrator',
      provider: 'OmniPilot',
      permission: 'plan determinista local',
      reason: 'Analiza alcance sin modificar archivos.',
      fallbackReason: null,
    };
  }

  if (phase === 'implement' || phase === 'fix') {
    const reqCap = phase === 'fix' ? 'fix' : 'code-write';
    if (recommendation?.agent && canAgentRun(recommendation.agent, reqCap, 'workspace-write') && isProviderUsable(recommendation.agent, availability, usage)) {
      const entry = AGENT_REGISTRY[recommendation.agent];
      return {
        agent: `${entry.id}-${phase}`,
        provider: entry.provider,
        permission: 'workspace-write',
        reason: `${entry.provider} fue elegido por recomendación validada con capacidad ${reqCap}.`,
        fallbackReason: null,
      };
    }
    if (canAgentRun('codex', reqCap, 'workspace-write') && isProviderUsable('codex', availability, usage)) {
      return {
        agent: `codex-${phase}`,
        provider: AGENT_REGISTRY.codex.provider,
        permission: 'workspace-write',
        reason: 'Codex fue elegido porque es el único agente validado para escritura.',
        fallbackReason: null,
      };
    }
    return null;
  }

  if (phase === 'review') {
    if (recommendation?.agent && canAgentRun(recommendation.agent, 'review', 'read-only') && isProviderUsable(recommendation.agent, availability, usage)) {
      const entry = AGENT_REGISTRY[recommendation.agent];
      return {
        agent: `${entry.id}-review`,
        provider: entry.provider,
        permission: 'read-only',
        reason: 'Revisión independiente de cambios.',
        fallbackReason: null,
      };
    }
    if (canAgentRun('antigravity', 'review', 'read-only') && isProviderUsable('antigravity', availability, usage)) {
      return {
        agent: 'antigravity-review',
        provider: AGENT_REGISTRY.antigravity.provider,
        permission: 'read-only',
        reason: 'Revisión independiente de cambios.',
        fallbackReason: null,
      };
    }
    if (canAgentRun('codex', 'code-read', 'read-only') && isProviderUsable('codex', availability, usage)) {
      return {
        agent: 'codex-review',
        provider: 'Codex',
        permission: 'read-only',
        reason: 'Revisión en modo solo lectura.',
        fallbackReason: 'Antigravity no disponible; fallback a Codex en solo lectura.',
      };
    }
    return null;
  }

  return null;
}

export function route(role, available = { codex: true, gemini: true }) {
  const preferred = role === 'review' ? 'gemini' : 'codex';
  if (available[preferred]) return { agent: preferred, reason: `Regla ${role} → ${preferred}` };
  const fallback = preferred === 'codex' ? 'gemini' : 'codex';
  return available[fallback] ? { agent: fallback, reason: `Respaldo: ${preferred} no disponible` } : null;
}
