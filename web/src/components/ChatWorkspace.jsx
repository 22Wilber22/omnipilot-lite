import {
  IconCheck, IconDownload, IconFile, IconPlay, IconStop,
} from './Icons.jsx';
import { ChatMessage, StatusBadge } from './UiPrimitives.jsx';
import TooltipInfo from './TooltipInfo.jsx';
import ChatComposer from './ChatComposer.jsx';

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return '—';
  const ms = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildActivityMessages(events) {
  const list = [];
  for (const ev of events) {
    if (ev.type === 'step.started' || ev.type === 'step.completed') {
      const isAgy = String(ev.agent || '').includes('antigravity');
      const isCodex = String(ev.agent || '').includes('codex');
      const actor = isAgy ? 'Antigravity' : (isCodex ? 'Codex' : 'Verificador local');
      list.push({ id: ev.seq, actor, kind: isAgy ? 'agy' : (isCodex ? 'codex' : 'verify'), text: ev.message, time: ev.at.slice(11, 19) });
    } else if (ev.type === 'log' && ev.fallback) {
      list.push({ id: ev.seq, actor: 'OmniPilot', kind: 'warn', text: ev.message, time: ev.at.slice(11, 19) });
    } else if (ev.type === 'files.changed') {
      list.push({ id: ev.seq, actor: 'Codex', kind: 'codex', text: `Archivos actualizados: ${(ev.files ?? []).join(', ')}`, time: ev.at.slice(11, 19) });
    } else if (ev.type === 'verification.completed') {
      list.push({ id: ev.seq, actor: 'Verificador local', kind: ev.passed ? 'ok' : 'fail', text: ev.message, time: ev.at.slice(11, 19) });
    }
  }
  return list;
}

