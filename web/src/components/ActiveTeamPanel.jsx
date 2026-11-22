import { IconCheck, IconCode, IconShield } from './Icons.jsx';
import { StatusBadge } from './UiPrimitives.jsx';

function agentStatus(available, isBusy, checked) {
  if (isBusy) return { label: 'En uso', variant: 'info' };
  if (!checked) return { label: 'Sin conexión', variant: 'wait' };
  return available ? { label: 'Disponible', variant: 'ok' } : { label: 'Sin conexión', variant: 'fail' };
}

export default function ActiveTeamPanel({ diagnostics, usageLevels, activeAgent }) {
  const checked = Boolean(diagnostics);
  const codexSt = agentStatus(Boolean(diagnostics?.codex?.available), String(activeAgent).includes('codex'), checked);
  const agySt = agentStatus(Boolean(diagnostics?.antigravity?.available), String(activeAgent).includes('antigravity'), checked);
  const verifySt = activeAgent === 'local-verifier'
    ? { label: 'En uso', variant: 'info' }
    : { label: 'Disponible', variant: 'ok' };

  return (
    <div className="team-list">
      <article className="team-card">
        <div className="between">
          <strong className="team-name"><IconCode /> Codex</strong>
          <StatusBadge variant={codexSt.variant}>{codexSt.label}</StatusBadge>
        </div>
        <p className="muted">Implementación y corrección</p>
        <div className="team-usage">Uso actual: <strong>{usageLevels.codex}</strong></div>
      </article>

      <article className="team-card">
        <div className="between">
          <strong className="team-name"><IconShield /> Antigravity</strong>
          <StatusBadge variant={agySt.variant}>{agySt.label}</StatusBadge>
        </div>
        <p className="muted">Planificación y revisión</p>
        <div className="team-usage">Uso actual: <strong>{usageLevels.antigravity}</strong></div>
      </article>

      <article className="team-card">
        <div className="between">
          <strong className="team-name"><IconCheck /> Verificador local</strong>
          <StatusBadge variant={verifySt.variant}>{verifySt.label}</StatusBadge>
        </div>
        <p className="muted">Pruebas de aceptación fijas</p>
      </article>

      <p className="muted sidebar-note">El orquestador elige según el rol y disponibilidad.</p>
    </div>
  );
}
