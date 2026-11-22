import { useEffect, useRef } from 'react';
import {
  IconCheck, IconDownload, IconFile, IconPlay, IconStop,
} from './Icons.jsx';
import { ChatMessage, StatusBadge } from './UiPrimitives.jsx';
import TooltipInfo from './TooltipInfo.jsx';
import ChatComposer from './ChatComposer.jsx';
import ProjectSelector from './ProjectSelector.jsx';

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
    } else if (ev.type === 'plan' && ev.source) {
      const source = ev.source === 'local-project' ? ev.projectPath : 'Plantilla de demostración';
      const script = ev.acceptanceScript ? ` · npm run ${ev.acceptanceScript}` : '';
      list.push({ id: ev.seq, actor: 'OmniPilot', kind: 'verify', text: `Fuente: ${source}${script}`, time: ev.at.slice(11, 19) });
    }
  }
  return list;
}

export default function ChatWorkspace({
  connected, diagnostics, mode,
  composerText, setComposerText,
  messages, run, events, skills,
  onSendMessage, onApprove, onCancel, onNewTask, onOpenSettings,
  projectConfig,
  sending, busy, error,
}) {
  const endRef = useRef(null);
  const agyAvailable = Boolean(diagnostics?.antigravity?.available);
  const isPending = run?.status === 'pending';
  const isRunning = run?.status === 'running';
  const isTerminal = run && ['completed', 'failed', 'cancelled'].includes(run.status);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, events.length, run?.status]);

  const activity = buildActivityMessages(events);
  const modifiedFiles = [...new Set([
    ...events.filter(e => e.type === 'files.changed').flatMap(e => e.files ?? []),
    ...(run?.memory?.steps ?? []).flatMap(s => s.files ?? []),
  ])];
  const agentsUsed = [...new Set((run?.memory?.steps ?? []).map(s => s.agent))];
  const retries = (run?.memory?.steps ?? []).filter(s => s.agent === 'codex-fix').length;
  const activeSkills = skills.filter(s => s.status === 'active').map(s => s.name);
  const isLocalProject = run?.source?.type === 'local-project';
  const sourceName = isLocalProject
    ? (projectConfig.project?.projectPath === run.source.projectPath ? projectConfig.project.name : run.source.projectPath)
    : 'Plantilla de demostración';
  const acceptanceLabel = isLocalProject
    ? `npm run ${run.source.acceptanceScript}`
    : (run?.memory?.acceptance || 'node --test password.test.js');

  const resultLabel = run?.status === 'completed'
    ? 'Pruebas aprobadas'
    : (run?.status === 'cancelled' ? 'Ejecución cancelada' : 'Pruebas fallidas');

  const evidencePayload = run ? {
    objetivo: run.goal,
    modo: run.mode === 'codex' ? 'Ejecución local real' : 'Modo demostración',
    skillsActivas: activeSkills,
    agentesUsados: agentsUsed,
    fuente: sourceName,
    archivosModificados: modifiedFiles,
    pruebaDeAceptacion: acceptanceLabel,
    duracion: formatDuration(run.startedAt, run.completedAt),
    reintentos: retries,
    estadoFinal: resultLabel,
  } : null;

  return (
    <section className="chat-main" aria-label="Chat de trabajo">
      {!connected && (
        <div className="connect-banner">
          <span>Conecta el token local del servidor en Ajustes para conversar y aprobar planes.</span>
          <button type="button" className="primary sm" onClick={onOpenSettings}>Abrir Ajustes</button>
        </div>
      )}

      <div className="thread">
        {messages.length === 0 && (
          <ChatMessage
            role="assistant"
            author="OmniPilot"
            meta={(
              <span className={mode === 'codex' ? 'mode-pill real' : 'mode-pill demo'}>
                {mode === 'codex' ? 'Ejecución local real' : 'Modo demostración'}
              </span>
            )}
          >
            <p>Escribe un saludo, pregunta por los agentes o describe una tarea de código. Prepararé un plan antes de ejecutar cualquier cambio.</p>
          </ChatMessage>
        )}

        {messages.map(m => (
          <ChatMessage
            key={m.id}
            role={m.role === 'user' ? 'user' : 'assistant'}
            author={m.role === 'user' ? 'Tú' : 'OmniPilot'}
            meta={<time className="mono-time">{m.createdAt.slice(11, 19)}</time>}
          >
            <p>{m.text}</p>
          </ChatMessage>
        ))}

        {run && (
          <ChatMessage
            role="assistant"
            author="Plan determinista"
            meta={(
              <span className="row-inline">
                <StatusBadge variant={run.mode === 'codex' ? 'ok' : 'wait'}>
                  {run.mode === 'codex' ? 'Ejecución local real' : 'Modo demostración'}
                </StatusBadge>
                <TooltipInfo text="Plan determinista local. Requiere tu aprobación antes de ejecutar agentes." label="Sobre el plan" />
              </span>
            )}
          >
            <p className="muted-p">
              <strong>Codex</strong> implementa,{' '}
              <strong>{agyAvailable && run.mode === 'codex' ? 'Antigravity' : 'Codex (lectura)'}</strong> revisa y{' '}
              <strong>pruebas locales</strong> verifican.
            </p>
            <div className="run-source-summary">
              <span><strong>Fuente</strong> {sourceName}</span>
              <span><strong>Prueba</strong> <code>{acceptanceLabel}</code></span>
              <small>OmniPilot trabaja sobre una copia temporal. Tu proyecto original no se modifica.</small>
            </div>
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
                <button type="button" className="primary" onClick={onApprove} disabled={busy}>
                  <IconPlay /> {busy ? 'Iniciando...' : 'Aprobar y ejecutar'}
                </button>
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
        )}

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
                <div><dt>Fuente</dt><dd>{evidencePayload.fuente}</dd></div>
                <div><dt>Archivos modificados</dt><dd className="mono-inline">{modifiedFiles.join(', ') || 'Ninguno'}</dd></div>
                <div><dt>Prueba de aceptación</dt><dd className="mono-inline">{evidencePayload.pruebaDeAceptacion}</dd></div>
                <div><dt>Duración</dt><dd className="mono-inline">{evidencePayload.duracion}</dd></div>
                <div><dt>Estado final</dt><dd>{resultLabel}</dd></div>
              </dl>
              <p className="copy-note">OmniPilot trabajó sobre una copia temporal. El proyecto original no se modificó.</p>
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

        {events.length > 0 && (
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
        )}

        <div ref={endRef} />
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <ProjectSelector {...projectConfig} disabled={!connected || isRunning || Boolean(run && !isTerminal)} />

      <ChatComposer
        value={composerText}
        onChange={setComposerText}
        onSend={onSendMessage}
        disabled={!connected || isRunning || !projectConfig.ready}
        sending={sending}
      />
    </section>
  );
}
