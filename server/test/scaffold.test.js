import { describe, expect, it } from 'vitest';
describe('scaffold', () => {
  it('does not claim integrations are ready', () => {
    expect('not-tested').not.toBe('ready');
  });
});