export default function ChatWorkspace({
  connected, diagnostics, mode, goal, setGoal, acceptance, setAcceptance,
  run, events, skills,
  onCreatePlan, onApprove, onCancel, onNewTask, onOpenSettings,
  busy, error,
}) {
  const agyAvailable = Boolean(diagnostics?.antigravity?.available);
  const isPending = run?.status === 'pending';
  const isRunning = run?.status === 'running';
  const isTerminal = run && ['completed', 'failed', 'cancelled'].includes(run.status);

  const activity = buildActivityMessages(events);
  const modifiedFiles = [...new Set([
    ...events.filter(e => e.type === 'files.changed').flatMap(e => e.files ?? []),
    ...(run?.memory?.steps ?? []).flatMap(s => s.files ?? []),
  ])];
  const agentsUsed = [...new Set((run?.memory?.steps ?? []).map(s => s.agent))];
  const retries = (run?.memory?.steps ?? []).filter(s => s.agent === 'codex-fix').length;
  const activeSkills = skills.filter(s => s.status === 'active').map(s => s.name);

  const resultLabel = run?.status === 'completed'
    ? 'Pruebas aprobadas'
    : (run?.status === 'cancelled' ? 'Ejecución cancelada' : 'Pruebas fallidas');

  const evidencePayload = run ? {
    objetivo: run.goal,
    modo: run.mode === 'codex' ? 'Ejecución local real' : 'Modo demostración',
    skillsActivas: activeSkills,
    agentesUsados: agentsUsed,
    archivosModificados: modifiedFiles,
    pruebaDeAceptacion: run.memory?.acceptance || acceptance,
    duracion: formatDuration(run.startedAt, run.completedAt),
    reintentos: retries,
    estadoFinal: resultLabel,
  } : null;

  return (
    <section className="chat-main" aria-label="Chat de trabajo">
      {!connected && (
        <div className="connect-banner">
          <span>Conecta el token local del servidor en Ajustes para crear y aprobar tareas.</span>
          <button type="button" className="primary sm" onClick={onOpenSettings}>Abrir Ajustes</button>
        </div>
      )}

      <div className="thread">
        {!run && (
          <ChatMessage
            role="assistant"
            author="OmniPilot"
            meta={(
              <span className={mode === 'codex' ? 'mode-pill real' : 'mode-pill demo'}>
                {mode === 'codex' ? 'Ejecución local real' : 'Modo demostración'}
              </span>
            )}
          >
            <p>Escribe qué quieres construir. Crearé un plan corto, te mostraré los agentes elegidos y esperaré tu aprobación antes de ejecutar.</p>
          </ChatMessage>
        )}

        {run && (
          <>
            <ChatMessage role="user" author="Tú" meta={<span className="mono-tag">{run.memory?.acceptance || acceptance}</span>}>
              <p>{run.goal}</p>
            </ChatMessage>

            <ChatMessage
              role="assistant"
              author="OmniPilot"
              meta={(
                <span className="row-inline">
                  <StatusBadge variant={run.mode === 'codex' ? 'ok' : 'wait'}>
                    {run.mode === 'codex' ? 'Ejecución local real' : 'Modo demostración'}
                  </StatusBadge>
                  <TooltipInfo text="El plan es determinista y requiere tu aprobación antes de ejecutar agentes." label="Sobre el plan" />
                </span>
              )}
            >
              <p className="muted-p">
                Plan propuesto: <strong>Codex</strong> implementa,{' '}
                <strong>{agyAvailable && run.mode === 'codex' ? 'Antigravity' : 'Codex (lectura)'}</strong> revisa y{' '}
                <strong>pruebas locales</strong> verifican.
              </p>

              <ol className="plan-compact">
                {run.plan.map((s, i) => (
                  <li key={s.id}>
                    <span className="mono-step">{i + 1}</span>
                    <span>{s.title}</span>
                  </li>
                ))}
              </ol>

              <div className="inline-actions">
                {isPending && (
                  <>
                    <button type="button" className="primary" onClick={onApprove} disabled={busy}>
                      <IconPlay /> {busy ? 'Iniciando...' : 'Aprobar y ejecutar'}
                    </button>
                    <button type="button" className="secondary" onClick={onNewTask} disabled={busy}>
                      Editar tarea
                    </button>
                  </>
                )}
                {isRunning && (
                  <button type="button" className="danger" onClick={onCancel} disabled={busy}>
                    <IconStop /> Cancelar ejecución
                  </button>
                )}
                {isTerminal && (
                  <button type="button" className="secondary" onClick={onNewTask}>
                    Nueva tarea
                  </button>
                )}
              </div>
            </ChatMessage>

            {activity.map(item => (
              <div key={item.id} className={`activity-row ${item.kind}`}>
                <span className="activity-actor">{item.actor}</span>
                <span className="activity-text">{item.text}</span>
                <time className="mono-time">{item.time}</time>
              </div>
            ))}

            {isTerminal && (
              <div className={`result-card ${run.status}`}>
                <div className="between">
                  <strong className="result-title"><IconCheck /> {resultLabel}</strong>
                  <span className="mono-tag">{formatDuration(run.startedAt, run.completedAt)} · {retries} reintentos</span>
                </div>

                {modifiedFiles.length > 0 && (
                  <div className="files-row">
                    {modifiedFiles.map(f => (
                      <span key={f} className="file-chip"><IconFile /> {f}</span>
                    ))}
                  </div>
                )}

                <details className="fold-block">
                  <summary>Ficha de evidencia</summary>
                  <dl className="evidence-dl">
                    <div><dt>Objetivo</dt><dd>{evidencePayload.objetivo}</dd></div>
                    <div><dt>Skills activas</dt><dd>{activeSkills.join(', ') || 'Ninguna'}</dd></div>
                    <div><dt>Agentes usados</dt><dd>{agentsUsed.join(', ') || '—'}</dd></div>
                    <div><dt>Archivos modificados</dt><dd className="mono-inline">{modifiedFiles.join(', ') || 'Ninguno'}</dd></div>
                    <div><dt>Prueba de aceptación</dt><dd className="mono-inline">{evidencePayload.pruebaDeAceptacion}</dd></div>
                    <div><dt>Duración</dt><dd className="mono-inline">{evidencePayload.duracion}</dd></div>
                    <div><dt>Estado final</dt><dd>{resultLabel}</dd></div>
                  </dl>
                  <div className="delivery-actions">
                    <button type="button" className="secondary sm" onClick={() => downloadJson('ficha-evidencia.json', evidencePayload)}>
                      <IconDownload /> Ficha de evidencia
                    </button>
                    <button type="button" className="secondary sm" disabled title="Endpoint de parche (.diff) pendiente en servidor">
                      <IconDownload /> Parche (.diff)
                    </button>
                    <button type="button" className="secondary sm" disabled title="Endpoint de descarga de workspace pendiente en servidor">
                      <IconDownload /> Workspace
                    </button>
                  </div>
                  <p className="muted">Los archivos nunca se descargan automáticamente.</p>
                </details>
              </div>
            )}

            <details className="fold-block">
              <summary>Logs técnicos ({events.length} eventos SSE)</summary>
              <div className="logs">
                {events.map(e => (
                  <div key={e.seq}>
                    <time>{e.at.slice(11, 19)}</time> <b>[{e.type}]</b> {e.message}
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <ChatComposer
        goal={goal}
        setGoal={setGoal}
        acceptance={acceptance}
        setAcceptance={setAcceptance}
        onSubmit={onCreatePlan}
        disabled={!connected || isRunning}
        busy={busy}
      />
    </section>
  );
}
