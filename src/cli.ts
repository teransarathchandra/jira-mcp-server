import { mcpGetClientSetupInstructions } from './tools/mcpGetClientSetupInstructions.js';

// Command-line entry points that run without Jira credentials. This is the
// only module allowed to write to stdout: when serving, stdout is the MCP
// protocol channel.

export type Command = { kind: 'serve' } | { kind: 'setup'; client: string } | { kind: 'help' };

export const SETUP_CLIENTS = ['generic', 'claude-code', 'claude-desktop', 'codex-cli', 'cursor', 'windsurf', 'vscode'] as const;

const HELP_TEXT = `Usage: jira-delivery-mcp [command]

Commands:
  (none)            Start the MCP server on stdio (requires JIRA_* environment variables)
  setup <client>    Print setup instructions for an MCP client
                    Clients: ${SETUP_CLIENTS.join(', ')}
  --help, -h        Show this help`;

export function parseCommand(argv: string[]): Command {
  const [first, second] = argv;
  if (first === undefined) return { kind: 'serve' };
  if (first === 'setup') return { kind: 'setup', client: second ?? '' };
  return { kind: 'help' };
}

export function runSetup(client: string, out: (s: string) => void, err: (s: string) => void): number {
  if (!(SETUP_CLIENTS as readonly string[]).includes(client)) {
    err(`Unknown client "${client}". Valid: ${SETUP_CLIENTS.join(', ')}`);
    return 1;
  }
  out(
    mcpGetClientSetupInstructions({
      client,
      serverName: 'jira-delivery-mcp',
      serverCommand: 'npx',
      serverArgs: ['-y', 'jira-delivery-mcp'],
    }),
  );
  return 0;
}

/** Runs a non-serve command against the real stdout/stderr and returns the exit code. */
export function runCommand(command: Exclude<Command, { kind: 'serve' }>): number {
  const out = (s: string) => process.stdout.write(`${s}\n`);
  const err = (s: string) => process.stderr.write(`${s}\n`);
  if (command.kind === 'setup') return runSetup(command.client, out, err);
  out(HELP_TEXT);
  return 0;
}
