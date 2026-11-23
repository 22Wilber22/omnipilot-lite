import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initGitWorkspace,
  commitBaseline,
  captureGitPatch,
  getGitStatus,
  resolveSafeWorkspacePath,
} from '../src/security/workspaceGuard.js';
import { AGENT_REGISTRY, canAgentRun, routePhase } from '../src/orchestrator/router.js';

let tempDirs = [];
async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'omnipilot-e2e-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('Hotfix E2E — Baseline Git con node_modules y router por capacidades', () => {
  it('maneja node_modules/.bin symlinks y .gitignore sin romper baseline ni patch, excluyendo node_modules', async () => {
    const root = await makeTempDir();
    const ws = join(root, 'ws');
    await mkdir(ws, { recursive: true });
    await writeFile(join(ws, '.gitignore'), 'node_modules/\n', 'utf8');
    await writeFile(join(ws, 'app.js'), 'export const v = 1;\n', 'utf8');
    await mkdir(join(ws, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(ws, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(ws, 'node_modules', 'pkg', 'cli.js'), '#!/usr/bin/env node\n', 'utf8');
    await symlink('../pkg/cli.js', join(ws, 'node_modules', '.bin', 'pkg'));

    await resolveSafeWorkspacePath(root, 'ws');
    await initGitWorkspace(ws);
    await commitBaseline(ws);

    // Simulate Codex editing app.js AND touching node_modules
    await writeFile(join(ws, 'app.js'), 'export const v = 2;\n', 'utf8');
    await writeFile(join(ws, 'node_modules', 'pkg', 'extra.js'), 'ignored\n', 'utf8');

    const status = await getGitStatus(ws);
    expect(status.files).toEqual(['app.js']);

    const patch = await captureGitPatch(ws);
    expect(patch).toContain('app.js');
    expect(patch).not.toContain('node_modules');
  });

  it('elige Antigravity para review cuando está disponible y hace fallback a Codex read-only si no', () => {
    const withAgy = routePhase({ phase: 'review', availability: { codex: true, antigravity: true } });
    expect(withAgy.provider).toBe('Antigravity');
    expect(withAgy.permission).toBe('read-only');
    expect(withAgy.fallbackReason).toBeNull();

    const withoutAgy = routePhase({ phase: 'review', availability: { codex: true, antigravity: false } });
    expect(withoutAgy.provider).toBe('Codex');
    expect(withoutAgy.permission).toBe('read-only');
    expect(withoutAgy.fallbackReason).toMatch(/Antigravity no disponible/i);
  });

  it('elige Codex para implementación solo por capability code-write y nunca otorga workspace-write a Antigravity', () => {
    expect(AGENT_REGISTRY.antigravity.capabilities).not.toContain('code-write');
    expect(canAgentRun('antigravity', 'code-write', 'workspace-write')).toBe(false);

    const impl = routePhase({
      phase: 'implement',
      availability: { codex: true, antigravity: true },
      recommendation: { agent: 'antigravity', permission: 'workspace-write' },
    });
    expect(impl.provider).toBe('Codex');
    expect(impl.permission).toBe('workspace-write');
    expect(impl.reason).toContain('único agente validado para escritura');
  });
});
