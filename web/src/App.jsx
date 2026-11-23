import { useEffect, useRef, useState } from 'react';
import { apiRequest, fetchRunArtifact, streamRunEvents } from './apiClient.js';
import { IconLogo, IconSettings } from './components/Icons.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatsDrawer from './components/ChatsDrawer.jsx';
import ActiveTeamPanel from './components/ActiveTeamPanel.jsx';
import ChatWorkspace from './components/ChatWorkspace.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import ProjectModal from './components/ProjectModal.jsx';

const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled']);
const SESSION_TOKEN_KEY = 'omnipilot.sessionToken';
const SAFE_PROJECT_PATH = /^[\p{L}\p{N}._/ -]*$/u;

const INITIAL_SKILLS = [
  { id: 'orchestrator-driven-development', name: 'ODD · Orchestrator-Driven Development', description: 'Planifica, delega, supervisa, verifica y deja evidencia.', status: 'active' },
  { id: 'clean-code', name: 'Código limpio', description: 'Cambios pequeños, nombres claros y sin complejidad extra.', status: 'active' },
  { id: 'focused-changes', name: 'Cambios enfocados', description: 'Limita las ediciones a los archivos necesarios de la tarea.', status: 'active' },
  { id: 'controlled-fix', name: 'Corrección controlada', description: 'Un único intento de corrección guiado por el error real.', status: 'installed' },
  { id: 'security-review', name: 'Revisión de seguridad', description: 'Verifica rutas, entradas y ausencia de comandos inseguros.', status: 'suggested' },
  { id: 'reusable-components', name: 'Componentes reutilizables', description: 'Favorece piezas pequeñas con una sola responsabilidad.', status: 'suggested' },
];

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(null);
  const chatsBtnRef = useRef(null);
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('codex');
  const [composerText, setComposerText] = useState('');
  const [roles, setRoles] = useState({ plan: 'antigravity', implement: 'codex', review: 'antigravity', fix: 'codex' });
  const [skills, setSkills] = useState(INITIAL_SKILLS);
  const [usageLevels, setUsageLevels] = useState({ codex: 'Medio', antigravity: 'Bajo' });
  const [budgets, setBudgets] = useState({ codex: 40000, antigravity: 20000 });
  const [diagnostics, setDiagnostics] = useState(null);
  const [sourceType, setSourceType] = useState('template');
  const [projectPath, setProjectPath] = useState('');
  const [inspectedProject, setInspectedProject] = useState(null);
  const [acceptanceScript, setAcceptanceScript] = useState('');
  const [dependencyInstallMode, setDependencyInstallMode] = useState('safe');
  const [inspectingProject, setInspectingProject] = useState(false);
  const [projectError, setProjectError] = useState('');

  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [sending, setSending] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [targetScope, setTargetScope] = useState('');
  const [savedProjectConfig, setSavedProjectConfig] = useState(null);
  const [chatSettings, setChatSettings] = useState({ chatProvider: 'auto', chatModel: null, chatStyle: 'fast' });
  const [availableModels, setAvailableModels] = useState({ antigravity: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detachedRun, setDetachedRun] = useState(false);
  const streamAbortRef = useRef(null);

  useEffect(() => () => streamAbortRef.current?.abort(), []);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (!stored) return;
    setToken(stored);
    checkConnection(stored, true);
  }, []);
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

  function applyProjectConfig(cfg) {
    if (!cfg) return;
    setSavedProjectConfig(cfg);
    setSourceType(cfg.sourceType);
    setTargetScope(cfg.targetScope || '');
    setDependencyInstallMode(cfg.dependencyInstallMode === 'approved-scripts' ? 'approved-scripts' : 'safe');
    if (cfg.sourceType === 'local-project') {
      setProjectPath(cfg.projectPath || '');
      setAcceptanceScript(cfg.acceptanceScript || '');
      setInspectedProject({
        name: cfg.projectName || cfg.projectPath,
        projectPath: cfg.projectPath,
        scripts: cfg.acceptanceScript ? [cfg.acceptanceScript] : [],
        isGitRepository: true,
      });
    } else {
      setProjectPath('');
      setAcceptanceScript('');
      setInspectedProject(null);
    }
  }

  async function saveProjectConfig(convId, cfg, currentToken = token) {
    if (!convId || !currentToken) return null;
    const res = await apiRequest(currentToken, `/api/conversations/${convId}/project-config`, {
      method: 'PUT',
      body: cfg,
    });
    return res?.projectConfig ?? null;
  }

  async function openConversation(id, currentToken = token) {
    streamAbortRef.current?.abort();
    const conv = await apiRequest(currentToken, `/api/conversations/${id}`);
    setActiveConvId(conv.id);
    setDetachedRun(false);
    setMessages(conv.messages ?? []);
    if (conv.projectConfig) applyProjectConfig(conv.projectConfig);
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

  async function checkConnection(overrideToken, silent = false) {
    const candidate = typeof overrideToken === 'string' ? overrideToken : token;
    if (!candidate.trim()) return;
    try {
      setBusy(true);
      setError('');
      const diag = await apiRequest(candidate, '/api/diagnostics');
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, candidate);
      setDiagnostics(diag);
      apiRequest(candidate, '/api/settings').then(data => {
        if (data?.settings) setChatSettings(data.settings);
        if (data?.availableModels) setAvailableModels(data.availableModels);
      }).catch(() => {});
      const list = await refreshConversationList(candidate);
      if (list.length > 0) {
        await openConversation(list[0].id, candidate);
      }
    } catch (e) {
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
      setDiagnostics(null);
      if (!silent) {
        setError(
          /Failed to fetch|NetworkError/i.test(e.message)
            ? 'No se pudo conectar con el servidor local. Verifica que esté activo y pega el token actual.'
            : e.message,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateChatSettings(patch) {
    try {
      const res = await apiRequest(token, '/api/settings', { method: 'PUT', body: patch });
      if (res?.settings) setChatSettings(res.settings);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleDisconnect() {
    streamAbortRef.current?.abort();
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    setToken('');
    setDiagnostics(null);
    setConversations([]);
    setActiveConvId(null);
    setMessages([]);
    setRun(null);
    setEvents([]);
    setSavedProjectConfig(null);
    setError('');
  }

  function startSse(runId, convId, currentToken = token) {
    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;
    streamRunEvents(currentToken, runId, {
      signal: ac.signal,
      onEvent(ev) {
        setEvents(prev => (prev.some(x => x.seq === ev.seq) ? prev : [...prev, ev]));
        if (ev.type === 'delegation.phase' && ev.delegation) {
          setRun(current => current ? {
            ...current,
            memory: {
              ...current.memory,
              delegation: (current.memory?.delegation ?? []).map(item => (
                item.phase === ev.delegation.phase ? ev.delegation : item
              )),
            },
          } : current);
        }
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

  async function handleResolvePendingAction(action) {
    if (!activeConvId) return;
    try {
      setSending(true);
      setError('');
      const label = action === 'prepare-plan' ? 'Preparar plan' : 'Trabajar en código';
      const res = await apiRequest(token, `/api/conversations/${activeConvId}/messages`, {
        method: 'POST',
        body: { text: label, intent: 'chat', resolveAction: action },
      });
      setMessages(res.conversation.messages ?? []);
      setPendingAction(res.conversation.pendingAction ?? null);
      await refreshConversationList();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function handleRetryMessage(messageId) {
    if (!activeConvId || !messageId) return;
    try {
      setSending(true);
      setError('');
      const res = await apiRequest(token, `/api/conversations/${activeConvId}/messages/${encodeURIComponent(messageId)}/retry`, {
        method: 'POST',
        body: { orchestratorProvider: roles.plan === 'codex' ? 'codex' : 'antigravity' },
      });
      setMessages(res.conversation.messages ?? []);
      setPendingAction(res.conversation.pendingAction ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function handleNewTask() {
    if (!diagnostics) return;
    try {
      setBusy(true);
      setError('');
      streamAbortRef.current?.abort();
      const suggestedConfig = sourceType === 'local-project' && inspectedProject && acceptanceScript
        ? { sourceType: 'local-project', projectPath: inspectedProject.projectPath, acceptanceScript }
        : { sourceType: 'template' };
      const conv = await apiRequest(token, '/api/conversations', {
        method: 'POST',
        body: { projectConfig: suggestedConfig },
      });
      setActiveConvId(conv.id);
      setMessages([]);
      setPendingAction(null);
      setRun(null);
      setEvents([]);
      setDetachedRun(false);
      if (conv.projectConfig) applyProjectConfig(conv.projectConfig);
      await refreshConversationList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMessage(text) {
    try {
      setSending(true);
      setError('');
      let convId = activeConvId;
      if (!convId) {
        const created = await apiRequest(token, '/api/conversations', { method: 'POST' });
        convId = created.id;
        setActiveConvId(convId);
      }
      if (sourceType === 'local-project' && inspectedProject && acceptanceScript) {
        const saved = await saveProjectConfig(convId, {
          sourceType: 'local-project',
          projectPath: inspectedProject.projectPath,
          acceptanceScript,
          targetScope,
          dependencyInstallMode,
        });
        if (saved) applyProjectConfig(saved);
      } else if (sourceType === 'template') {
        const saved = await saveProjectConfig(convId, { sourceType: 'template', targetScope });
        if (saved) applyProjectConfig(saved);
      }
      const res = await apiRequest(token, `/api/conversations/${convId}/messages`, {
        method: 'POST',
        body: {
          text,
          intent: 'chat',
          orchestratorProvider: roles.plan === 'codex' ? 'codex' : 'antigravity',
          mode: sourceType === 'local-project' ? 'codex' : mode,
          budgets,
        },
      });
      setComposerText('');
      setMessages(res.conversation.messages ?? []);
      setPendingAction(res.conversation.pendingAction ?? null);
      if (res.run) {
        setRun(res.run);
        setEvents(res.run.events ?? []);
      }
      setDetachedRun(false);
      await refreshConversationList();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleConvertToTask(sourceMessageId) {
    if (!activeConvId) return;
    setShowProjectPicker(true);
    if (sourceType === 'local-project' && (!inspectedProject || !acceptanceScript)) {
      setError('Elige primero el proyecto y la prueba de aceptación arriba, luego vuelve a pulsar Convertir en tarea.');
      return;
    }
    try {
      setBusy(true);
      setError('');
      const saved = await saveProjectConfig(
        activeConvId,
        sourceType === 'local-project'
          ? { sourceType: 'local-project', projectPath: inspectedProject.projectPath, acceptanceScript, targetScope, dependencyInstallMode }
          : { sourceType: 'template', targetScope },
      );
      if (saved) applyProjectConfig(saved);
      const activeSkillIds = skills.filter(s => s.status === 'active').map(s => s.id);
      const res = await apiRequest(token, `/api/conversations/${activeConvId}/convert-to-task`, {
        method: 'POST',
        body: { sourceMessageId, mode: sourceType === 'local-project' ? 'codex' : mode, budgets, activeSkills: activeSkillIds },
      });
      setMessages(res.conversation.messages ?? []);
      if (res.run) {
        setRun(res.run);
        setEvents(res.run.events ?? []);
      }
      await refreshConversationList();
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

  async function downloadRunArtifact(path, expectedContentType, fallbackFilename) {
    if (!token) return;
    setError('');
    try {
      const { blob, filename } = await fetchRunArtifact(token, path, { expectedContentType, fallbackFilename });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || 'No se pudo descargar el archivo');
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

  useEffect(() => {
    const locked = chatsOpen || settingsOpen || showProjectPicker;
    document.body.style.overflow = locked ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [chatsOpen, settingsOpen, showProjectPicker]);

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
            ref={chatsBtnRef}
            type="button"
            className="secondary sm"
            onClick={() => setChatsOpen(v => !v)}
            aria-expanded={chatsOpen}
            aria-controls="chats-drawer"
            aria-label="Mostrar u ocultar historial de chats"
          >
            Chats
          </button>
          <button
            type="button"
            className="secondary sm mobile-only"
            onClick={() => setMobilePanel(p => (p === 'right' ? null : 'right'))}
            aria-expanded={mobilePanel === 'right'}
            aria-label="Mostrar u ocultar equipo activo"
          >
            Equipo
          </button>
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

      <div className={`shell-grid${mobilePanel ? ` show-${mobilePanel}` : ''}`}>
        <ChatWorkspace
          connected={Boolean(diagnostics)}
          diagnostics={diagnostics}
          mode={mode}
          composerText={composerText}
          setComposerText={setComposerText}
          messages={messages}
          pendingAction={pendingAction}
          run={run}
          events={events}
          skills={skills}
          onSendMessage={handleSendMessage}
          onConvertToTask={handleConvertToTask}
          onResolvePendingAction={handleResolvePendingAction}
          onRetryMessage={handleRetryMessage}
          onApprove={approveRun}
          onCancel={cancelActiveRun}
          onNewTask={handleNewTask}
          onDownloadEvidence={runId => downloadRunArtifact(`/api/runs/${encodeURIComponent(runId)}/evidence`, 'application/json', `omnipilot-evidence-${runId}.json`)}
          onDownloadPatch={runId => downloadRunArtifact(`/api/runs/${encodeURIComponent(runId)}/patch`, 'text/x-diff', `omnipilot-changes-${runId}.diff`)}
          onOpenSettings={() => setSettingsOpen(true)}
          showProjectPicker={showProjectPicker}
          onToggleProjectPicker={() => setShowProjectPicker(v => !v)}
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
            savedConfig: savedProjectConfig,
          }}
        />

        <Sidebar title="Equipo activo" side="right">
          <ActiveTeamPanel
            diagnostics={diagnostics}
            runUsage={run?.usage}
            activeAgent={activeAgent}
            chatSettings={chatSettings}
            savedProjectConfig={savedProjectConfig}
            isRunning={run?.status === 'running'}
            onOpenProjectPicker={() => setShowProjectPicker(true)}
          />
        </Sidebar>
      </div>

      <ChatsDrawer
        open={chatsOpen}
        onClose={() => setChatsOpen(false)}
        returnFocusRef={chatsBtnRef}
        items={conversations}
        activeId={activeConvId}
        connected={Boolean(diagnostics)}
        onNewTask={handleNewTask}
        onSelect={id => openConversation(id).catch(e => setError(e.message))}
        onOpenSettings={() => setSettingsOpen(true)}
        busy={busy}
      />

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        token={token}
        setToken={setToken}
        mode={mode}
        setMode={setMode}
        diagnostics={diagnostics}
        onCheckConnection={() => checkConnection()}
        onDisconnect={handleDisconnect}
        roles={roles}
        setRoles={setRoles}
        skills={skills}
        setSkills={setSkills}
        usageLevels={usageLevels}
        setUsageLevels={setUsageLevels}
        budgets={budgets}
        setBudgets={setBudgets}
        chatSettings={chatSettings}
        availableModels={availableModels}
        onUpdateChatSettings={handleUpdateChatSettings}
        busy={busy}
        error={error}
      />
      <ProjectModal
        open={showProjectPicker}
        onClose={() => setShowProjectPicker(false)}
        onConfirm={async () => {
          let convId = activeConvId;
          if (!convId && diagnostics) {
            const created = await apiRequest(token, '/api/conversations', { method: 'POST' });
            convId = created.id;
            setActiveConvId(convId);
          }
          const cfg = sourceType === 'local-project'
            ? { sourceType: 'local-project', projectPath: inspectedProject.projectPath, acceptanceScript, targetScope, dependencyInstallMode }
            : { sourceType: 'template', targetScope };
          const saved = await saveProjectConfig(convId, cfg);
          if (saved) applyProjectConfig(saved);
          setShowProjectPicker(false);
        }}
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
          savedConfig: savedProjectConfig,
        }}
        targetScope={targetScope}
        setTargetScope={setTargetScope}
        dependencyInstallMode={dependencyInstallMode}
        setDependencyInstallMode={setDependencyInstallMode}
        disabled={!diagnostics || busy}
      />
    </div>
  );
}
