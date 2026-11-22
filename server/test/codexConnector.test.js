import { describe, it, expect } from 'vitest';
import { buildCodexArgs, createCodexConnector } from '../src/connectors/codexConnector.js';
import { runProcess } from '../src/connectors/processRunner.js';

describe('codexConnector (fake processes)', () => {
  it('builds exact verified Codex CLI arguments', () => {
    const args = buildCodexArgs({
      workspace: '/tmp/ws',
      sandbox: 'read-only',
      prompt: 'Responde únicamente OMNIPILOT_OK.',
    });
    expect(args).toEqual([
      '--ask-for-approval', 'never',
      'exec',
      '--cd', '/tmp/ws',
      '--sandbox', 'read-only',
      '--ephemeral',
      '--json',
      'Responde únicamente OMNIPILOT_OK.',
    ]);
  });

  it('rejects invalid sandbox mode or missing workspace/prompt', () => {
    expect(() => buildCodexArgs({ workspace: '', prompt: 'hi' })).toThrow(/Workspace/);
    expect(() => buildCodexArgs({ workspace: '/tmp/ws', sandbox: 'invalid', prompt: 'hi' })).toThrow(/sandbox/);
    expect(() => buildCodexArgs({ workspace: '/tmp/ws', prompt: '   ' })).toThrow(/Prompt/);
  });

  it('detects availability with a fake process', async () => {
    const fakeRunner = ({ args }) => runProcess({
      command: process.execPath,
      args: ['-e', `console.log("codex-cli 0.0.0-fake " + ${JSON.stringify(args.join(' '))})`],
    });
    const connector = createCodexConnector({ runner: fakeRunner });
    const status = await connector.isAvailable();
    expect(status.available).toBe(true);
    expect(status.version).toContain('codex-cli 0.0.0-fake --version');
    expect(status.error).toBeNull();
  });

  it('reports unavailable when binary does not exist', async () => {
    const connector = createCodexConnector({ command: 'nonexistent-codex-binary-xyz' });
    const status = await connector.isAvailable();
    expect(status.available).toBe(false);
    expect(status.version).toBeNull();
    expect(status.error).toBeTruthy();
  });

  it('runs a prompt via fake process, parses JSONL output, and passes exact args', async () => {
    let captured;
    const fakeRunner = async (opts) => {
      captured = opts;
      return runProcess({
        command: process.execPath,
        args: ['-e', 'console.log(JSON.stringify({type:"item.completed",item:{text:"OMNIPILOT_OK"}}))'],
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        maxOutput: opts.maxOutput,
      });
    };
    const connector = createCodexConnector({ runner: fakeRunner });
    const res = await connector.run('Responde únicamente OMNIPILOT_OK.', {
      workspace: process.cwd(),
      sandbox: 'read-only',
    });
    expect(res.ok).toBe(true);
    expect(res.output).toBe('OMNIPILOT_OK');
    expect(res.events).toHaveLength(1);
    expect(captured.command).toBe('codex');
    expect(captured.args).toEqual([
      '--ask-for-approval', 'never',
      'exec',
      '--cd', process.cwd(),
      '--sandbox', 'read-only',
      '--ephemeral',
      '--json',
      'Responde únicamente OMNIPILOT_OK.',
    ]);
  });

  it('supports timeout and cancellation through processRunner', async () => {
    const slowRunner = (opts) => runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(()=>{}, 1000)'],
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    });
    const connector = createCodexConnector({ runner: slowRunner });

    const timedOut = await connector.run('hi', { workspace: process.cwd(), timeoutMs: 120 });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.timedOut).toBe(true);

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    const cancelled = await connector.run('hi', { workspace: process.cwd(), timeoutMs: 5000, signal: ac.signal });
    expect(cancelled.ok).toBe(false);
    expect(cancelled.cancelled).toBe(true);
  });
});
