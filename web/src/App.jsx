import { useEffect, useRef, useState } from 'react';
import { apiRequest, streamRunEvents } from './apiClient.js';
import { IconLogo, IconSettings } from './components/Icons.jsx';
import Sidebar from './components/Sidebar.jsx';
import HistoryList from './components/HistoryList.jsx';
import ActiveTeamPanel from './components/ActiveTeamPanel.jsx';
import ChatWorkspace from './components/ChatWorkspace.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';

const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled']);
const SAFE_PROJECT_PATH = /^[\p{L}\p{N}._/ -]*$/u;

const INITIAL_SKILLS = [
  { id: 'clean-code', name: 'Código limpio', description: 'Cambios pequeños, nombres claros y sin complejidad extra.', status: 'active' },
  { id: 'focused-changes', name: 'Cambios enfocados', description: 'Limita las ediciones a los archivos necesarios de la tarea.', status: 'active' },
  { id: 'controlled-fix', name: 'Corrección controlada', description: 'Un único intento de corrección guiado por el error real.', status: 'installed' },
  { id: 'security-review', name: 'Revisión de seguridad', description: 'Verifica rutas, entradas y ausencia de comandos inseguros.', status: 'suggested' },
  { id: 'reusable-components', name: 'Componentes reutilizables', description: 'Favorece piezas pequeñas con una sola responsabilidad.', status: 'suggested' },
];

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('codex');
  const [composerText, setComposerText] = useState('');
  const [roles, setRoles] = useState({ plan: 'antigravity', implement: 'codex', review: 'antigravity', fix: 'codex' });
  const [skills, setSkills] = useState(INITIAL_SKILLS);
  const [usageLevels, setUsageLevels] = useState({ codex: 'Medio', antigravity: 'Bajo' });
  const [diagnostics, setDiagnostics] = useState(null);
  const [sourceType, setSourceType] = useState('template');
  const [projectPath, setProjectPath] = useState('');
  const [inspectedProject, setInspectedProject] = useState(null);
  const [acceptanceScript, setAcceptanceScript] = useState('');
  const [inspectingProject, setInspectingProject] = useState(false);
  const [projectError, setProjectError] = useState('');

  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detachedRun, setDetachedRun] = useState(false);
  const streamAbortRef = useRef(null);

  useEffect(() => () => streamAbortRef.current?.abort(), []);
  useEffect(() => {
    if (sourceType === 'local-project' && mode !== 'codex') setMode('codex');
  }, [sourceType, mode]);

  const sourceReady = sourceType === 'template' || Boolean(inspectedProject && acceptanceScript);

  async function refreshConversationList(currentToken = token) {
    const data = await apiRequest(currentToken, '/api/conversations');
    const list = data?.conversations ?? [];
    setConversations(list);
    return list;
  }

  async function openConversation(id, currentToken = token) {
    streamAbortRef.current?.abort();
    const conv = await apiRequest(currentToken, `/api/conversations/${id}`);
    setActiveConvId(conv.id);
    setDetachedRun(false);
    setMessages(conv.messages ?? []);
    const lastRunId = conv.runIds?.at(-1);
    if (lastRunId) {
      try {
        const latestRun = await apiRequest(currentToken, `/api/runs/${lastRunId}`);
        setRun(latestRun);
        setEvents(latestRun.events ?? []);
        if (latestRun.status === 'running') startSse(latestRun.id, conv.id, currentToken);
      } catch {
        setRun(null);
        setEvents([]);
      }
    } else {
      setRun(null);
      setEvents([]);
    }
  }

  async function checkConnection() {
    try {
      setBusy(true);
      setError('');
      const diag = await apiRequest(token, '/api/diagnostics');
      setDiagnostics(diag);
      const list = await refreshConversationList(token);
      if (list.length > 0) {
        await openConversation(list[0].id, token);
      }
    } catch (e) {
      setDiagnostics(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function startSse(runId, convId, currentToken = token) {
    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;
    streamRunEvents(currentToken, runId, {
      signal: ac.signal,
      onEvent(ev) {
        setEvents(prev => (prev.some(x => x.seq === ev.seq) ? prev : [...prev, ev]));
        if (TERMINAL_EVENTS.has(ev.type)) {
          ac.abort();
          apiRequest(currentToken, `/api/runs/${runId}`).then(latest => {
            setRun(latest);
            if (Array.isArray(latest.events)) setEvents(latest.events);
          }).catch(() => {});
          if (convId) {
            apiRequest(currentToken, `/api/conversations/${convId}`).then(c => setMessages(c.messages ?? [])).catch(() => {});
            refreshConversationList(currentToken).catch(() => {});
          }
        }
      },
      onError(err) {
        setError(err.message);
      },
    });
  }

  async function handleNewTask() {
    if (!diagnostics) return;
    try {
      setBusy(true);
      setError('');
      streamAbortRef.current?.abort();
      const conv = await apiRequest(token, '/api/conversations', { method: 'POST' });
      setActiveConvId(conv.id);
      setMessages([]);
      setRun(null);
      setEvents([]);
      setDetachedRun(false);
      await refreshConversationList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMessage(text) {
    if (!sourceReady) return false;
    try {
      setSending(true);
      setError('');
      const source = sourceType === 'local-project'
        ? { type: 'local-project', projectPath: inspectedProject.projectPath, acceptanceScript }
        : { type: 'template' };
      const createdRun = await apiRequest(token, '/api/runs', {
        method: 'POST',
        body: { goal: text, mode: sourceType === 'local-project' ? 'codex' : mode, source },
      });
      const createdAt = new Date().toISOString();
      setComposerText('');
      setMessages(previous => [
        ...previous,
        { id: `local-user-${createdRun.id}`, role: 'user', text, createdAt },
        {
          id: `local-plan-${createdRun.id}`,
          role: 'orchestrator',
          text: 'Preparé un plan para esta tarea. Revísalo y pulsa Aprobar y ejecutar.',
          createdAt,
        },
      ]);
      setRun(createdRun);
      setEvents(createdRun.events ?? []);
      setDetachedRun(true);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function approveRun() {
    if (!run || run.status !== 'pending') return;
    try {
      setBusy(true);
      setError('');
      await apiRequest(token, `/api/runs/${run.id}/approve`, { method: 'POST' });
      setRun(prev => (prev ? { ...prev, status: 'running' } : prev));
      startSse(run.id, detachedRun ? null : activeConvId);
      await refreshConversationList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function changeSourceType(nextType) {
    setSourceType(nextType);
    setProjectPath('');
    setInspectedProject(null);
    setAcceptanceScript('');
    setProjectError('');
  }

  function changeProjectPath(nextPath) {
    const parts = nextPath.split('/');
    const unsafe = nextPath.startsWith('/')
      || /^[A-Za-z]:[\\/]/.test(nextPath)
      || parts.includes('..')
      || !SAFE_PROJECT_PATH.test(nextPath);
    if (unsafe) {
      setProjectError('Usa solo una carpeta relativa, sin comandos, rutas absolutas ni “..”.');
      return;
    }
    setProjectPath(nextPath);
    setInspectedProject(null);
    setAcceptanceScript('');
    setProjectError('');
  }

  async function inspectProject() {
    if (!projectPath.trim()) return;
    try {
      setInspectingProject(true);
      setProjectError('');
      const project = await apiRequest(token, '/api/projects/inspect', {
        method: 'POST',
        body: { projectPath: projectPath.trim() },
      });
      setInspectedProject(project);
      setAcceptanceScript('');
    } catch (inspectionError) {
      setInspectedProject(null);
      setAcceptanceScript('');
      const message = inspectionError.message.includes('PROJECTS_ROOT no existe')
        ? 'La carpeta ~/OmniPilotProjects no existe o no está disponible.'
        : inspectionError.message;
      setProjectError(message);
    } finally {
      setInspectingProject(false);
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

  const lastStarted = [...events].reverse().find(e => e.type === 'step.started');
  const activeAgent = run?.status === 'running' ? (lastStarted?.agent ?? '') : '';

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
        <Sidebar title="Chats" side="left">
          <HistoryList
            items={conversations}
            activeId={activeConvId}
            connected={Boolean(diagnostics)}
            onNewTask={handleNewTask}
            onSelect={id => openConversation(id).catch(e => setError(e.message))}
            busy={busy}
          />
        </Sidebar>

        <ChatWorkspace
          connected={Boolean(diagnostics)}
          diagnostics={diagnostics}
          mode={mode}
          composerText={composerText}
          setComposerText={setComposerText}
          messages={messages}
          run={run}
          events={events}
          skills={skills}
          onSendMessage={handleSendMessage}
          onApprove={approveRun}
          onCancel={cancelActiveRun}
          onNewTask={handleNewTask}
          onOpenSettings={() => setSettingsOpen(true)}
          sending={sending}
          busy={busy}
          error={error}
          projectConfig={{
            sourceType,
            onSourceTypeChange: changeSourceType,
            projectPath,
            onProjectPathChange: changeProjectPath,
            project: inspectedProject,
            acceptanceScript,
            onAcceptanceScriptChange: setAcceptanceScript,
            onInspect: inspectProject,
            inspecting: inspectingProject,
            error: projectError,
            ready: sourceReady,
          }}
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
