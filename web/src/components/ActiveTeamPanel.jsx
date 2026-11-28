import { IconCheck, IconCode, IconFile, IconShield } from './Icons.jsx';
import { StatusBadge } from './UiPrimitives.jsx';
import UsageBar from './UsageBar.jsx';

function agentStatus(available, isBusy, checked) {
  if (isBusy) return { label: 'En uso', variant: 'info' };
  if (!checked) return { label: 'Sin conexión', variant: 'wait' };
  return available ? { label: 'Disponible', variant: 'ok' } : { label: 'Sin conexión', variant: 'fail' };
}

export default function ActiveTeamPanel({
  diagnostics,
  runUsage,
  activeAgent,
  chatSettings,
  savedProjectConfig,
  isRunning,
  onOpenProjectPicker,
}) {
  const checked = Boolean(diagnostics);
  const codexSt = agentStatus(Boolean(diagnostics?.codex?.available), String(activeAgent).includes('codex'), checked);
  const agySt = agentStatus(Boolean(diagnostics?.antigravity?.available), String(activeAgent).includes('antigravity'), checked);
  const verifySt = activeAgent === 'local-verifier'
    ? { label: 'En uso', variant: 'info' }
    : { label: 'Disponible', variant: 'ok' };

  const chatProviderLabel = chatSettings?.chatProvider === 'codex'
    ? 'Codex'
    : (chatSettings?.chatProvider === 'antigravity' ? 'Antigravity' : 'Automático');
  const chatStyleLabel = chatSettings?.chatStyle === 'detailed' ? 'Detallado' : 'Rápido';

  return (
    <div className="team-list">
      <div className="conv-chip">
        Conversación: <strong>{chatProviderLabel}</strong> · {chatStyleLabel}
      </div>

      {savedProjectConfig && (
        <button
          type="button"
          className="project-chip-btn full"
          onClick={onOpenProjectPicker}
          disabled={isRunning}
          title={isRunning ? 'Bloqueado durante ejecución activa' : 'Cambiar proyecto'}
        >
          <IconFile /> Proyecto: {savedProjectConfig.projectName} · {savedProjectConfig.acceptanceScript}
        </button>
      )}

      <article className="team-card">
        <div className="between">
          <strong className="team-name"><IconCode /> Codex</strong>
          <StatusBadge variant={codexSt.variant}>{codexSt.label}</StatusBadge>
        </div>
        <p className="muted">Implementación y corrección</p>
        <UsageBar usage={runUsage?.codex} label="Presupuesto local Codex" />
        <p className="muted mono-inline">Costo estimado: ${(runUsage?.codex?.costUsd ?? 0).toFixed(4)} USD</p>
      </article>

      <article className="team-card">
        <div className="between">
          <strong className="team-name"><IconShield /> Antigravity</strong>
          <StatusBadge variant={agySt.variant}>{agySt.label}</StatusBadge>
        </div>
        <p className="muted">Planificación y revisión</p>
        <UsageBar usage={runUsage?.antigravity} label="Presupuesto local Antigravity" />
        <p className="muted mono-inline">Costo estimado: ${(runUsage?.antigravity?.costUsd ?? 0).toFixed(4)} USD</p>
      </article>

      <article className="team-card">
        <div className="between">
          <strong className="team-name"><IconCheck /> Verificador local</strong>
          <StatusBadge variant={verifySt.variant}>{verifySt.label}</StatusBadge>
        </div>
        <p className="muted">Pruebas de aceptación fijas · 0 tokens</p>
      </article>

      <div className="conv-chip mono-inline">
        Total estimado: <strong>${(runUsage?.costUsd ?? 0).toFixed(4)} USD</strong>
        {runUsage?.costUsdPartial ? ' (parcial)' : ''}
        {runUsage?.budgetUsd ? <> / ${Number(runUsage.budgetUsd).toFixed(2)} tope</> : null}
      </div>

      <p className="muted sidebar-note">El orquestador elige según el rol y disponibilidad.</p>
    </div>
  );
}
