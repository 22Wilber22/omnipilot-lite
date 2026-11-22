import { describe, it, expect } from 'vitest';
import { createRun, publicRun } from '../src/orchestrator/orchestrator.js';
import { route } from '../src/orchestrator/router.js';
import { newMemory, memorySchema } from '../src/memory/store.js';
describe('orchestration safety', () => {
 it('rejects real mode until verified',()=>expect(()=>createRun('hello','real')).toThrow(/bloqueados/));
 it('creates fixed three-step plan',()=>expect(createRun('hello').plan).toHaveLength(3));
 it('routes review to Gemini',()=>expect(route('review').agent).toBe('gemini'));
 it('records fallback',()=>expect(route('review',{codex:true,gemini:false}).reason).toMatch(/Respaldo/));
 it('validates memory',()=>expect(memorySchema.parse(newMemory('hello')).goal).toBe('hello'));
 it('does not leak abort controller in response',()=>expect(publicRun(createRun('hello'))).not.toHaveProperty('controller'));
});
