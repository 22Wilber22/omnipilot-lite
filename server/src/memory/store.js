import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const planStepSchema = z.object({
  id: z.number(),
  role: z.string(),
  agent: z.string(),
  title: z.string(),
});

const stepSchema = z.object({
  id: z.number(),
  agent: z.string(),
  status: z.string(),
  summary: z.string(),
  ms: z.number(),
  files: z.array(z.string()).default([]),
});

const sourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('template') }),
  z.object({
    type: z.literal('local-project'),
    projectPath: z.string(),
    acceptanceScript: z.string(),
  }),
]);

export const memorySchema = z.object({
  goal: z.string(),
  plan: z.array(planStepSchema).default([]),
  acceptance: z.string().default(''),
  source: sourceSchema.default({ type: 'template' }),
  decisions: z.array(z.string()).default([]),
  steps: z.array(stepSchema),
  problems: z.array(z.string()),
  updatedAt: z.string(),
});

export function newMemory(goal, { plan = [], acceptance = '', source = { type: 'template' } } = {}) {
  return {
    goal,
    plan,
    acceptance,
    source,
    decisions: [],
    steps: [],
    problems: [],
    updatedAt: new Date().toISOString(),
  };
}

export function buildBoundedContext(memory, modifiedFiles = []) {
  const recentSummaries = memory.steps.slice(-2).map(s => ({
    step: s.id,
    agent: s.agent,
    status: s.status,
    summary: String(s.summary).slice(0, 400),
  }));
  return {
    goal: memory.goal,
    acceptance: memory.acceptance,
    source: memory.source,
    recentSummaries,
    modifiedFiles: [...modifiedFiles],
  };
}

export async function writeMemory(dir, data) {
  const validated = memorySchema.parse({ ...data, updatedAt: new Date().toISOString() });
  await mkdir(dir, { recursive: true });
  const target = join(dir, 'proyecto.json');
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(validated, null, 2), { mode: 0o600 });
  await rename(temp, target);
}

export async function readMemory(dir) {
  const raw = await readFile(join(dir, 'proyecto.json'), 'utf8');
  return memorySchema.parse(JSON.parse(raw));
}
