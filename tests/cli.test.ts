import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseCommand, runSetup } from '../src/cli.js';

describe('parseCommand()', () => {
  it('serves by default', () => {
    expect(parseCommand([])).toEqual({ kind: 'serve' });
  });

  it('parses setup with a client', () => {
    expect(parseCommand(['setup', 'cursor'])).toEqual({ kind: 'setup', client: 'cursor' });
  });

  it('parses help flags', () => {
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' });
    expect(parseCommand(['-h'])).toEqual({ kind: 'help' });
  });
});

describe('runSetup()', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('rejects an unknown client and lists the valid ones', () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runSetup('nope', (s) => out.push(s), (s) => err.push(s));
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('Unknown client "nope"');
    expect(err.join('\n')).toContain('claude-code');
    expect(out).toEqual([]);
  });

  it('prints instructions without any Jira credentials', () => {
    const out: string[] = [];
    const code = runSetup('cursor', (s) => out.push(s), () => {});
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('jira-delivery-mcp');
  });
});
