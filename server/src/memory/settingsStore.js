import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_BUDGETS } from '../metrics/usageTracker.js';

const providerSettingsSchema = z.object({
  enabled: z.boolean(),
  usdPer1kTokens: z.number().finite().min(0).max(1000),
  tokenBudget: z.number().int().positive().max(1_000_000),
}).strict();

const providerPatchSchema = z.object({
  enabled: z.boolean().optional(),
  usdPer1kTokens: z.number().finite().min(0).max(1000).optional(),
  tokenBudget: z.number().int().positive().max(1_000_000).optional(),
}).strict();

const DEFAULT_PROVIDERS = Object.freeze({
  codex: Object.freeze({ enabled: true, usdPer1kTokens: 0, tokenBudget: DEFAULT_BUDGETS.codex }),
  antigravity: Object.freeze({ enabled: true, usdPer1kTokens: 0, tokenBudget: DEFAULT_BUDGETS.antigravity }),
});

export const settingsSchema = z.object({
  chatProvider: z.enum(['auto', 'antigravity', 'codex']).default('auto'),
  chatModel: z.string().max(120).nullable().default(null),
  chatStyle: z.enum(['fast', 'detailed']).default('fast'),
  providers: z.object({
    codex: providerSettingsSchema.default({ ...DEFAULT_PROVIDERS.codex }),
    antigravity: providerSettingsSchema.default({ ...DEFAULT_PROVIDERS.antigravity }),
  }).strict().default({
    codex: { ...DEFAULT_PROVIDERS.codex },
    antigravity: { ...DEFAULT_PROVIDERS.antigravity },
  }),
  runBudgetUsd: z.number().finite().gt(0).lte(100).nullable().default(null),
  updatedAt: z.string().optional(),
}).strict();

const settingsPatchSchema = z.object({
  chatProvider: z.enum(['auto', 'antigravity', 'codex']).optional(),
  chatModel: z.string().max(120).nullable().optional(),
  chatStyle: z.enum(['fast', 'detailed']).optional(),
  providers: z.object({
    codex: providerPatchSchema.optional(),
    antigravity: providerPatchSchema.optional(),
  }).strict().optional(),
  runBudgetUsd: z.number().finite().gt(0).lte(100).nullable().optional(),
}).strict();

export const DEFAULT_SETTINGS = Object.freeze({
  chatProvider: 'auto',
  chatModel: null,
  chatStyle: 'fast',
  providers: {
    codex: { ...DEFAULT_PROVIDERS.codex },
    antigravity: { ...DEFAULT_PROVIDERS.antigravity },
  },
  runBudgetUsd: null,
});

export function createSettingsStore(filePath) {
  return {
    async get() {
      try {
        const raw = await readFile(filePath, 'utf8');
        return settingsSchema.parse(JSON.parse(raw));
      } catch (e) {
        if (e?.code === 'ENOENT') return settingsSchema.parse({});
        throw e;
      }
    },

    async update(patch) {
      const validatedPatch = settingsPatchSchema.parse(patch ?? {});
      const current = await this.get();
      const next = settingsSchema.parse({
        ...current,
        ...validatedPatch,
        providers: {
          codex: { ...current.providers.codex, ...(validatedPatch.providers?.codex ?? {}) },
          antigravity: { ...current.providers.antigravity, ...(validatedPatch.providers?.antigravity ?? {}) },
        },
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
