import { McpClientProfile } from './clientProfiles/clientProfile.js';
import { parseClientProfile } from './clientProfiles/clientProfileConfig.js';
import { DEFAULT_BRANCH_PATTERN } from './delivery/branchName.js';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** MCP clients don't expand ~, so do it here; always return an absolute path. */
function resolveAuditLogPath(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return join(homedir(), '.jira-delivery-mcp', 'audit.log');
  if (value === '~' || value.startsWith('~/')) return join(homedir(), value.slice(2));
  return resolve(value);
}

export interface JiraProjectConfig {
  defaultProjectKey?: string;
  allowedProjectKeys: string[];
  issueKeyPattern: RegExp;
  strictProjectAllowlist: boolean;
  exampleIssueKey: string;
}

export interface Config {
  baseUrl: string;
  email: string;
  apiToken: string;
  epicFieldId: string | null;  // e.g. "customfield_10014" — null if not set
  // Intelligence fields (all optional):
  storyPointsFieldId: string | null;       // JIRA_STORY_POINTS_FIELD_ID
  acceptanceCriteriaFieldId: string | null; // JIRA_ACCEPTANCE_CRITERIA_FIELD_ID
  teamFieldId: string | null;               // JIRA_TEAM_FIELD_ID
  highAuthorityEmails: string[];            // JIRA_HIGH_AUTHORITY_AUTHOR_EMAILS (comma-separated)
  highAuthorityAccountIds: string[];        // JIRA_HIGH_AUTHORITY_ACCOUNT_IDS (comma-separated)
  maxContextChars: number;                  // JIRA_MAX_CONTEXT_CHARS (default: 30000)
  projectConfig: JiraProjectConfig;
  clientProfile: McpClientProfile;
  branchPattern: string;                    // JIRA_BRANCH_PATTERN (default: {type}/{KEY}-{slug})
  enableWrites: boolean;                    // JIRA_ENABLE_WRITES=true registers the write tools (default: false)
  auditLogPath: string;                     // JIRA_DELIVERY_AUDIT_LOG (default: ~/.jira-delivery-mcp/audit.log)
}

export function getProjectConfig(): JiraProjectConfig {
  const defaultProjectKeyRaw =
    process.env.JIRA_DEFAULT_PROJECT_KEY?.trim().toUpperCase() ||
    process.env.JIRA_PROJECT_KEY?.trim().toUpperCase() ||
    undefined;

  const allowedProjectKeysRaw = process.env.JIRA_ALLOWED_PROJECT_KEYS?.trim() || '';
  const allowedProjectKeys = allowedProjectKeysRaw
    ? allowedProjectKeysRaw.split(',').map(k => k.trim().toUpperCase()).filter(Boolean)
    : [];

  let issueKeyPattern: RegExp;
  const patternRaw = process.env.JIRA_ISSUE_KEY_PATTERN?.trim();
  if (patternRaw) {
    try {
      issueKeyPattern = new RegExp(patternRaw);
    } catch (e) {
      throw new Error(`JIRA_ISSUE_KEY_PATTERN is not a valid regex: ${e}`);
    }
  } else {
    issueKeyPattern = /^[A-Z][A-Z0-9]+-\d+$/;
  }

  const strictRaw = process.env.JIRA_STRICT_PROJECT_ALLOWLIST?.trim();
  const strictProjectAllowlist = strictRaw === 'true' || strictRaw === '1';

  const exampleIssueKeyRaw = process.env.JIRA_EXAMPLE_ISSUE_KEY?.trim().toUpperCase();
  const exampleIssueKey = exampleIssueKeyRaw
    ? exampleIssueKeyRaw
    : defaultProjectKeyRaw
      ? `${defaultProjectKeyRaw}-123`
      : 'PROJ-123';

  return {
    defaultProjectKey: defaultProjectKeyRaw,
    allowedProjectKeys,
    issueKeyPattern,
    strictProjectAllowlist,
    exampleIssueKey,
  };
}

export function getConfig(): Config {
  const baseUrl = process.env.JIRA_BASE_URL?.trim();
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  const epicFieldId = process.env.JIRA_EPIC_FIELD_ID?.trim() || null;

  const storyPointsFieldId = process.env.JIRA_STORY_POINTS_FIELD_ID?.trim() || null;
  const acceptanceCriteriaFieldId = process.env.JIRA_ACCEPTANCE_CRITERIA_FIELD_ID?.trim() || null;
  const teamFieldId = process.env.JIRA_TEAM_FIELD_ID?.trim() || null;

  const highAuthorityEmailsRaw = process.env.JIRA_HIGH_AUTHORITY_AUTHOR_EMAILS?.trim() || '';
  const highAuthorityEmails = highAuthorityEmailsRaw
    ? highAuthorityEmailsRaw.split(',').map(e => e.trim()).filter(Boolean)
    : [];

  const highAuthorityAccountIdsRaw = process.env.JIRA_HIGH_AUTHORITY_ACCOUNT_IDS?.trim() || '';
  const highAuthorityAccountIds = highAuthorityAccountIdsRaw
    ? highAuthorityAccountIdsRaw.split(',').map(id => id.trim()).filter(Boolean)
    : [];

  const maxContextCharsRaw = process.env.JIRA_MAX_CONTEXT_CHARS?.trim();
  const maxContextChars = maxContextCharsRaw ? Math.max(5000, parseInt(maxContextCharsRaw, 10) || 30000) : 30000;

  const clientProfile = parseClientProfile(process.env.MCP_CLIENT_PROFILE);

  const errors: string[] = [];

  if (!baseUrl) {
    errors.push("JIRA_BASE_URL");
  }
  if (!email) {
    errors.push("JIRA_EMAIL");
  }
  if (!apiToken) {
    errors.push("JIRA_API_TOKEN");
  }

  if (errors.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${errors.join(", ")}`
    );
  }

  return {
    baseUrl: baseUrl as string,
    email: email as string,
    apiToken: apiToken as string,
    epicFieldId,
    storyPointsFieldId,
    acceptanceCriteriaFieldId,
    teamFieldId,
    highAuthorityEmails,
    highAuthorityAccountIds,
    maxContextChars,
    projectConfig: getProjectConfig(),
    clientProfile,
    branchPattern: process.env.JIRA_BRANCH_PATTERN?.trim() || DEFAULT_BRANCH_PATTERN,
    enableWrites: process.env.JIRA_ENABLE_WRITES?.trim().toLowerCase() === 'true',
    auditLogPath: resolveAuditLogPath(process.env.JIRA_DELIVERY_AUDIT_LOG),
  };
}
