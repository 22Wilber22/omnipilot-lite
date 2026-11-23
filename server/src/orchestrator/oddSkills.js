import { routePhase } from './router.js';

export const ODD_SKILL_ID = 'orchestrator-driven-development';

export const SKILL_CATALOG = Object.freeze({
  [ODD_SKILL_ID]: {
    id: ODD_SKILL_ID,
    name: 'ODD · Orchestrator-Driven Development',
    description: 'Planifica, delega, supervisa, verifica y deja evidencia.',
    roles: ['plan', 'implement', 'review', 'fix', 'verify'],
    lockedOn: true,
    rule: 'ODD: un solo agente modificador a la vez, contexto mínimo delimitado, revisor en solo lectura y éxito definido únicamente por pruebas locales.',
  },
  'clean-code': {
    id: 'clean-code',
    name: 'Código limpio',
    description: 'Cambios pequeños, nombres claros y sin complejidad extra.',
    roles: ['implement', 'fix'],
    lockedOn: false,
    rule: 'Código limpio: usa nombres descriptivos, funciones pequeñas, retornos tempranos y manejo explícito de errores sin abstracciones especulativas.',
  },
  'focused-changes': {
    id: 'focused-changes',
    name: 'Cambios enfocados',
    description: 'Limita las ediciones a los archivos necesarios de la tarea.',
    roles: ['implement', 'fix'],
    lockedOn: false,
    rule: 'Cambios enfocados: toca únicamente los archivos necesarios para resolver la tarea sin refactorizar código ajeno.',
  },
  'controlled-fix': {
    id: 'controlled-fix',
    name: 'Corrección controlada',
    description: 'Un único intento de corrección guiado por el error real.',
    roles: ['fix'],
    lockedOn: false,
    rule: 'Corrección controlada: corrige la causa raíz reportada por la prueba fallida en un único cambio mínimo.',
  },
  'security-review': {
    id: 'security-review',
    name: 'Revisión de seguridad',
    description: 'Verifica rutas, entradas y ausencia de comandos inseguros.',
    roles: ['review'],
    lockedOn: false,
    rule: 'Revisión de seguridad: verifica validación de entradas, rutas seguras, ausencia de shell:true y no exposición de secretos.',
  },
  'reusable-components': {
    id: 'reusable-components',
    name: 'Componentes reutilizables',
    description: 'Favorece piezas pequeñas con una sola responsabilidad.',
    roles: ['implement', 'fix'],
    frontendOnly: true,
    lockedOn: false,
    rule: 'Componentes reutilizables: separa responsabilidades en componentes UI pequeños y reutiliza primitivas existentes.',
  },
});

const FRONTEND_RE = /(web\/|\.jsx|\.tsx|\.css|interfaz|frontend|componente|bot[oó]n|pantalla|modal|drawer)/i;

export function normalizeActiveSkillIds(requestedIds = []) {
  const valid = new Set([ODD_SKILL_ID]);
  if (Array.isArray(requestedIds)) {
    for (const id of requestedIds) {
      if (typeof id === 'string' && Object.hasOwn(SKILL_CATALOG, id)) {
        valid.add(id);
      }
    }
  }
  return [...valid];
}

export function buildSkillRulesForRole(activeSkillIds, role, { goal = '' } = {}) {
  const normalized = normalizeActiveSkillIds(activeSkillIds);
  const touchesFrontend = FRONTEND_RE.test(String(goal));
  const rules = [];
  for (const id of normalized) {
    const skill = SKILL_CATALOG[id];
    if (!skill || !skill.roles.includes(role)) continue;
    if (skill.frontendOnly && !touchesFrontend) continue;
    rules.push(skill.rule);
  }
  return rules;
}

export function buildOddDelegation({ antigravityAvailable = false, acceptanceLabel = 'node --test password.test.js' } = {}) {
  const availability = { codex: true, antigravity: antigravityAvailable };
  const plan = routePhase({ phase: 'plan', availability, acceptanceLabel });
  const impl = routePhase({ phase: 'implement', availability, acceptanceLabel });
  const review = routePhase({ phase: 'review', availability, acceptanceLabel });
  const verify = routePhase({ phase: 'verify', availability, acceptanceLabel });
  const fix = routePhase({ phase: 'fix', availability, acceptanceLabel });

  return [
    { phase: 'plan', role: 'Planificación', ...plan, status: 'completado', ms: 0, result: 'Plan determinista creado' },
    { phase: 'implement', role: 'Implementación', ...impl, status: 'pendiente', ms: 0, result: null },
    { phase: 'review', role: 'Revisión', ...review, status: 'pendiente', ms: 0, result: null },
    { phase: 'verify', role: 'Verificación', ...verify, status: 'pendiente', ms: 0, result: null },
    { phase: 'fix', role: 'Corrección', ...fix, status: 'pendiente', ms: 0, result: null },
  ];
}
