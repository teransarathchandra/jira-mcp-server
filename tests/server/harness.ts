import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { createServer } from '../../src/server/createServer.js';
import type { ServerDeps } from '../../src/server/types.js';
import type { Config } from '../../src/config.js';
import type { JiraClient } from '../../src/jiraClient.js';

export function testDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  const config = {
    baseUrl: 'https://example.atlassian.net',
    email: 'dev@example.com',
    apiToken: 'test-token',
    projectConfig: {
      defaultProjectKey: 'ABC',
      allowedProjectKeys: ['ABC'],
      strictProjectAllowlist: false,
      exampleIssueKey: 'ABC-123',
    },
  } as unknown as Config;
  return { config, jiraClient: {} as JiraClient, ...overrides };
}

export interface ConnectOptions {
  /** Declare form elicitation and answer every elicitation request with this handler. */
  onElicit?: (params: { message: string; requestedSchema: unknown }) => Promise<{ action: string; content?: Record<string, unknown> }>;
  /** Elicitation capability the client declares (default: form). */
  elicitationCapability?: Record<string, unknown>;
}

export async function connect(
  deps: ServerDeps = testDeps(),
  options: ConnectOptions = {},
): Promise<{ client: Client; close(): Promise<void> }> {
  const server = createServer(deps);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'contract-test', version: '0.0.0' },
    options.onElicit ? { capabilities: { elicitation: options.elicitationCapability ?? { form: {} } } } : {},
  );
  if (options.onElicit) {
    const onElicit = options.onElicit;
    client.setRequestHandler('elicitation/create', async (request: { params: { message: string; requestedSchema: unknown } }) =>
      onElicit(request.params),
    );
  }
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  return content?.[0]?.type === 'text' ? (content[0].text ?? '') : '';
}
