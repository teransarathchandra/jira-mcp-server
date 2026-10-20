import { describe, it, expect } from 'vitest';
import { suggestFieldIds, runDoctor, type DoctorDeps, type JiraField } from '../src/doctor.js';
import { parseCommand } from '../src/cli.js';
import { JiraAuthError } from '../src/jiraClient.js';

const field = (id: string, name: string): JiraField => ({ id, name, custom: id.startsWith('customfield_') });

const SITE_FIELDS: JiraField[] = [
  field('summary', 'Summary'),
  field('customfield_10115', 'User Acceptance Criteria'),
  field('customfield_10016', 'Story point estimate'),
  field('customfield_10026', 'Story Points'),
  field('customfield_10014', 'Epic Link'),
  field('customfield_10001', 'Team'),
  field('customfield_20000', 'Teams Channel'),
];

describe('suggestFieldIds()', () => {
  it('finds acceptance criteria, story points, epic link and team custom fields', () => {
    const s = suggestFieldIds(SITE_FIELDS, {});
    const byVar = Object.fromEntries(s.map((x) => [x.envVar, x.candidates.map((c) => c.id)]));
    expect(byVar.JIRA_ACCEPTANCE_CRITERIA_FIELD_ID).toEqual(['customfield_10115']);
    expect(byVar.JIRA_STORY_POINTS_FIELD_ID).toEqual(['customfield_10016', 'customfield_10026']);
    expect(byVar.JIRA_EPIC_FIELD_ID).toEqual(['customfield_10014']);
    expect(byVar.JIRA_TEAM_FIELD_ID).toEqual(['customfield_10001']);
  });

  it('never suggests a system field', () => {
    const s = suggestFieldIds([field('description', 'Acceptance criteria')], {});
    expect(s.find((x) => x.envVar === 'JIRA_ACCEPTANCE_CRITERIA_FIELD_ID')?.candidates).toEqual([]);
  });

  it('reports a configured id that does not exist on the site', () => {
    const s = suggestFieldIds(SITE_FIELDS, { JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: 'customfield_99999' });
    const ac = s.find((x) => x.envVar === 'JIRA_ACCEPTANCE_CRITERIA_FIELD_ID')!;
    expect(ac.current).toBe('customfield_99999');
    expect(ac.currentName).toBeUndefined();
  });

  it('names a configured id that exists', () => {
    const s = suggestFieldIds(SITE_FIELDS, { JIRA_EPIC_FIELD_ID: 'customfield_10014' });
    expect(s.find((x) => x.envVar === 'JIRA_EPIC_FIELD_ID')?.currentName).toBe('Epic Link');
  });
});

describe('parseCommand()', () => {
  it('parses doctor', () => {
    expect(parseCommand(['doctor'])).toEqual({ kind: 'doctor' });
  });
});

const TOKEN = 'secret-token-value-123';
const EMAIL = 'someone@example.com';

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    env: { JIRA_BASE_URL: 'https://acme.atlassian.net', JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN },
    jira: () => ({
      getMyself: async () => ({ accountId: 'abc', displayName: 'Dev One' }),
      listFields: async () => SITE_FIELDS,
    }),
    confluence: () => null,
    ...over,
  };
}

async function run(d: DoctorDeps) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runDoctor(d, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n'), all: [...out, ...err].join('\n') };
}

describe('runDoctor()', () => {
  it('reports the signed-in user and prints env lines for unset fields', async () => {
    const r = await run(deps());
    expect(r.code).toBe(0);
    expect(r.out).toContain('signed in to https://acme.atlassian.net as Dev One');
    expect(r.out).toContain('JIRA_ACCEPTANCE_CRITERIA_FIELD_ID=customfield_10115');
    expect(r.out).toContain('User Acceptance Criteria');
  });

  it('never prints the API token or the email', async () => {
    const r = await run(deps());
    expect(r.all).not.toContain(TOKEN);
    expect(r.all).not.toContain(EMAIL);
  });

  it('fails with exit 1 and names the missing variables', async () => {
    const r = await run(deps({ env: { JIRA_BASE_URL: 'https://acme.atlassian.net' } }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('JIRA_EMAIL');
    expect(r.err).toContain('JIRA_API_TOKEN');
  });

  it('fails with exit 1 when Jira rejects the credentials', async () => {
    const r = await run(
      deps({
        jira: () => ({
          getMyself: async () => {
            throw new JiraAuthError('Jira authentication failed. Check your credentials.');
          },
          listFields: async () => [],
        }),
      }),
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/authentication failed/i);
    expect(r.all).not.toContain(TOKEN);
  });

  it('still passes when the field list cannot be read', async () => {
    const r = await run(
      deps({
        jira: () => ({
          getMyself: async () => ({ accountId: 'abc', displayName: 'Dev One' }),
          listFields: async () => {
            throw new Error('HTTP 500');
          },
        }),
      }),
    );
    expect(r.code).toBe(0);
    expect(r.all).toMatch(/could not list fields/i);
  });

  it('warns when Confluence is only partly configured', async () => {
    const r = await run(deps({ env: { ...deps().env, CONFLUENCE_BASE_URL: 'https://acme.atlassian.net/wiki' } }));
    expect(r.code).toBe(0);
    expect(r.all).toMatch(/CONFLUENCE_EMAIL/);
  });

  it('checks Confluence when it is configured', async () => {
    let called = false;
    const r = await run(
      deps({
        confluence: () => ({
          check: async () => {
            called = true;
          },
        }),
      }),
    );
    expect(called).toBe(true);
    expect(r.out).toMatch(/Confluence: reachable/);
  });

  it('fails with exit 1 when configured Confluence credentials are rejected', async () => {
    const r = await run(
      deps({
        confluence: () => ({
          check: async () => {
            throw new Error('Confluence authentication failed.');
          },
        }),
      }),
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Confluence/);
  });
});
