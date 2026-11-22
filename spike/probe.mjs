// Probe ONLY with commands and arguments verified in docs/SPIKE.md.
// Usage: node spike/probe.mjs <executable> [arguments...]
// Does not invoke a shell, read credentials or store stdout on disk.
import { spawn } from 'node:child_process';
const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd.startsWith('-')) { console.error('Usage: node spike/probe.mjs <executable> [args...]'); process.exit(2); }
const MAX_BYTES = 200_000;
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 60_000);
const controller = new AbortController();
const start = Date.now();
let stdout = '', stderr = '', stdoutBytes = 0, stderrBytes = 0;
let timedOut = false, settled = false;
const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
const child = spawn(cmd, args, { shell: false, signal: controller.signal, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
function collect(current, chunk, count) {
  const remaining = Math.max(0, MAX_BYTES - count);
  return [current + chunk.subarray(0, remaining).toString('utf8'), count + chunk.length];
}
child.stdout?.on('data', chunk => { [stdout, stdoutBytes] = collect(stdout, chunk, stdoutBytes); });
child.stderr?.on('data', chunk => { [stderr, stderrBytes] = collect(stderr, chunk, stderrBytes); });
function finish(code, signal, error) {
  if (settled) return;
  settled = true; clearTimeout(timer);
  // Probe outputs are truncated, not redacted. Never pass secrets in arguments.
  console.log(JSON.stringify({ code, signal, error, timedOut, ms: Date.now() - start, stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 500), outputTruncated: stdoutBytes > MAX_BYTES || stderrBytes > MAX_BYTES }, null, 2));
  if (error || timedOut || code !== 0) process.exitCode = 1;
}
child.on('error', e => finish(null, null, e.code ?? e.message));
child.on('close', (code, signal) => finish(code, signal, null));
process.on('SIGINT', () => controller.abort());
