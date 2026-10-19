import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JiraClient } from '../../src/jiraClient.js';
import type { Config } from '../../src/config.js';

// Drives the real JiraClient from recorded Jira Cloud responses stored in
// tests/fixtures/jira/<name>.json as { routes: { "<METHOD> <path>": { status, body } } }.

interface FixtureRoute {
  status: number;
  body: unknown;
}

interface FixtureFile {
  routes: Record<string, FixtureRoute>;
}

export function loadFixture(name: string): FixtureFile {
  const url = new URL(`../fixtures/jira/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as FixtureFile;
}

export function installJiraFixture(name: string): { requests: string[]; restore(): void } {
  const { routes } = loadFixture(name);
  const requests: string[] = [];

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push(`${method} ${url.pathname}${url.search}`);
    const route = routes[`${method} ${url.pathname}`] ?? { status: 404, body: { errorMessages: ['no fixture route'] } };
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { 'content-type': 'application/json' },
    });
  });

  return {
    requests,
    restore() {
      vi.unstubAllGlobals();
    },
  };
}

export function fixtureConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'https://example.atlassian.net',
    email: 'dev@example.com',
    apiToken: 'fixture-token',
    epicFieldId: null,
    storyPointsFieldId: null,
    acceptanceCriteriaFieldId: null,
    teamFieldId: null,
    highAuthorityEmails: [],
    highAuthorityAccountIds: [],
    maxContextChars: 30000,
    projectConfig: {
      defaultProjectKey: 'ABC',
      allowedProjectKeys: ['ABC'],
      issueKeyPattern: /^[A-Z][A-Z0-9]+-\d+$/,
      strictProjectAllowlist: false,
      exampleIssueKey: 'ABC-123',
    },
    clientProfile: 'generic',
    branchPattern: '{type}/{KEY}-{slug}',
    ...overrides,
  } as Config;
}

export function fixtureClient(config: Config = fixtureConfig()): JiraClient {
  return new JiraClient(config);
}
