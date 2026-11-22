import express from 'express';
import { resolve } from 'node:path';
import { createRun, getRun, publicRun, startRun, cancelRun, subscribe, markApproved } from '../orchestrator/orchestrator.js';
import { codexConnector } from '../connectors/codexConnector.js';
import { antigravityConnector } from '../connectors/antigravityConnector.js';
import { createConversationStore } from '../memory/conversationStore.js';
import { classifyMessage } from '../orchestrator/messageClassifier.js';
import { inspectLocalProject, validateLocalProjectSource } from '../projects/localProjects.js';

export function createApp({
  token,
  port = Number(process.env.PORT ?? 4317),
  workspacesDir = resolve('workspaces'),
  projectsRoot = process.env.PROJECTS_ROOT,
  conversationsDir = resolve('data', 'conversations'),
  codex = codexConnector,
  antigravity = antigravityConnector,
  antigravityValidated = true,
  runner,
} = {}) {
  if (!token) throw new Error('Token local requerido');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const conversations = createConversationStore(conversationsDir);
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
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

  app.post('/api/conversations', async (_req, res) => {
    try {
      const conv = await conversations.create();
      res.status(201).json(conv);
    } catch (e) {
      res.status(500).json({ error: e.message });
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

    const { message: userMessage } = await conversations.appendMessage(conv.id, { role: 'user', text });
    const kind = classifyMessage(text);

    if (kind === 'greeting') {
      const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
        role: 'orchestrator',
        text: '¡Hola! Describe el cambio que quieres realizar y prepararé un plan antes de ejecutar.',
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

    // Code task: create deterministic pending plan without executing agents
    const run = createRun(text, mode);
    runToConversation.set(run.id, conv.id);
    await conversations.attachRun(conv.id, run.id, 'plan_pending');
    const { conversation, message: reply } = await conversations.appendMessage(conv.id, {
      role: 'orchestrator',
      text: 'Preparé un plan para esta tarea. Revísalo y pulsa Aprobar y ejecutar.',
      runId: run.id,
    });
    return res.status(201).json({ conversation, userMessage, reply, run: publicRun(run) });
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
      const run = createRun(req.body?.goal, req.body?.mode, source);
      res.status(201).json(publicRun(run));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = getRun(req.params.id);
    return run ? res.json(publicRun(run)) : res.sendStatus(404);
  });

  app.post('/api/runs/:id/approve', async (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.sendStatus(404);
    if (run.status !== 'pending') return res.status(409).json({ error: 'Estado inválido' });
    markApproved(run);
    const convId = runToConversation.get(run.id);
    if (convId) await conversations.updateStatus(convId, 'running');

    startRun(run, workspacesDir, { codex, antigravity, antigravityValidated, runner, projectsRoot })
      .catch(e => console.error('Run failure:', e.message))
      .finally(async () => {
        if (!convId) return;
        const finalStatus = ['completed', 'failed', 'cancelled'].includes(run.status) ? run.status : 'failed';
        await conversations.updateStatus(convId, finalStatus);
        const label = finalStatus === 'completed'
          ? 'Ejecución completada: pruebas aprobadas.'
          : (finalStatus === 'cancelled' ? 'Ejecución cancelada por el usuario.' : 'Ejecución fallida: revisa la ficha de evidencia.');
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
