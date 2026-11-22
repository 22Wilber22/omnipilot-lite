import { useEffect, useRef, useState } from 'react';
import { apiRequest, streamRunEvents } from './apiClient.js';
import { IconLogo, IconSettings } from './components/Icons.jsx';
import Sidebar from './components/Sidebar.jsx';
import HistoryList from './components/HistoryList.jsx';
import ActiveTeamPanel from './components/ActiveTeamPanel.jsx';
import ChatWorkspace from './components/ChatWorkspace.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';

const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled']);

const INITIAL_SKILLS = [
  { id: 'clean-code', name: 'Código limpio', description: 'Cambios pequeños, nombres claros y sin complejidad extra.', status: 'active' },
  { id: 'focused-changes', name: 'Cambios enfocados', description: 'Limita las ediciones a los archivos necesarios de la tarea.', status: 'active' },
  { id: 'controlled-fix', name: 'Corrección controlada', description: 'Un único intento de corrección guiado por el error real.', status: 'installed' },
  { id: 'security-review', name: 'Revisión de seguridad', description: 'Verifica rutas, entradas y ausencia de comandos inseguros.', status: 'suggested' },
  { id: 'reusable-components', name: 'Componentes reutilizables', description: 'Favorece piezas pequeñas con una sola responsabilidad.', status: 'suggested' },
];

const SAMPLE_HISTORY = [
  { id: 'sample-1', title: 'Validación de contraseña', status: 'completed', timeAgo: 'hace 12m' },
  { id: 'sample-2', title: 'Revisión de workspace Git', status: 'completed', timeAgo: 'hace 1h' },
];

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('codex');
  const [goal, setGoal] = useState('Implementar validatePassword para que pase la prueba de aceptación.');
  const [acceptance, setAcceptance] = useState('node --test password.test.js');
  const [roles, setRoles] = useState({
    plan: 'antigravity',
    implement: 'codex',
    review: 'antigravity',
    fix: 'codex',
  });
  const [skills, setSkills] = useState(INITIAL_SKILLS);
  const [usageLevels, setUsageLevels] = useState({ codex: 'Medio', antigravity: 'Bajo' });
  const [diagnostics, setDiagnostics] = useState(null);
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const streamAbortRef = useRef(null);

  useEffect(() => () => streamAbortRef.current?.abort(), []);

  async function checkConnection() {
    try {
      setBusy(true);
      setError('');
      setDiagnostics(await apiRequest(token, '/api/diagnostics'));
    } catch (e) {
      setDiagnostics(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshRun(id) {
    try {
      const latest = await apiRequest(token, `/api/runs/${id}`);
      setRun(latest);
      if (Array.isArray(latest.events)) setEvents(latest.events);
    } catch (e) {
      setError(e.message);
    }
  }

  function startSse(runId) {
    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;
    streamRunEvents(token, runId, {
      signal: ac.signal,
      onEvent(ev) {
        setEvents(prev => (prev.some(x => x.seq === ev.seq) ? prev : [...prev, ev]));
        if (TERMINAL_EVENTS.has(ev.type)) {
          ac.abort();
          refreshRun(runId);
        }
      },
      onError(err) {
        setError(err.message);
      },
    });
  }

  async function createPlan() {
    try {
      setBusy(true);
      setError('');
      streamAbortRef.current?.abort();
      const created = await apiRequest(token, '/api/runs', {
        method: 'POST',
        body: { goal, mode, acceptance },
      });
      setRun(created);
      setEvents(created.events ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function approveRun() {
    if (!run || run.status !== 'pending') return;
    try {
      setBusy(true);
      setError('');
      await apiRequest(token, `/api/runs/${run.id}/approve`, { method: 'POST' });
      setRun(prev => (prev ? { ...prev, status: 'running' } : prev));
      startSse(run.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelActiveRun() {
    if (!run || run.status !== 'running') return;
    try {
      setBusy(true);
      setError('');
      await apiRequest(token, `/api/runs/${run.id}/cancel`, { method: 'POST' });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function resetTask() {
    streamAbortRef.current?.abort();
    setRun(null);
    setEvents([]);
    setError('');
  }

  const lastStarted = [...events].reverse().find(e => e.type === 'step.started');
  const activeAgent = run?.status === 'running' ? (lastStarted?.agent ?? '') : '';

  const historyItems = run
    ? [{ id: run.id, title: run.goal.slice(0, 34), status: run.status, timeAgo: 'ahora' }, ...SAMPLE_HISTORY]
    : SAMPLE_HISTORY;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <IconLogo size={20} />
          <strong>OmniPilot <span>Lite</span></strong>
        </div>
        <div className="topbar-right">
          {diagnostics && <span className="status-pill">Conectado localmente</span>}
          <button
            type="button"
            className="secondary sm"
            onClick={() => setSettingsOpen(true)}
            aria-label="Abrir ajustes"
          >
            <IconSettings /> Ajustes
          </button>
        </div>
      </header>

      <div className="shell-grid">
        <Sidebar title="Historial" side="left">
          <HistoryList
            items={historyItems}
            activeId={run?.id ?? 'sample-1'}
            onNewTask={resetTask}
          />
        </Sidebar>

        <ChatWorkspace
          connected={Boolean(diagnostics)}
          diagnostics={diagnostics}
          mode={mode}
          goal={goal}
          setGoal={setGoal}
          acceptance={acceptance}
          setAcceptance={setAcceptance}
          run={run}
          events={events}
          skills={skills}
          onCreatePlan={createPlan}
          onApprove={approveRun}
          onCancel={cancelActiveRun}
          onNewTask={resetTask}
          onOpenSettings={() => setSettingsOpen(true)}
          busy={busy}
          error={error}
        />

        <Sidebar title="Equipo activo" side="right">
          <ActiveTeamPanel
            diagnostics={diagnostics}
            usageLevels={usageLevels}
            activeAgent={activeAgent}
          />
        </Sidebar>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        token={token}
        setToken={setToken}
        mode={mode}
        setMode={setMode}
        diagnostics={diagnostics}
        onCheckConnection={checkConnection}
        roles={roles}
        setRoles={setRoles}
        skills={skills}
        setSkills={setSkills}
        usageLevels={usageLevels}
        setUsageLevels={setUsageLevels}
        busy={busy}
        error={error}
      />
    </div>
  );
}
