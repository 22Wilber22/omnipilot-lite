import { it, expect } from 'vitest';
import { runProcess } from '../src/connectors/processRunner.js';
it('captures output without shell',async()=>{const r=await runProcess({command:process.execPath,args:['-e','console.log("OK")']});expect(r.code).toBe(0);expect(r.stdout.trim()).toBe('OK')});
it('times out',async()=>{const r=await runProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:150});expect(r.timedOut).toBe(true)});
it('limits output',async()=>{const r=await runProcess({command:process.execPath,args:['-e','console.log("x".repeat(1000))'],maxOutput:50});expect(r.truncated).toBe(true);expect(r.stdout.length).toBeLessThanOrEqual(50)});
it('cancels running process via AbortController',async()=>{const ac=new AbortController();setTimeout(()=>ac.abort(),80);const r=await runProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:5000,signal:ac.signal});expect(r.cancelled).toBe(true);expect(r.timedOut).toBe(false)});
it('cancels the complete process tree', async () => {
  const parentScript = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(child.pid);
    setInterval(() => {}, 1000);
  `;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const result = await runProcess({
    command: process.execPath,
    args: ['-e', parentScript],
    timeoutMs: 5000,
    signal: controller.signal,
  });
  const childPid = Number(result.stdout.trim());

  expect(result.cancelled).toBe(true);
  expect(childPid).toBeGreaterThan(0);
  expect(() => process.kill(childPid, 0)).toThrow();
});
