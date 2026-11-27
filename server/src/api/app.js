import express from 'express';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, getRun, publicRun, startRun, cancelRun, subscribe, markApproved } from '../orchestrator/orchestrator.js';
import { codexConnector } from '../connectors/codexConnector.js';
import { antigravityConnector } from '../connectors/antigravityConnector.js';
import { createConversationStore } from '../memory/conversationStore.js';
import { createSettingsStore } from '../memory/settingsStore.js';
import { classifyMessage } from '../orchestrator/messageClassifier.js';
import {
  runOrchestratorChat,
  offersPlanOrExecution,
  resolvePendingActionIntent,
  isDirectExecuteIntent,
  buildConceptualPlanReply,
} from '../orchestrator/chatOrchestrator.js';
import { inspectLocalProject, validateLocalProjectSource } from '../projects/localProjects.js';
import { buildEvidenceDocument, readSafePatch } from '../security/runArtifacts.js';

export const DEFAULT_CONVERSATIONS_DIR = fileURLToPath(new URL('../../../data/conversations', import.meta.url));
export const DEFAULT_SETTINGS_PATH = fileURLToPath(new URL('../../../data/settings.json', import.meta.url));

function sanitizeTargetScope(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Archivo objetivo inválido');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 160 || isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.split(/[\\/]+/).includes('..')) {
    throw new Error('Archivo objetivo inválido: usa una ruta relativa sin ".." ni rutas absolutas');
  }
  return trimmed;
}

function taskGoalFromPlan(messages, sourceMessageId) {
  let planIndex = typeof sourceMessageId === 'string'
    ? messages.findIndex(message => message.id === sourceMessageId && message.type === 'plan-conceptual')
    : -1;
  if (planIndex < 0) {
    planIndex = messages.findLastIndex(message => message.type === 'plan-conceptual');
  }
  if (planIndex < 0) throw new Error('Plan conceptual no encontrado');
  for (let index = planIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages[index].text.slice(0, 1200);
  }
  throw new Error('Mensaje original no encontrado');
}

