import { runProcess } from './processRunner.js';
import { extractUsageFromEvents } from '../metrics/usageTracker.js';

const ALLOWED_SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const DEFAULT_SANDBOX = 'read-only';
const DEFAULT_AVAILABLE_TIMEOUT_MS = 5000;
const DEFAULT_RUN_TIMEOUT_MS = 60000;

function parseJsonLines(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON lines; raw stdout remains available in the result.
    }
  }
  return events;
}

function extractOutput(events, stdout) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const item = events[i];
    if (typeof item?.text === 'string' && item.text.trim()) return item.text.trim();
    if (typeof item?.message === 'string' && item.message.trim()) return item.message.trim();
    if (typeof item?.item?.text === 'string' && item.item.text.trim()) return item.item.text.trim();
  }
  return stdout.trim();
}

export function buildCodexArgs({ workspace, sandbox = DEFAULT_SANDBOX, prompt }) {
  if (typeof workspace !== 'string' || !workspace.trim()) throw new Error('Workspace requerido');
  if (!ALLOWED_SANDBOX_MODES.has(sandbox)) throw new Error('Modo sandbox inválido');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt requerido');
  return [
    '--ask-for-approval', 'never',
    'exec',
    '--cd', workspace.trim(),
    '--sandbox', sandbox,
    '--ephemeral',
    '--json',
    prompt.trim(),
  ];
}

export function createCodexConnector({ command = 'codex', runner = runProcess } = {}) {
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

    async run(task, context = {}) {
      const prompt = typeof task === 'string' ? task : task?.prompt;
      const {
        workspace,
        sandbox = DEFAULT_SANDBOX,
        timeoutMs = DEFAULT_RUN_TIMEOUT_MS,
        signal,
        maxOutput = 200000,
      } = context;
      const args = buildCodexArgs({ workspace, sandbox, prompt });
      const result = await runner({ command, args, cwd: workspace.trim(), timeoutMs, signal, maxOutput });
      const events = parseJsonLines(result.stdout);
      const usage = extractUsageFromEvents(events);
      const ok = result.code === 0 && !result.error && !result.timedOut && !result.cancelled;
      return {
        ok,
        code: result.code,
        output: extractOutput(events, result.stdout),
        events,
        usage,
        stdout: result.stdout,
        stderr: result.stderr,
        ms: result.ms,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        truncated: result.truncated,
        error: result.error,
      };
    },
  };
}

export const codexConnector = createCodexConnector();
