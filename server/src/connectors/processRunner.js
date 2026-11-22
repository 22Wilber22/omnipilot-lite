import { spawn } from 'node:child_process';
import { platform } from 'node:os';

// Does not invoke a shell. Windows .cmd launchers require an explicit supported adapter.
export async function runProcess({ command, args = [], cwd, timeoutMs = 30000, signal, maxOutput = 200000 }) {
  if (!command || !Array.isArray(args) || args.some(x => typeof x !== 'string')) throw new Error('Invalid process arguments');
  const started = Date.now();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false, truncated = false, stdout = '', stderr = '';
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  let child;
  try {
    child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], signal: controller.signal, detached: platform() !== 'win32', windowsHide: true });
    const collect = (key, chunk) => {
      const value = chunk.toString('utf8');
      const remaining = maxOutput - (stdout.length + stderr.length);
      if (remaining <= 0) { truncated = true; return; }
      if (value.length > remaining) truncated = true;
      if (key === 'out') stdout += value.slice(0, remaining); else stderr += value.slice(0, remaining);
    };
    child.stdout.on('data', chunk => collect('out', chunk));
    child.stderr.on('data', chunk => collect('err', chunk));
    // Kill Unix process group, not just direct child. Windows tree termination is not yet verified.
    const killGroup = () => { if (platform() !== 'win32' && child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
    controller.signal.addEventListener('abort', killGroup, { once: true });
    const result = await new Promise(resolve => {
      let error = null;
      child.on('error', e => { error = e; });
      child.on('close', (code, sig) => resolve({ code, signal: sig, error: error?.message ?? null }));
    });
    return { ...result, stdout, stderr, ms: Date.now() - started, timedOut, cancelled: controller.signal.aborted && !timedOut, truncated };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
