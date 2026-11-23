import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'orchestrator', 'system']),
  type: z.enum(['chat', 'plan-conceptual', 'needs-project', 'tarea', 'actividad']).optional().default('chat'),
  text: z.string(),
  createdAt: z.string(),
  runId: z.string().optional(),
});

export const projectConfigSchema = z.object({
  sourceType: z.enum(['template', 'local-project']),
  projectPath: z.string().optional(),
  projectName: z.string(),
  acceptanceScript: z.string(),
  targetScope: z.string().optional(),
  updatedAt: z.string(),
});

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  projectConfig: projectConfigSchema.nullable().default(null),
  messages: z.array(messageSchema),
  runIds: z.array(z.string()),
});

const indexEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  status: z.enum(['no_plan', 'plan_pending', 'running', 'completed', 'failed', 'cancelled']).default('no_plan'),
});

const indexSchema = z.array(indexEntrySchema);

async function atomicWriteJson(filePath, data) {
  const temp = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(temp, filePath);
}

export function createConversationStore(baseDir) {
  const indexPath = join(baseDir, 'index.json');

  async function ensureDir() {
    await mkdir(baseDir, { recursive: true });
  }

  function convPath(id) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('ID de conversación inválido');
    return join(baseDir, `${id}.json`);
  }

  async function readIndex() {
    try {
      const raw = await readFile(indexPath, 'utf8');
      return indexSchema.parse(JSON.parse(raw));
    } catch (e) {
      if (e?.code === 'ENOENT') return [];
      throw e;
    }
  }

  async function writeIndex(entries) {
    await ensureDir();
    const sorted = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await atomicWriteJson(indexPath, indexSchema.parse(sorted));
  }

  async function upsertIndex(entry) {
    const list = await readIndex();
    const filtered = list.filter(item => item.id !== entry.id);
    filtered.unshift(entry);
    await writeIndex(filtered);
  }

  return {
    async list() {
      return readIndex();
    },

    async create({ title = 'Nueva tarea', projectConfig = null } = {}) {
      await ensureDir();
      const now = new Date().toISOString();
      const conv = conversationSchema.parse({
        id: randomUUID(),
        title: String(title).trim().slice(0, 80) || 'Nueva tarea',
        createdAt: now,
        updatedAt: now,
        projectConfig: projectConfig ? projectConfigSchema.parse(projectConfig) : null,
        messages: [],
        runIds: [],
      });
      await atomicWriteJson(convPath(conv.id), conv);
      await upsertIndex({ id: conv.id, title: conv.title, updatedAt: conv.updatedAt, status: 'no_plan' });
      return conv;
    },

    async setProjectConfig(id, config) {
      const conv = await this.get(id);
      if (!conv) return null;
      const validated = projectConfigSchema.parse({ ...config, updatedAt: new Date().toISOString() });
      conv.projectConfig = validated;
      conv.updatedAt = validated.updatedAt;
      await atomicWriteJson(convPath(conv.id), conv);
      const list = await readIndex();
      const existing = list.find(x => x.id === conv.id);
      await upsertIndex({
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        status: existing?.status ?? 'no_plan',
      });
      return conv;
    },

    async get(id) {
      try {
        const raw = await readFile(convPath(id), 'utf8');
        return conversationSchema.parse(JSON.parse(raw));
      } catch (e) {
        if (e?.code === 'ENOENT') return null;
        throw e;
      }
    },

    async appendMessage(id, { role, type = 'chat', text, runId }) {
      const conv = await this.get(id);
      if (!conv) return null;
      const now = new Date().toISOString();
      const msg = messageSchema.parse({
        id: randomUUID(),
        role,
        type,
        text: String(text).slice(0, 2000),
        createdAt: now,
        ...(runId ? { runId } : {}),
      });
      conv.messages.push(msg);
      if (role === 'user' && conv.title === 'Nueva tarea') {
        conv.title = msg.text.trim().slice(0, 60) || 'Nueva tarea';
      }
      conv.updatedAt = now;
      await atomicWriteJson(convPath(conv.id), conv);

      const list = await readIndex();
      const existing = list.find(x => x.id === conv.id);
      await upsertIndex({
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        status: existing?.status ?? 'no_plan',
      });
      return { conversation: conv, message: msg };
    },

    async attachRun(id, runId, status = 'plan_pending') {
      const conv = await this.get(id);
      if (!conv) return null;
      if (!conv.runIds.includes(runId)) conv.runIds.push(runId);
      conv.updatedAt = new Date().toISOString();
      await atomicWriteJson(convPath(conv.id), conv);
      await upsertIndex({ id: conv.id, title: conv.title, updatedAt: conv.updatedAt, status });
      return conv;
    },

    async updateStatus(id, status) {
      const list = await readIndex();
      const existing = list.find(x => x.id === id);
      if (!existing) return;
      await upsertIndex({ ...existing, updatedAt: new Date().toISOString(), status });
    },
  };
}
