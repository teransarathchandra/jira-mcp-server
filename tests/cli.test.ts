import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseCommand, runSetup, runCommand } from '../src/cli.js';
import { getServerVersion } from '../src/version.js';

describe('runCommand()', () => {
  it('rejects an unknown command on stderr with exit 1', () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCommand(parseCommand(['stup', 'cursor']), (s) => out.push(s), (s) => err.push(s));
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('Unknown command "stup"');
    expect(err.join('\n')).toContain('Usage:');
    expect(out).toEqual([]);
  });

  it('prints the server version on stdout with exit 0', () => {
    const out: string[] = [];
    expect(runCommand({ kind: 'version' }, (s) => out.push(s), () => {})).toBe(0);
    expect(out).toEqual([getServerVersion()]);
  });

  it('prints help on stdout with exit 0', () => {
    const out: string[] = [];
    expect(runCommand({ kind: 'help' }, (s) => out.push(s), () => {})).toBe(0);
    expect(out.join('\n')).toContain('Usage:');
  });
});

describe('setup instructions during a prerelease', () => {
  it('installs the same dist-tag as the running version', () => {
    const out: string[] = [];
    runSetup('claude-code', (s) => out.push(s), () => {}, '2.0.0-beta.2');
    expect(out.join('\n')).toContain('-- npx -y jira-delivery-mcp@beta');
  });
});

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

  it('treats setup --help as help', () => {
    expect(parseCommand(['setup', '--help'])).toEqual({ kind: 'help' });
  });

  it('parses --version and -v', () => {
    expect(parseCommand(['--version'])).toEqual({ kind: 'version' });
    expect(parseCommand(['-v'])).toEqual({ kind: 'version' });
  });

  it('marks anything else as unknown', () => {
    expect(parseCommand(['stup'])).toEqual({ kind: 'unknown', arg: 'stup' });
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
