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

  it.each(['generic', 'claude-code', 'claude-desktop', 'codex-cli', 'cursor', 'windsurf', 'vscode'])(
    'gives %s instructions that produce a server that can start',
    (client) => {
      const out: string[] = [];
      runSetup(client, (s) => out.push(s), () => {});
      const text = out.join('\n');
      expect(text).not.toContain('npm run build');
      expect(text).not.toContain('.env');
      for (const v of ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN']) expect(text).toContain(v);
    },
  );

  it('prints a claude mcp add command that passes the credentials', () => {
    const out: string[] = [];
    runSetup('claude-code', (s) => out.push(s), () => {});
    expect(out.join('\n')).toContain('claude mcp add jira-delivery-mcp -e JIRA_BASE_URL=');
  });

  it('prints instructions without any Jira credentials', () => {
    const out: string[] = [];
    const code = runSetup('cursor', (s) => out.push(s), () => {});
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('jira-delivery-mcp');
  });
});
