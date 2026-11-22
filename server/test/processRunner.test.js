import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../src/connectors/processRunner.js';
it('captures output without shell',async()=>{const r=await runProcess({command:process.execPath,args:['-e','console.log("OK")']});expect(r.code).toBe(0);expect(r.stdout.trim()).toBe('OK')});
it('times out',async()=>{const r=await runProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:150});expect(r.timedOut).toBe(true)});
it('limits output',async()=>{const r=await runProcess({command:process.execPath,args:['-e','console.log("x".repeat(1000))'],maxOutput:50});expect(r.truncated).toBe(true);expect(r.stdout.length).toBeLessThanOrEqual(50)});
it('cancels running process via AbortController',async()=>{const ac=new AbortController();setTimeout(()=>ac.abort(),80);const r=await runProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:5000,signal:ac.signal});expect(r.cancelled).toBe(true);expect(r.timedOut).toBe(false)});
it('cancels the complete process tree', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'omnipilot-process-tree-'));
  const pidFile = join(tempDir, 'child.pid');
  const parentScript = `
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    writeFileSync(process.argv[1], String(child.pid));
    setInterval(() => {}, 1000);
  `;
  const controller = new AbortController();
  const running = runProcess({
    command: process.execPath,
    args: ['-e', parentScript, pidFile],
    timeoutMs: 5000,
    signal: controller.signal,
  });
  let childPid = 0;
  for (let attempt = 0; attempt < 40 && !childPid; attempt += 1) {
    try { childPid = Number(await readFile(pidFile, 'utf8')); } catch {}
    if (!childPid) await new Promise(resolve => setTimeout(resolve, 25));
  }
  controller.abort();
  const result = await running;

  expect(result.cancelled).toBe(true);
  expect(childPid).toBeGreaterThan(0);
  expect(() => process.kill(childPid, 0)).toThrow();
  await rm(tempDir, { recursive: true, force: true });
});
