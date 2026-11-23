import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const settingsSchema = z.object({
  chatProvider: z.enum(['auto', 'antigravity', 'codex']).default('auto'),
  chatModel: z.string().max(120).nullable().default(null),
  chatStyle: z.enum(['fast', 'detailed']).default('fast'),
  updatedAt: z.string().optional(),
});

export const DEFAULT_SETTINGS = Object.freeze({
  chatProvider: 'auto',
  chatModel: null,
  chatStyle: 'fast',
});

export function createSettingsStore(filePath) {
  return {
    async get() {
      try {
        const raw = await readFile(filePath, 'utf8');
        return settingsSchema.parse(JSON.parse(raw));
      } catch (e) {
        if (e?.code === 'ENOENT') return { ...DEFAULT_SETTINGS };
        throw e;
      }
    },

    async update(patch) {
      const current = await this.get();
      const next = settingsSchema.parse({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      await mkdir(dirname(filePath), { recursive: true });
      const temp = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temp, filePath);
      return next;
    },
  };
}
