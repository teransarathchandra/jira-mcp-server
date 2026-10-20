import { getConfig } from './config.js';
import { ConfluenceClient } from './confluence/confluenceClient.js';
import { getConfluenceConfig } from './confluence/confluenceConfig.js';
import { JiraClient } from './jiraClient.js';
import { redactString } from './security/secretRedactor.js';

// `jira-delivery-mcp doctor`: checks the Jira (and Confluence) credentials and
// suggests the custom field ids to configure. Read-only; never prints the
// email or the API token.

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
}

export interface FieldSuggestion {
  envVar: string;
  label: string;
  current?: string;
  /** Name of the configured field, when it exists on the site. */
  currentName?: string;
  candidates: Array<{ id: string; name: string }>;
}

export interface DoctorDeps {
  env: Record<string, string | undefined>;
  jira: () => { getMyself(): Promise<{ displayName: string }>; listFields(): Promise<JiraField[]> };
  /** Null when Confluence is not (fully) configured. */
  confluence: () => { check(): Promise<void> } | null;
}

type Writer = (s: string) => void;

const FIELD_SETTINGS: Array<{ envVar: string; label: string; pattern: RegExp }> = [
  { envVar: 'JIRA_ACCEPTANCE_CRITERIA_FIELD_ID', label: 'Acceptance criteria', pattern: /acceptance\s*criteria/i },
  { envVar: 'JIRA_STORY_POINTS_FIELD_ID', label: 'Story points', pattern: /story\s*points?/i },
  { envVar: 'JIRA_EPIC_FIELD_ID', label: 'Epic link', pattern: /^epic\s*link$/i },
  { envVar: 'JIRA_TEAM_FIELD_ID', label: 'Team', pattern: /^team$/i },
];

const REQUIRED = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] as const;

export function suggestFieldIds(fields: JiraField[], env: Record<string, string | undefined>): FieldSuggestion[] {
  return FIELD_SETTINGS.map(({ envVar, label, pattern }) => {
    const current = env[envVar]?.trim() || undefined;
    return {
      envVar,
      label,
      current,
      currentName: current ? fields.find((f) => f.id === current)?.name : undefined,
      candidates: fields
        .filter((f) => f.custom && f.id.startsWith('customfield_') && pattern.test(f.name.trim()))
        .map(({ id, name }) => ({ id, name })),
    };
  });
}

const message = (err: unknown) => redactString(err instanceof Error ? err.message : String(err));

export async function runDoctor(deps: DoctorDeps, out: Writer, err: Writer): Promise<number> {
  const missing = REQUIRED.filter((v) => !deps.env[v]?.trim());
  if (missing.length > 0) {
    err(`✗ Missing required environment variable(s): ${missing.join(', ')}`);
    err('  Run `jira-delivery-mcp setup <client>` for setup instructions.');
    return 1;
  }

  const jira = deps.jira();
  try {
    const me = await jira.getMyself();
    out(`✓ Jira: signed in to ${deps.env.JIRA_BASE_URL?.trim().replace(/\/+$/, '')} as ${me.displayName}`);
  } catch (e) {
    err(`✗ Jira: ${message(e)}`);
    err('  Check JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN (https://id.atlassian.com/manage-profile/security/api-tokens).');
    return 1;
  }

  let code = 0;
  try {
    printFieldSuggestions(suggestFieldIds(await jira.listFields(), deps.env), out);
  } catch (e) {
    out(`! Jira: could not list fields (${message(e)}); skipping field suggestions.`);
  }

  const confluence = deps.confluence();
  if (confluence) {
    try {
      await confluence.check();
      out('✓ Confluence: reachable with the configured credentials');
    } catch (e) {
      err(`✗ Confluence: ${message(e)}`);
      code = 1;
    }
  } else if (deps.env.CONFLUENCE_BASE_URL?.trim() && deps.env.CONFLUENCE_ENABLED?.trim().toLowerCase() !== 'false') {
    const unset = ['CONFLUENCE_EMAIL', 'CONFLUENCE_API_TOKEN'].filter((v) => !deps.env[v]?.trim());
    out(`! Confluence: CONFLUENCE_BASE_URL is set but ${unset.join(' and ')} ${unset.length > 1 ? 'are' : 'is'} not, so Confluence is off.`);
  } else {
    out('- Confluence: not configured (optional)');
  }
  return code;
}

function printFieldSuggestions(suggestions: FieldSuggestion[], out: Writer): void {
  out('');
  out('Custom fields:');
  const add: string[] = [];
  for (const s of suggestions) {
    if (s.current) {
      out(
        s.currentName
          ? `✓ ${s.envVar}=${s.current} (${s.currentName})`
          : `✗ ${s.envVar}=${s.current} does not exist on this site${s.candidates.length ? `; did you mean ${s.candidates.map((c) => c.id).join(' or ')}?` : ''}`,
      );
    } else if (s.candidates.length === 0) {
      out(`- ${s.label}: no matching custom field; ${s.envVar} not needed`);
    } else {
      const names = s.candidates.map((c) => `${c.id} "${c.name}"`).join(', ');
      out(`! ${s.label}: not configured. Found ${names}`);
      add.push(`${s.envVar}=${s.candidates[0].id}`);
    }
  }
  if (add.length > 0) {
    out('');
    out('Add to the server environment (pick another id above if the first is wrong):');
    for (const line of add) out(`  ${line}`);
  }
  out('');
}

/** Production wiring: real clients, the process environment. */
export function defaultDoctorDeps(): DoctorDeps {
  return {
    env: process.env,
    jira: () => new JiraClient(getConfig()),
    confluence: () => {
      const config = getConfluenceConfig();
      if (!config) return null;
      const client = new ConfluenceClient(config);
      return { check: async () => void (await client.searchContentByCql('type = page', 1)) };
    },
  };
}
