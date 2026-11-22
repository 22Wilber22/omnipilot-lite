import { spawn } from 'node:child_process';
import { platform } from 'node:os';

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (platform() !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    return;
  }

  const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  const killDirectChild = () => { if (!child.killed) child.kill(); };
  killer.once('error', killDirectChild);
  killer.once('close', code => { if (code !== 0) killDirectChild(); });
}

// Does not invoke a shell. Windows .cmd launchers require an explicit supported adapter.
export async function runProcess({ command, args = [], cwd, timeoutMs = 30000, signal, maxOutput = 200000 }) {
  if (!command || !Array.isArray(args) || args.some(x => typeof x !== 'string')) throw new Error('Invalid process arguments');
  const started = Date.now();
  let timedOut = false, cancelled = false, stopping = false, truncated = false, stdout = '', stderr = '';
  const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: platform() !== 'win32', windowsHide: true });
  const stop = reason => {
    if (stopping) return;
    stopping = true;
    timedOut = reason === 'timeout';
    cancelled = reason === 'cancel';
    terminateProcessTree(child);
  };
  const onAbort = () => stop('cancel');
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    const collect = (key, chunk) => {
      const value = chunk.toString('utf8');
      const remaining = maxOutput - (stdout.length + stderr.length);
      if (remaining <= 0) { truncated = true; return; }
      if (value.length > remaining) truncated = true;
      if (key === 'out') stdout += value.slice(0, remaining); else stderr += value.slice(0, remaining);
    };
    child.stdout.on('data', chunk => collect('out', chunk));
    child.stderr.on('data', chunk => collect('err', chunk));
    const result = await new Promise(resolve => {
      let error = null;
      child.on('error', e => { error = e; });
      child.on('close', (code, sig) => resolve({ code, signal: sig, error: error?.message ?? null }));
    });
    return { ...result, stdout, stderr, ms: Date.now() - started, timedOut, cancelled, truncated };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
