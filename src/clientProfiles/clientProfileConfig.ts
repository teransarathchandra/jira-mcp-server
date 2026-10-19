import { McpClientProfile, PromptStyle } from './clientProfile.js';

const VALID_PROFILES: McpClientProfile[] = [
  'generic',
  'claude-code',
  'claude-desktop',
  'codex-cli',
  'cursor',
  'windsurf',
  'vscode',
];

export function parseClientProfile(envValue?: string): McpClientProfile {
  if (!envValue) return 'generic';
  const normalized = envValue.trim().toLowerCase() as McpClientProfile;
  if (VALID_PROFILES.includes(normalized)) return normalized;
  return 'generic';
}

export function getClientDisplayName(profile: McpClientProfile): string {
  switch (profile) {
    case 'generic':        return 'Generic MCP Client';
    case 'claude-code':    return 'Claude Code';
    case 'claude-desktop': return 'Claude Desktop';
    case 'codex-cli':      return 'Codex CLI';
    case 'cursor':         return 'Cursor';
    case 'windsurf':       return 'Windsurf';
    case 'vscode':         return 'VS Code';
  }
}

// The server only reads credentials from its process environment, so every
// client config must pass these three variables.
const REQUIRED_ENV: Array<[string, string]> = [
  ['JIRA_BASE_URL', 'https://your-domain.atlassian.net'],
  ['JIRA_EMAIL', 'you@example.com'],
  ['JIRA_API_TOKEN', 'your-api-token'],
];

function jsonServerBlock(serverName: string, serverCommand: string, serverArgs: string[]): string {
  const env = Object.fromEntries(REQUIRED_ENV);
  const block = { mcpServers: { [serverName]: { command: serverCommand, args: serverArgs, env } } };
  return ['```json', JSON.stringify(block, null, 2), '```'].join('\n');
}

function getSetupSteps(profile: McpClientProfile, serverName: string, serverCommand: string, serverArgs: string[]): string {
  const argsStr = serverArgs.join(' ');
  // Only a local checkout (`node dist/index.js`) needs building; `npx` fetches the published package.
  const steps = serverCommand === 'node' ? ['Build the server: `npm run build`'] : [];
  const json = jsonServerBlock(serverName, serverCommand, serverArgs);

  switch (profile) {
    case 'generic':
      steps.push(`Configure your MCP client to launch the server via stdio with the required environment variables:\n\n${json}`);
      break;
    case 'claude-code': {
      const envFlags = REQUIRED_ENV.map(([k, v]) => `-e ${k}=${v}`).join(' ');
      steps.push(`Run: \`claude mcp add ${serverName} ${envFlags} -- ${serverCommand} ${argsStr}\``);
      break;
    }
    case 'claude-desktop':
      steps.push(`Add the server to \`claude_desktop_config.json\`:\n\n${json}`, 'Restart Claude Desktop.');
      break;
    case 'codex-cli': {
      const toml = [
        '```toml',
        `[mcp_servers.${serverName}]`,
        `command = "${serverCommand}"`,
        `args = [${serverArgs.map((a) => `"${a}"`).join(', ')}]`,
        `env = { ${REQUIRED_ENV.map(([k, v]) => `${k} = "${v}"`).join(', ')} }`,
        '```',
      ].join('\n');
      steps.push(`Add the server to \`~/.codex/config.toml\`:\n\n${toml}`);
      break;
    }
    case 'cursor':
      steps.push(`Add the server to \`~/.cursor/mcp.json\` (or Cursor Settings → MCP → Add Server):\n\n${json}`);
      break;
    case 'windsurf':
      steps.push(`Add the server in Windsurf Settings → MCP Servers:\n\n${json}`);
      break;
    case 'vscode':
      steps.push(`Configure the server in your VS Code MCP settings:\n\n${json}`);
      break;
  }
  steps.push(`Replace the placeholder values of ${REQUIRED_ENV.map(([k]) => k).join(', ')} with your own.`);
  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

function getExampleUsage(_profile: McpClientProfile): string {
  return [
    'Use the Jira Delivery MCP server to fetch <ISSUE-KEY> and prepare an implementation plan.',
    'Use the Jira Delivery MCP server to review your current branch against <ISSUE-KEY>.',
    'Use the Jira Delivery MCP server to verify Definition of Done for <ISSUE-KEY>.',
  ].join('\n');
}

export function getClientSetupInstructions(
  profile: McpClientProfile,
  serverName: string,
  serverCommand: string,
  serverArgs: string[],
): string {
  const displayName = getClientDisplayName(profile);
  const argsStr = serverArgs.join(' ');
  const steps = getSetupSteps(profile, serverName, serverCommand, serverArgs);
  const examples = getExampleUsage(profile);

  return [
    `# MCP Setup Instructions: ${displayName}`,
    '',
    '## Server',
    `- Name: ${serverName}`,
    `- Command: ${serverCommand}`,
    `- Args: ${argsStr}`,
    '',
    '## Setup Steps',
    steps,
    '',
    '## Example Usage',
    examples,
  ].join('\n');
}

export function getClientExampleCommands(profile: McpClientProfile, exampleIssueKey: string): string[] {
  const examples = [
    `Fetch ${exampleIssueKey} and prepare an implementation plan`,
    `Review my current branch against ${exampleIssueKey}`,
    `Verify Definition of Done for ${exampleIssueKey}`,
    `Generate QA handoff for ${exampleIssueKey}`,
    `Generate test strategy for ${exampleIssueKey}`,
  ];

  if (profile === 'claude-code') {
    examples.push(`Run jira_get_issue (includeConfluence: true) for ${exampleIssueKey}`);
  }

  return examples;
}

export function getClientPromptStyle(profile: McpClientProfile): PromptStyle {
  if (profile === 'claude-code') {
    return {
      agentNameLabel: 'Claude Code',
      repoInspectionInstruction: 'Claude Code should inspect the repository before making changes.',
      implementationInstruction: 'Use Claude Code to implement the changes.',
      prReviewInstruction: 'Use Claude Code to review PR alignment against the Jira requirement.',
    };
  }

  return {
    agentNameLabel: 'The coding agent',
    repoInspectionInstruction: 'The coding agent should inspect the repository before making changes.',
    implementationInstruction: 'Use your MCP client or coding agent to implement the changes.',
    prReviewInstruction: 'Use your MCP client to review PR alignment against the Jira requirement.',
  };
}
