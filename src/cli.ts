import { mcpGetClientSetupInstructions } from './tools/mcpGetClientSetupInstructions.js';
import { getPackageSpec, getServerVersion } from './version.js';

// Command-line entry points that run without Jira credentials. This is the
// only module allowed to write to stdout: when serving, stdout is the MCP
// protocol channel.

export type Command =
  | { kind: 'serve' }
  | { kind: 'setup'; client: string }
  | { kind: 'help' }
  | { kind: 'unknown'; arg: string };

type Writer = (s: string) => void;

export const SETUP_CLIENTS = ['generic', 'claude-code', 'claude-desktop', 'codex-cli', 'cursor', 'windsurf', 'vscode'] as const;

const HELP_TEXT = `Usage: jira-delivery-mcp [command]

Commands:
  (none)            Start the MCP server on stdio (requires JIRA_* environment variables)
  setup <client>    Print setup instructions for an MCP client
                    Clients: ${SETUP_CLIENTS.join(', ')}
  --help, -h        Show this help`;

export function parseCommand(argv: string[]): Command {
  const [first, second] = argv;
  const isHelp = (arg: string | undefined) => arg === '--help' || arg === '-h';
  if (first === undefined) return { kind: 'serve' };
  if (isHelp(first)) return { kind: 'help' };
  if (first === 'setup') return isHelp(second) ? { kind: 'help' } : { kind: 'setup', client: second ?? '' };
  return { kind: 'unknown', arg: first };
}

export function runSetup(client: string, out: Writer, err: Writer, version: string = getServerVersion()): number {
  if (!(SETUP_CLIENTS as readonly string[]).includes(client)) {
    err(`Unknown client "${client}". Valid: ${SETUP_CLIENTS.join(', ')}`);
    return 1;
  }
  out(
    mcpGetClientSetupInstructions({
      client,
      serverName: 'jira-delivery-mcp',
      serverCommand: 'npx',
      serverArgs: ['-y', getPackageSpec(version)],
    }),
  );
  return 0;
}

const stdout: Writer = (s) => process.stdout.write(`${s}\n`);
const stderr: Writer = (s) => process.stderr.write(`${s}\n`);

/** Runs a non-serve command and returns the process exit code. */
export function runCommand(command: Exclude<Command, { kind: 'serve' }>, out: Writer = stdout, err: Writer = stderr): number {
  switch (command.kind) {
    case 'setup':
      return runSetup(command.client, out, err);
    case 'unknown':
      err(`Unknown command "${command.arg}".\n\n${HELP_TEXT}`);
      return 1;
    case 'help':
      out(HELP_TEXT);
      return 0;
  }
}
