import express from 'express';
import { resolve } from 'node:path';
import { createRun, getRun, publicRun, startRun, cancelRun, subscribe, markApproved } from '../orchestrator/orchestrator.js';
import { codexConnector } from '../connectors/codexConnector.js';
import { antigravityConnector } from '../connectors/antigravityConnector.js';

export function createApp({
  token,
  port = Number(process.env.PORT ?? 4317),
  workspacesDir = resolve('workspaces'),
  codex = codexConnector,
  antigravity = antigravityConnector,
  antigravityValidated = true,
  runner,
} = {}) {
  if (!token) throw new Error('Token local requerido');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

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

  app.post('/api/runs', (req, res) => {
    try {
      const run = createRun(req.body?.goal, req.body?.mode, req.body?.acceptance);
      res.status(201).json(publicRun(run));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = getRun(req.params.id);
    return run ? res.json(publicRun(run)) : res.sendStatus(404);
  });

  app.post('/api/runs/:id/approve', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.sendStatus(404);
    if (run.status !== 'pending') return res.status(409).json({ error: 'Estado inválido' });
    markApproved(run);
    startRun(run, workspacesDir, { codex, antigravity, antigravityValidated, runner })
      .catch(e => console.error('Run failure:', e.message));
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