export function createApp({
  token,
  port = Number(process.env.PORT ?? 4317),
  workspacesDir = resolve('workspaces'),
  projectsRoot = process.env.PROJECTS_ROOT,
  conversationsDir = DEFAULT_CONVERSATIONS_DIR,
  settingsPath = DEFAULT_SETTINGS_PATH,
  codex = codexConnector,
  antigravity = antigravityConnector,
  antigravityValidated = true,
  runner,
  agentRegistry,
} = {}) {
  if (!token) throw new Error('Token local requerido');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const conversations = createConversationStore(conversationsDir);
  const settingsStore = createSettingsStore(settingsPath);
  const runToConversation = new Map();
  const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);

  app.use((req, res, next) => {
    const host = req.headers.host;
    const allowedHosts = port === 0
      ? [/^127\.0\.0\.1:\d+$/, /^localhost:\d+$/]
      : [new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`)];
    if (!host || !allowedHosts.some(rx => rx.test(host))) {
      return res.status(403).json({ error: 'Host no autorizado' });
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: 'Origin no autorizado' });
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Omni-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
      return res.sendStatus(204);
    }
    next();
  });

  app.use('/api', (req, res, next) => (
    req.get('X-Omni-Token') === token ? next() : res.status(401).json({ error: 'Token requerido' })
  ));

  app.get('/health', (_req, res) => res.json({ status: 'ok', modes: ['demo', 'codex'] }));

  app.get('/api/diagnostics', async (_req, res) => {
    const [codexStatus, agyStatus] = await Promise.all([
      codex.isAvailable(),
      antigravityValidated
        ? antigravity.isAvailable()
        : Promise.resolve({ available: false, version: null, error: 'Conector no validado con llamada real' }),
    ]);
    res.json({
      codex: codexStatus,
      antigravity: { ...agyStatus, validated: antigravityValidated, role: 'review-only' },
    });
  });

  app.get('/api/diagnostics/codex', async (_req, res) => {
    const status = await codex.isAvailable();
    res.json({ provider: 'codex', ...status });
  });

  app.get('/api/settings', async (_req, res) => {
    try {
      const [settings, agyModels] = await Promise.all([
        settingsStore.get(),
        antigravityValidated && typeof antigravity?.listModels === 'function'
          ? antigravity.listModels().catch(() => [])
          : Promise.resolve([]),
      ]);
      res.json({ settings, availableModels: { antigravity: agyModels } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/settings', async (req, res) => {
    try {
      const updated = await settingsStore.update({
        ...(req.body?.chatProvider !== undefined ? { chatProvider: req.body.chatProvider } : {}),
        ...(req.body?.chatModel !== undefined ? { chatModel: req.body.chatModel } : {}),
        ...(req.body?.chatStyle !== undefined ? { chatStyle: req.body.chatStyle } : {}),
      });
      res.json({ settings: updated });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/projects/inspect', async (req, res) => {
    try {
      const project = await inspectLocalProject({ projectsRoot, projectPath: req.body?.projectPath });
      res.json(project);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/conversations', async (_req, res) => {
    try {
      res.json({ conversations: await conversations.list() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/conversations', async (req, res) => {
    try {
      const requested = req.body?.projectConfig;
      let projectConfig = null;
      if (requested?.sourceType === 'template') {
        projectConfig = {
          sourceType: 'template',
          projectName: 'Plantilla de demostración',
          acceptanceScript: 'node --test password.test.js',
          updatedAt: new Date().toISOString(),
        };
      } else if (requested?.sourceType === 'local-project' && requested.projectPath && requested.acceptanceScript) {
        const validated = await validateLocalProjectSource({
          projectsRoot,
          projectPath: requested.projectPath,
          acceptanceScript: requested.acceptanceScript,
        });
        projectConfig = {
          sourceType: 'local-project',
          projectPath: validated.projectPath,
          projectName: validated.projectName || validated.projectPath,
          acceptanceScript: validated.acceptanceScript,
          updatedAt: new Date().toISOString(),
        };
      }
      const conv = await conversations.create({ projectConfig });
      res.status(201).json(conv);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/conversations/:id', async (req, res) => {
    try {
      const conv = await conversations.get(req.params.id);
      return conv ? res.json(conv) : res.sendStatus(404);
    } catch {
      return res.sendStatus(404);
    }
  });

  app.put('/api/conversations/:id/project-config', async (req, res) => {
    try {
      const conv = await conversations.get(req.params.id);
      if (!conv) return res.sendStatus(404);
      const sourceType = req.body?.sourceType;
      const targetScope = sanitizeTargetScope(req.body?.targetScope);
      let normalized;
      if (sourceType === 'template') {
        normalized = {
          sourceType: 'template',
          projectName: 'Plantilla de demostración',
          acceptanceScript: 'node --test password.test.js',
          ...(targetScope ? { targetScope } : {}),
        };
      } else if (sourceType === 'local-project') {
        const validated = await validateLocalProjectSource({
          projectsRoot,
          projectPath: req.body?.projectPath,
          acceptanceScript: req.body?.acceptanceScript,
        });
        normalized = {
          sourceType: 'local-project',
          projectPath: validated.projectPath,
          projectName: validated.projectPath.split('/').pop() || validated.projectPath,
          acceptanceScript: validated.acceptanceScript,
          dependencyInstallMode: req.body?.dependencyInstallMode === 'approved-scripts' ? 'approved-scripts' : 'safe',
          ...(targetScope ? { targetScope } : {}),
        };
      } else {
        return res.status(400).json({ error: 'sourceType inválido' });
      }
      const updated = await conversations.setProjectConfig(conv.id, normalized);
      return res.json({ projectConfig: updated.projectConfig, conversation: updated });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/conversations/:id/messages', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 1200) return res.status(400).json({ error: 'Mensaje inválido' });
    const mode = req.body?.mode === 'demo' ? 'demo' : 'codex';

    let conv;
    try {
      conv = await conversations.get(req.params.id);
    } catch {
      return res.sendStatus(404);
    }
    if (!conv) return res.sendStatus(404);

    const { message: userMessage } = await conversations.appendMessage(conv.id, { role: 'user', type: 'chat', text });

    if (req.body?.intent === 'chat') {
      const explicitAction = req.body?.resolveAction;
      if (explicitAction === 'prepare-plan' || explicitAction === 'choose-project') {
        const prevUser = [...conv.messages].reverse().find(m => m.role === 'user');
        await conversations.setPendingAction(conv.id, null);
        if (explicitAction === 'prepare-plan') {
          const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
            role: 'orchestrator',
            type: 'plan-conceptual',
            text: buildConceptualPlanReply(prevUser?.text || ''),
          });
          return res.status(201).json({ conversation, userMessage, reply, run: null });
        }
        const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
          role: 'orchestrator',
          type: 'needs-project',
          text: 'Perfecto. Selecciona un proyecto y una prueba de aceptación para continuar.',
        });
        return res.status(201).json({ conversation, userMessage, reply, run: null });
      }

      if (conv.pendingAction) {
        const resolved = resolvePendingActionIntent(text);
        if (resolved === 'prepare-plan') {
          const prevUser = [...conv.messages].reverse().find(m => m.role === 'user');
          await conversations.setPendingAction(conv.id, null);
          const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
            role: 'orchestrator',
            type: 'plan-conceptual',
            text: buildConceptualPlanReply(prevUser?.text || ''),
          });
          return res.status(201).json({ conversation, userMessage, reply, run: null });
        }
        if (resolved === 'choose-project') {
          await conversations.setPendingAction(conv.id, null);
          const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
            role: 'orchestrator',
            type: 'needs-project',
            text: 'Perfecto. Selecciona un proyecto y una prueba de aceptación para trabajar en código.',
          });
          return res.status(201).json({ conversation, userMessage, reply, run: null });
        }
        const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
          role: 'orchestrator',
          type: 'chat',
          text: 'No quedó claro: ¿prefieres que prepare el plan o trabajar en código?',
        });
        return res.status(201).json({ conversation, userMessage, reply, run: null });
      }

      const hasConceptualPlan = conv.messages.some(m => m.type === 'plan-conceptual');
      if (isDirectExecuteIntent(text) && hasConceptualPlan) {
        if (!conv.projectConfig) {
          const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
            role: 'orchestrator',
            type: 'needs-project',
            text: 'Para continuar, selecciona un proyecto y una prueba de aceptación.',
            actions: ['select-project'],
          });
          return res.status(201).json({ conversation, userMessage, reply, run: null });
        }
        let source = { type: 'template' };
        let mode = 'demo';
        if (conv.projectConfig.sourceType === 'local-project') {
          try {
            const validated = await validateLocalProjectSource({
              projectsRoot,
              projectPath: conv.projectConfig.projectPath,
              acceptanceScript: conv.projectConfig.acceptanceScript,
            });
            source = {
              type: 'local-project',
              projectPath: validated.projectPath,
              acceptanceScript: validated.acceptanceScript,
              ...(conv.projectConfig.dependencyInstallMode === 'approved-scripts' ? { dependencyInstallMode: 'approved-scripts' } : {}),
            };
            mode = 'codex';
          } catch (e) {
            const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
              role: 'orchestrator',
              type: 'needs-project',
              text: `El proyecto guardado ya no es válido: ${e.message}. Selecciona otro proyecto.`,
            });
            return res.status(201).json({ conversation, userMessage, reply, run: null });
          }
        }
        const goalText = taskGoalFromPlan(conv.messages);
        const run = createRun(goalText, mode, source, req.body?.budgets, req.body?.activeSkills);
        runToConversation.set(run.id, conv.id);
        await conversations.attachRun(conv.id, run.id, 'plan_pending');
        const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
          role: 'orchestrator',
          type: 'tarea',
          text: 'Plan ejecutable listo. Revísalo y pulsa Aprobar y ejecutar.',
          runId: run.id,
        });
        return res.status(201).json({ conversation, userMessage, reply, run: publicRun(run) });
      }

      const saved = await settingsStore.get();
      const provider = req.body?.orchestratorProvider || saved.chatProvider || 'auto';
      const chatRes = await runOrchestratorChat({
        provider,
        model: saved.chatModel,
        style: saved.chatStyle,
        messages: [...conv.messages, userMessage],
        text,
        hasProject: Boolean(conv.projectConfig),
        codex,
        antigravity,
        antigravityValidated,
      });
      if (!chatRes.ok) {
        const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
          role: 'orchestrator',
          type: 'chat-error',
          text: chatRes.text,
          errorCause: chatRes.errorCause || 'provider-unavailable',
          retryable: true,
          retried: false,
          retrySourceMessageId: userMessage.id,
        });
        return res.status(201).json({ conversation, userMessage, reply, run: null });
      }
      const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
        role: 'orchestrator',
        type: chatRes.type,
        text: chatRes.text,
        actions: chatRes.actions,
      });
      if (offersPlanOrExecution(chatRes.text)) {
        const updated = await conversations.setPendingAction(conv.id, {
          type: 'prepare-plan',
          sourceMessageId: reply.id,
          createdAt: new Date().toISOString(),
        });
        return res.status(201).json({ conversation: updated, userMessage, reply, run: null });
      }
      return res.status(201).json({ conversation, userMessage, reply, run: null });
    }

    const kind = classifyMessage(text);

    if (kind === 'greeting') {
      const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
        role: 'orchestrator',
        text: '¡Hola! Describe el cambio que quieres realizar y prepararé un plan antes de ejecutar.',
      });
      return res.status(201).json({ conversation, userMessage, reply, run: null });
    }

    if (kind === 'conversation') {
      const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
        role: 'orchestrator',
        text: 'Entendido. Cuando quieras, describe una tarea concreta de código o proyecto.',
      });
      return res.status(201).json({ conversation, userMessage, reply, run: null });
    }

    if (kind === 'agents') {
      const [codexStatus, agyStatus] = await Promise.all([
        codex.isAvailable(),
        antigravityValidated ? antigravity.isAvailable() : Promise.resolve({ available: false }),
      ]);
      const summary = `Agentes locales: Codex (${codexStatus.available ? 'disponible' : 'no disponible'}), Antigravity (${agyStatus.available ? 'disponible para revisión' : 'fallback a Codex lectura'}) y Verificador local (pruebas fijas).`;
      const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
        role: 'orchestrator',
        text: summary,
      });
      return res.status(201).json({ conversation, userMessage, reply, run: null });
    }

    if (kind === 'status') {
      const lastRunId = conv.runIds.at(-1);
      const lastRun = lastRunId ? getRun(lastRunId) : null;
      const summary = lastRun
        ? `Estado de la última ejecución: ${lastRun.status}.`
        : 'Todavía no hay ninguna ejecución asociada a esta conversación.';
      const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
        role: 'orchestrator',
        text: summary,
      });
      return res.status(201).json({ conversation, userMessage, reply, run: lastRun ? publicRun(lastRun) : null });
    }

    if (kind === 'question') {
      const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
        role: 'orchestrator',
        text: 'Puedo ayudarte a planificar y ejecutar cambios verificados con pruebas locales. Si quieres iniciar una tarea de código, describe el cambio que necesitas.',
      });
      return res.status(201).json({ conversation, userMessage, reply, run: null });
    }

    // Code task: require valid projectConfig, re-validate local-project, create pending plan without executing
    if (!conv.projectConfig) {
      const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
        role: 'orchestrator',
        text: 'Antes de preparar un plan, elige el proyecto y la prueba de aceptación en el selector superior.',
      });
      return res.status(201).json({ conversation, userMessage, reply, run: null });
    }

    let source;
    if (conv.projectConfig.sourceType === 'local-project') {
      try {
        const validated = await validateLocalProjectSource({
          projectsRoot,
          projectPath: conv.projectConfig.projectPath,
          acceptanceScript: conv.projectConfig.acceptanceScript,
        });
        source = {
          type: 'local-project',
          projectPath: validated.projectPath,
          acceptanceScript: validated.acceptanceScript,
        };
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    } else {
      source = { type: 'template' };
    }

    const run = createRun(text, mode, source, req.body?.budgets, req.body?.activeSkills);
    runToConversation.set(run.id, conv.id);
    await conversations.attachRun(conv.id, run.id, 'plan_pending');
    const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
      role: 'orchestrator',
      text: 'Preparé un plan para esta tarea. Revísalo y pulsa Aprobar y ejecutar.',
      runId: run.id,
    });
    return res.status(201).json({ conversation, userMessage, reply, run: publicRun(run) });
  });

  app.post('/api/conversations/:id/messages/:messageId/retry', async (req, res) => {
    let conv;
    try {
      conv = await conversations.get(req.params.id);
    } catch {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    if (!conv) return res.sendStatus(404);

    const errMsg = conv.messages.find(m => m.id === req.params.messageId && m.type === 'chat-error');
    if (!errMsg) return res.status(404).json({ error: 'Mensaje de error no encontrado' });
    if (errMsg.retried || !errMsg.retryable) {
      return res.status(409).json({ error: 'Este mensaje ya fue reintentado una vez' });
    }

    const srcMsg = conv.messages.find(m => m.id === errMsg.retrySourceMessageId)
      || [...conv.messages].reverse().find(m => m.role === 'user');
    if (!srcMsg) return res.status(400).json({ error: 'Mensaje original no encontrado' });

    const historyUpToSource = conv.messages.slice(0, conv.messages.findIndex(m => m.id === srcMsg.id) + 1);
    const saved = await settingsStore.get();
    const provider = req.body?.orchestratorProvider || saved.chatProvider || 'auto';
    const chatRes = await runOrchestratorChat({
      provider,
      model: saved.chatModel,
      style: saved.chatStyle,
      messages: historyUpToSource,
      text: srcMsg.text,
      hasProject: Boolean(conv.projectConfig),
      codex,
      antigravity,
      antigravityValidated,
    });

    if (!chatRes.ok) {
      const updated = await conversations.updateMessage(conv.id, errMsg.id, {
        type: 'chat-error',
        text: 'El orquestador no está disponible ahora. Puedes continuar o intentarlo más tarde.',
        errorCause: chatRes.errorCause || 'provider-unavailable',
        retryable: false,
        retried: true,
      });
      return res.json({ conversation: updated.conversation, reply: updated.message, run: null });
    }

    const updated = await conversations.updateMessage(conv.id, errMsg.id, {
      type: chatRes.type,
      text: chatRes.text,
      errorCause: undefined,
      retryable: false,
      retried: true,
    });
    return res.json({ conversation: updated.conversation, reply: updated.message, run: null });
  });

  app.post('/api/conversations/:id/convert-to-task', async (req, res) => {
    let conv;
    try {
      conv = await conversations.get(req.params.id);
    } catch {
      return res.sendStatus(404);
    }
    if (!conv) return res.sendStatus(404);
    if (!conv.projectConfig) {
      return res.status(400).json({ error: 'Selecciona primero un proyecto y prueba de aceptación.' });
    }
    let goalText;
    try {
      goalText = taskGoalFromPlan(conv.messages, req.body?.sourceMessageId);
    } catch (error) {
      if (typeof req.body?.goal !== 'string' || !req.body.goal.trim()) {
        return res.status(400).json({ error: error.message });
      }
      goalText = req.body.goal.trim().slice(0, 1200);
    }
    const mode = req.body?.mode === 'demo' ? 'demo' : 'codex';

    let source;
    if (conv.projectConfig.sourceType === 'local-project') {
      try {
        const validated = await validateLocalProjectSource({
          projectsRoot,
          projectPath: conv.projectConfig.projectPath,
          acceptanceScript: conv.projectConfig.acceptanceScript,
        });
        source = {
          type: 'local-project',
          projectPath: validated.projectPath,
          acceptanceScript: validated.acceptanceScript,
          dependencyInstallMode: conv.projectConfig.dependencyInstallMode === 'approved-scripts' ? 'approved-scripts' : 'safe',
        };
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    } else {
      source = { type: 'template' };
    }

    const run = createRun(goalText, mode, source, req.body?.budgets, req.body?.activeSkills);
    runToConversation.set(run.id, conv.id);
    await conversations.attachRun(conv.id, run.id, 'plan_pending');
    const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
      role: 'orchestrator',
      type: 'tarea',
      text: 'Plan ejecutable listo. Revísalo y pulsa Aprobar y ejecutar.',
      runId: run.id,
    });
    return res.status(201).json({ conversation, reply, run: publicRun(run) });
  });

  app.post('/api/runs', async (req, res) => {
    try {
      const requestedSource = req.body?.source ?? { type: 'template' };
      let source;
      if (requestedSource.type === 'template') {
        source = { type: 'template' };
      } else if (requestedSource.type === 'local-project') {
        if (req.body?.mode !== 'codex') throw new Error('local-project requiere mode codex');
        source = await validateLocalProjectSource({
          projectsRoot,
          projectPath: requestedSource.projectPath,
          acceptanceScript: requestedSource.acceptanceScript,
        });
      } else {
        throw new Error('Tipo de source inválido');
      }
      const run = createRun(req.body?.goal, req.body?.mode, source, req.body?.budgets, req.body?.activeSkills);
      res.status(201).json(publicRun(run));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = getRun(req.params.id);
    return run ? res.json(publicRun(run)) : res.sendStatus(404);
  });

  app.get('/api/runs/:id/evidence', async (req, res) => {
    try {
      const run = getRun(req.params.id) || null;
      const evidence = await buildEvidenceDocument({
        runId: req.params.id,
        workspacesDir,
        run,
      });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="omnipilot-evidence-${req.params.id}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(JSON.stringify(evidence, null, 2));
    } catch (e) {
      const status = e.statusCode || 500;
      return res.status(status).json({ error: e.message || 'No se pudo generar la evidencia' });
    }
  });

  app.get('/api/runs/:id/patch', async (req, res) => {
    try {
      const patch = await readSafePatch({
        runId: req.params.id,
        workspacesDir,
      });
      res.setHeader('Content-Type', 'text/x-diff; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="omnipilot-changes-${req.params.id}.diff"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(patch);
    } catch (e) {
      const status = e.statusCode || 500;
      return res.status(status).json({ error: e.message || 'No se pudo obtener el parche' });
    }
  });

  app.post('/api/runs/:id/approve', async (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.sendStatus(404);
    if (run.status !== 'pending') return res.status(409).json({ error: 'Estado inválido' });
    if (run.source?.type === 'local-project') {
      try {
        await validateLocalProjectSource({
          projectsRoot,
          projectPath: run.source.projectPath,
          acceptanceScript: run.source.acceptanceScript,
        });
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }
    markApproved(run);
    const convId = runToConversation.get(run.id);
    if (convId) await conversations.updateStatus(convId, 'running');

    startRun(run, workspacesDir, { codex, antigravity, antigravityValidated, runner, projectsRoot, agentRegistry })
      .catch(e => console.error('Run failure:', e.message))
      .finally(async () => {
        if (!convId) return;
        const finalStatus = ['completed', 'failed', 'cancelled', 'baseline_failed', 'acceptance_manifest_changed'].includes(run.status) ? run.status : 'failed';
        await conversations.updateStatus(convId, finalStatus);
        const label = finalStatus === 'completed'
          ? 'Ejecución completada: pruebas aprobadas.'
          : (finalStatus === 'cancelled'
            ? 'Ejecución cancelada por el usuario.'
            : (finalStatus === 'baseline_failed'
              ? 'Prueba base fallida: el proyecto no pasa sus pruebas antes de cambios.'
              : (finalStatus === 'acceptance_manifest_changed'
                ? 'La definición de la prueba de aceptación cambió durante la ejecución.'
                : 'Ejecución fallida: revisa la ficha de evidencia.')));
        await conversations.appendMessage(convId, { role: 'orchestrator', text: label, runId: run.id }).catch(() => {});
      });

    res.json({ accepted: true });
  });

  app.post('/api/runs/:id/cancel', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.sendStatus(404);
    if (run.status !== 'running') return res.status(409).json({ error: 'La ejecución no está activa' });
    cancelRun(run);
    res.json({ accepted: true });
  });

  app.get('/api/runs/:id/events', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.sendStatus(404);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    for (const e of run.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    const unsubscribe = subscribe(run, e => res.write(`data: ${JSON.stringify(e)}\n\n`));
    req.on('close', unsubscribe);
  });

  return app;
}
