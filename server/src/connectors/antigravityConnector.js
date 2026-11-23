import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runProcess } from './processRunner.js';
import { extractUsageFromObject } from '../metrics/usageTracker.js';

function resolveDefaultAgyCommand() {
  const localBin = join(homedir(), '.local', 'bin', 'agy');
  return existsSync(localBin) ? localBin : 'agy';
}

const DEFAULT_AVAILABLE_TIMEOUT_MS = 5000;
const DEFAULT_RUN_TIMEOUT_MS = 65000;
const PRINT_TIMEOUT_FLAG = '60s';

const agyResponseSchema = z.object({
  conversation_id: z.string().optional(),
  status: z.string(),
  response: z.string().optional().default(''),
  duration_seconds: z.number().optional(),
  usage: z.record(z.unknown()).optional(),
});

export function buildAntigravityArgs({ prompt, effort, model, mode = 'plan' } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt requerido');
  const safeMode = mode === 'accept-edits' ? 'accept-edits' : 'plan';
  const args = [
    '--prompt', prompt.trim(),
    '--output-format', 'json',
    '--mode', safeMode,
    '--sandbox',
  ];
  if (effort === 'low') args.push('--effort', 'low');
  if (typeof model === 'string' && /^[a-zA-Z0-9._:/-]+$/.test(model.trim())) {
    args.push('--model', model.trim());
  }
  args.push('--print-timeout', PRINT_TIMEOUT_FLAG);
  return args;
}

function parseModelList(stdout) {
  const models = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const clean = line.trim().replace(/^[-*•]\s+/, '');
    if (!clean || /^available|^models|^name\b|^---/i.test(clean)) continue;
    const token = clean.split(/\s+/)[0];
    if (/^[a-zA-Z0-9._:/-]{3,80}$/.test(token) && !models.includes(token)) {
      models.push(token);
    }
  }
  return models;
}

function parseAntigravityOutput(stdout) {
  let parsedJson;
  try {
    parsedJson = JSON.parse(stdout.trim());
  } catch {
    return { parsed: null, parseError: 'Respuesta JSON inválida de Antigravity CLI' };
  }
  const checked = agyResponseSchema.safeParse(parsedJson);
  if (!checked.success) {
    return { parsed: null, parseError: 'Esquema de respuesta inválido de Antigravity CLI' };
  }
  return { parsed: checked.data, parseError: null };
}

export function createAntigravityConnector({ command = 'agy', runner = runProcess } = {}) {
  return {
    async isAvailable({ timeoutMs = DEFAULT_AVAILABLE_TIMEOUT_MS, signal } = {}) {
      const result = await runner({ command, args: ['--version'], timeoutMs, signal, maxOutput: 4096 });
      const available = result.code === 0 && !result.error && !result.timedOut && !result.cancelled;
      return {
        available,
        version: available ? result.stdout.trim() || null : null,
        error: available ? null : (result.error || result.stderr.trim() || `Exit ${result.code}`),
      };
    },

    async listModels({ timeoutMs = DEFAULT_AVAILABLE_TIMEOUT_MS, signal } = {}) {
      const result = await runner({ command, args: ['models'], timeoutMs, signal, maxOutput: 16384 });
      if (result.code !== 0 || result.error || result.timedOut || result.cancelled) return [];
      return parseModelList(result.stdout);
    },

    async run(task, context = {}) {
      const prompt = typeof task === 'string' ? task : task?.prompt;
      const {
        workspace,
        effort,
        model,
        mode = 'plan',
        timeoutMs = DEFAULT_RUN_TIMEOUT_MS,
        signal,
        maxOutput = 200000,
      } = context;
      if (typeof workspace !== 'string' || !workspace.trim()) throw new Error('Workspace requerido');
      const args = buildAntigravityArgs({ prompt, effort, model, mode });
      const result = await runner({ command, args, cwd: workspace.trim(), timeoutMs, signal, maxOutput });

      if (result.timedOut || result.cancelled || result.error || result.code !== 0) {
        return {
          ok: false,
          code: result.code,
          status: null,
          untrustedResponse: '',
          conversationId: null,
          durationSeconds: null,
          stdout: result.stdout,
          stderr: result.stderr,
          ms: result.ms,
          timedOut: result.timedOut,
          cancelled: result.cancelled,
          truncated: result.truncated,
          error: result.error || result.stderr.trim() || `Exit ${result.code}`,
        };
      }

      const { parsed, parseError } = parseAntigravityOutput(result.stdout);
      if (parseError) {
        return {
          ok: false,
          code: result.code,
          status: null,
          untrustedResponse: '',
          conversationId: null,
          durationSeconds: null,
          stdout: result.stdout,
          stderr: result.stderr,
          ms: result.ms,
          timedOut: false,
          cancelled: false,
          truncated: result.truncated,
          error: parseError,
        };
      }

      const ok = parsed.status === 'SUCCESS';
      const usage = extractUsageFromObject(parsed);
      return {
        ok,
        code: result.code,
        status: parsed.status,
        untrustedResponse: parsed.response,
        conversationId: parsed.conversation_id ?? null,
        durationSeconds: parsed.duration_seconds ?? null,
        usage,
        stdout: result.stdout,
        stderr: result.stderr,
        ms: result.ms,
        timedOut: false,
        cancelled: false,
        truncated: result.truncated,
        error: ok ? null : `Estado no exitoso: ${parsed.status}`,
      };
    },
  };
}

export const antigravityConnector = createAntigravityConnector({ command: resolveDefaultAgyCommand() });
