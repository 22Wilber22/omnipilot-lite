import { it, expect } from 'vitest';
import { runProcess } from '../src/connectors/processRunner.js';
it('captures output without shell',async()=>{const r=await runProcess({command:process.execPath,args:['-e','console.log("OK")']});expect(r.code).toBe(0);expect(r.stdout.trim()).toBe('OK')});
it('times out',async()=>{const r=await runProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:150});expect(r.timedOut).toBe(true)});
it('limits output',async()=>{const r=await runProcess({command:process.execPath,args:['-e','console.log("x".repeat(1000))'],maxOutput:50});expect(r.truncated).toBe(true);expect(r.stdout.length).toBeLessThanOrEqual(50)});
it('cancels running process via AbortController',async()=>{const ac=new AbortController();setTimeout(()=>ac.abort(),80);const r=await runProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:5000,signal:ac.signal});expect(r.cancelled).toBe(true);expect(r.timedOut).toBe(false)});
