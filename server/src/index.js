import express from 'express';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createRun, getRun, publicRun, startRun, cancelRun, subscribe } from './orchestrator/orchestrator.js';
import { codexConnector } from './connectors/codexConnector.js';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
const token = randomBytes(32).toString('hex');
const port = Number(process.env.PORT ?? 4317);
const allowedOrigins = new Set([`http://127.0.0.1:5173`, `http://localhost:5173`]);
app.use((req, res, next) => {
  const host = req.headers.host;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return res.status(403).json({ error: 'Host no autorizado' });
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origin no autorizado' });
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Omni-Token'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); return res.sendStatus(204); }
  next();
});
// Token is deliberately not exposed to the browser via a public bootstrap endpoint.
// The user enters the local one-time token printed in the server terminal.
app.use('/api', (req, res, next) => req.get('X-Omni-Token') === token ? next() : res.status(401).json({ error: 'Token requerido' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', mode: 'demo', realConnectors: 'disabled' }));
app.get('/api/diagnostics/codex', async (_req, res) => {
  const status = await codexConnector.isAvailable();
  res.json({ provider: 'codex', ...status });
});
app.post('/api/runs', (req, res) => { try { const run = createRun(req.body?.goal, req.body?.mode); res.status(201).json(publicRun(run)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/runs/:id', (req, res) => { const run = getRun(req.params.id); return run ? res.json(publicRun(run)) : res.sendStatus(404); });
app.post('/api/runs/:id/approve', (req, res) => { const run = getRun(req.params.id); if (!run) return res.sendStatus(404); if (run.status !== 'pending') return res.status(409).json({ error: 'Estado inválido' }); startRun(run, resolve('workspaces')).catch(e => console.error('Run failure:', e.message)); res.json({ accepted: true }); });
app.post('/api/runs/:id/cancel', (req, res) => { const run = getRun(req.params.id); if (!run) return res.sendStatus(404); cancelRun(run); res.json({ accepted: true }); });
app.get('/api/runs/:id/events', (req, res) => {
  const run = getRun(req.params.id); if (!run) return res.sendStatus(404);
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Accel-Buffering', 'no');
  for (const e of run.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  const unsubscribe = subscribe(run, e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  req.on('close', unsubscribe);
});
app.listen(port, '127.0.0.1', () => {
 console.log(`OmniPilot API http://127.0.0.1:${port}`);
 console.log(`TOKEN LOCAL (no compartir): ${token}`);
 console.log('MODO DEMO: los agentes Codex/Gemini NO se ejecutan todavía.');
});
