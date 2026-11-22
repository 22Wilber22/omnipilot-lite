import { describe, it, expect } from 'vitest';
import { buildAntigravityArgs, createAntigravityConnector } from '../src/connectors/antigravityConnector.js';
import { getConnector, listConnectors } from '../src/connectors/registry.js';
import { runProcess } from '../src/connectors/processRunner.js';

describe('antigravityConnector (fake processes)', () => {
  it('builds exact verified Antigravity CLI arguments without --cd or unsafe flags', () => {
    const args = buildAntigravityArgs({ prompt: 'Responde únicamente OMNIPILOT_OK.' });
    expect(args).toEqual([
      '--prompt', 'Responde únicamente OMNIPILOT_OK.',
      '--output-format', 'json',
      '--mode', 'plan',
      '--sandbox',
      '--print-timeout', '60s',
    ]);
    expect(args).not.toContain('--cd');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('is registered in connectorRegistry alongside codex', () => {
    expect(listConnectors()).toEqual(['codex', 'antigravity']);
    expect(typeof getConnector('antigravity').isAvailable).toBe('function');
    expect(typeof getConnector('antigravity').run).toBe('function');
  });

  it('detects availability via agy --version with a fake process', async () => {
    const fakeRunner = ({ args }) => runProcess({
      command: process.execPath,
      args: ['-e', `console.log("agy 1.5.14 " + ${JSON.stringify(args.join(' '))})`],
    });
    const connector = createAntigravityConnector({ runner: fakeRunner });
    const status = await connector.isAvailable();
    expect(status.available).toBe(true);
    expect(status.version).toContain('agy 1.5.14 --version');
    expect(status.error).toBeNull();
  });

  it('reports unavailable when binary does not exist', async () => {
    const connector = createAntigravityConnector({ command: 'nonexistent-agy-binary-xyz' });
    const status = await connector.isAvailable();
    expect(status.available).toBe(false);
    expect(status.version).toBeNull();
    expect(status.error).toBeTruthy();
  });

  it('parses SUCCESS JSON response and passes cwd as workspace', async () => {
    let captured;
    const payload = JSON.stringify({
      conversation_id: 'conv-123',
      status: 'SUCCESS',
      response: 'OMNIPILOT_OK\n',
      duration_seconds: 6.68,
    });
    const fakeRunner = (opts) => {
      captured = opts;
      return runProcess({
        command: process.execPath,
        args: ['-e', `console.log(${JSON.stringify(payload)})`],
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        maxOutput: opts.maxOutput,
      });
    };
    const connector = createAntigravityConnector({ runner: fakeRunner });
    const res = await connector.run('Responde únicamente OMNIPILOT_OK.', { workspace: process.cwd() });

    expect(res.ok).toBe(true);
    expect(res.status).toBe('SUCCESS');
    expect(res.untrustedResponse).toBe('OMNIPILOT_OK\n');
    expect(res.conversationId).toBe('conv-123');
    expect(res.durationSeconds).toBe(6.68);
    expect(captured.cwd).toBe(process.cwd());
    expect(captured.command).toBe('agy');
  });

  it('rejects invalid JSON output safely', async () => {
    const fakeRunner = (opts) => runProcess({
      command: process.execPath,
      args: ['-e', 'console.log("not-json-at-all")'],
      cwd: opts.cwd,
    });
    const connector = createAntigravityConnector({ runner: fakeRunner });
    const res = await connector.run('review', { workspace: process.cwd() });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/JSON inválid/i);
  });

  it('marks non-SUCCESS status as failed', async () => {
    const payload = JSON.stringify({ conversation_id: 'conv-9', status: 'ERROR', response: 'boom' });
    const fakeRunner = (opts) => runProcess({
      command: process.execPath,
      args: ['-e', `console.log(${JSON.stringify(payload)})`],
      cwd: opts.cwd,
    });
    const connector = createAntigravityConnector({ runner: fakeRunner });
    const res = await connector.run('review', { workspace: process.cwd() });

    expect(res.ok).toBe(false);
    expect(res.status).toBe('ERROR');
    expect(res.error).toMatch(/Estado no exitoso/i);
  });

  it('handles timeout and cancellation through processRunner', async () => {
    const slowRunner = (opts) => runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(()=>{}, 1000)'],
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    });
    const connector = createAntigravityConnector({ runner: slowRunner });

    const timedOut = await connector.run('review', { workspace: process.cwd(), timeoutMs: 120 });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.timedOut).toBe(true);

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    const cancelled = await connector.run('review', { workspace: process.cwd(), timeoutMs: 5000, signal: ac.signal });
    expect(cancelled.ok).toBe(false);
    expect(cancelled.cancelled).toBe(true);
  });
});
