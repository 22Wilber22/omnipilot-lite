import { useState } from 'react';
import { QUALITY_RULES } from './TaskView.jsx';

const PHASES = [
  { key: 'plan', label: 'Planificar' },
  { key: 'implement', label: 'Implementar' },
  { key: 'review', label: 'Revisar' },
  { key: 'verify', label: 'Verificar' },
];

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return '—';
  const ms = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function getPhaseState(phaseKey, run, events, activeStep) {
  if (phaseKey === 'plan') return 'done';
  const steps = run?.memory?.steps ?? [];
  const hasAgent = (prefix) => steps.some(s => s.agent.includes(prefix));
  if (phaseKey === 'implement') {
    if (hasAgent('implement') || hasAgent('codex-demo')) return 'done';
    if (activeStep === 'implement') return 'active';
  }
  if (phaseKey === 'review') {
    if (hasAgent('review') || hasAgent('gemini-demo')) return 'done';
    if (activeStep === 'review') return 'active';
  }
  if (phaseKey === 'verify') {
    if (hasAgent('verifier')) return run.status === 'completed' ? 'done' : 'fail';
    if (activeStep === 'verify' || activeStep === 'fix') return 'active';
  }
  if (events.some(e => e.type === 'step.started' && e.step === phaseKey)) return 'active';
  return 'pending';
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExecutionView({ run, events, quality, onCancel, onNewTask, busy, error }) {
  const [showChanges, setShowChanges] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState('');

  const isRunning = run.status === 'running';
  const isTerminal = ['completed', 'failed', 'cancelled'].includes(run.status);

  const lastStarted = [...events].reverse().find(e => e.type === 'step.started');
  const activeStep = isRunning ? (lastStarted?.step ?? 'implement') : '';
  const fallbackEvent = events.find(e => e.type === 'log' && e.fallback);

  const modifiedFiles = [...new Set([
    ...events.filter(e => e.type === 'files.changed').flatMap(e => e.files ?? []),
    ...(run.memory?.steps ?? []).flatMap(s => s.files ?? []),
  ])];
  const agentsUsed = [...new Set((run.memory?.steps ?? []).map(s => s.agent))];
  const retries = (run.memory?.steps ?? []).filter(s => s.agent === 'codex-fix').length;
  const activeQuality = QUALITY_RULES.filter(r => quality[r.id]).map(r => r.label);
  const lastVerifier = [...(run.memory?.steps ?? [])].reverse().find(s => s.agent === 'local-verifier');

  const bannerText = run.status === 'completed'
    ? 'Pruebas aprobadas'
    : (run.status === 'cancelled' ? 'Ejecución cancelada' : 'Pruebas fallidas');
  const bannerClass = run.status === 'completed' ? 'banner ok' : (run.status === 'cancelled' ? 'banner wait' : 'banner fail');

  const evidencePayload = {
    objetivo: run.goal,
    modo: run.mode === 'codex' ? 'Ejecución local real' : 'Modo demostración',
    perfilDeCalidad: activeQuality,
    agentesUsados: agentsUsed,
    archivosModificados: modifiedFiles,
    pruebaDeAceptacion: run.memory?.acceptance || 'node --test password.test.js',
    duracion: formatDuration(run.startedAt, run.completedAt),
    reintentos: retries,
    estadoFinal: bannerText,
    verificacion: lastVerifier?.summary ?? null,
  };

  return (
    <section className="card centered">
      <div className="between">
        <div>
          <h2 className="title-lg">{isRunning ? 'Ejecutando tarea' : 'Ejecución y evidencia'}</h2>
          <p className="subtitle">{run.goal}</p>
        </div>
        <span className={run.mode === 'codex' ? 'badge ok' : 'badge wait'}>
          {run.mode === 'codex' ? 'Ejecución local real' : 'Modo demostración'}
        </span>
      </div>

      <ol className="progress-vertical">
        {PHASES.map(p => {
          const st = getPhaseState(p.key, run, events, activeStep);
          return (
            <li key={p.key} className={`phase-row ${st}`}>
              <span className="phase-dot" />
              <div>
                <strong>{p.label}</strong>
                {p.key === 'review' && fallbackEvent && (
                  <small className="muted"> · {fallbackEvent.message}</small>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {isRunning && lastStarted && (
        <p className="muted">Agente activo: <strong>{lastStarted.agent || 'orquestador'}</strong> — {lastStarted.message}</p>
      )}

      {isRunning && (
        <button type="button" className="danger" onClick={onCancel} disabled={busy}>
          Cancelar ejecución
        </button>
      )}

      {isTerminal && (
        <>
          <div className={bannerClass}>{bannerText}</div>

          <div className="evidence-card">
            <h3>Ficha de evidencia</h3>
            <dl className="evidence-list">
              <div><dt>Objetivo</dt><dd>{run.goal}</dd></div>
              <div><dt>Perfil de calidad aplicado</dt><dd>{activeQuality.length ? activeQuality.join(', ') : 'Estándar'}</dd></div>
              <div><dt>Agentes usados</dt><dd>{agentsUsed.length ? agentsUsed.join(', ') : '—'}</dd></div>
              <div><dt>Archivos modificados</dt><dd>{modifiedFiles.length ? modifiedFiles.join(', ') : 'Ninguno'}</dd></div>
              <div><dt>Prueba de aceptación</dt><dd><code>{evidencePayload.pruebaDeAceptacion}</code></dd></div>
              <div><dt>Duración</dt><dd>{evidencePayload.duracion}</dd></div>
              <div><dt>Reintentos</dt><dd>{retries}</dd></div>
              <div><dt>Estado final</dt><dd>{bannerText}</dd></div>
            </dl>
            {run.memory?.problems?.length > 0 && (
              <p className="error">Detalle: {run.memory.problems.join(' | ')}</p>
            )}
          </div>

          <div className="delivery-row">
            <span className="tip-wrap">
              <button type="button" className="secondary" onClick={() => setShowChanges(v => !v)}>Ver cambios</button>
              <span className="tip-box" role="tooltip">Revisa el diff antes de descargar archivos.</span>
            </span>
            <span className="tip-wrap">
              <button
                type="button"
                className="secondary"
                onClick={() => setDeliveryNotice('La descarga de .diff requiere habilitar el endpoint de parche en el servidor.')}
              >
                Descargar parche
              </button>
              <span className="tip-box" role="tooltip">Descarga solo los cambios como archivo .diff.</span>
            </span>
            <span className="tip-wrap">
              <button
                type="button"
                className="secondary"
                onClick={() => downloadJsonFile('ficha-evidencia.json', evidencePayload)}
              >
                Descargar ficha de evidencia
              </button>
              <span className="tip-box" role="tooltip">Descarga el resumen verificable de la ejecución.</span>
            </span>
            <span className="tip-wrap">
              <button
                type="button"
                className="secondary"
                onClick={() => setDeliveryNotice('La descarga del workspace completo se habilitará en una siguiente versión.')}
              >
                Descargar workspace
              </button>
              <span className="tip-box" role="tooltip">Descarga una copia del workspace de esta ejecución.</span>
            </span>
          </div>
          <p className="muted">Los archivos nunca se descargan automáticamente.</p>
          {deliveryNotice && <p className="muted">{deliveryNotice}</p>}
          {showChanges && (
            <div className="changes-box">
              <strong>Archivos modificados:</strong>{' '}
              {modifiedFiles.length ? modifiedFiles.join(', ') : 'Sin archivos modificados'}
            </div>
          )}

          <button type="button" className="primary full" onClick={onNewTask}>
            Nueva tarea
          </button>
        </>
      )}

      <details className="logs-details">
        <summary className="muted">Logs técnicos ({events.length} eventos)</summary>
        <div className="logs">
          {events.length
            ? events.map(e => (
              <div key={e.seq}>
                <time>{e.at.slice(11, 19)}</time> <b>[{e.type}]</b> {e.message}
              </div>
            ))
            : <span>Sin eventos todavía.</span>}
        </div>
      </details>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
