import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatRelatedPagesOutput,
  formatPageSummaryOutput,
} from '../src/confluence/formatConfluenceSummary.js';
import { formatJiraConfluenceContextBrief } from '../src/confluence/formatJiraConfluenceContextBrief.js';
import type { ConfluenceContext, ConfluencePageSummary } from '../src/confluence/confluenceContextService.js';
import type { IssueContext } from '../src/jira/issueContextService.js';
import type { ConflictResult } from '../src/utils/conflictDetector.js';

// ── Mock getConfluenceConfig ───────────────────────────────────────────────────

vi.mock('../src/confluence/confluenceConfig.js', async () => {
  const actual = await vi.importActual<typeof import('../src/confluence/confluenceConfig.js')>(
    '../src/confluence/confluenceConfig.js'
  );
  return {
    ...actual,
    getConfluenceConfig: vi.fn(() => null),
    isConfluenceEnabled: vi.fn(() => false),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function recentIso(): string {
  return new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
}

function makePageSummary(overrides: Partial<ConfluencePageSummary> = {}): ConfluencePageSummary {
  return {
    pageId: 'page-100',
    title: 'Authentication PRD',
    url: 'https://example.atlassian.net/wiki/spaces/ENG/pages/page-100/Authentication+PRD',
    space: 'Engineering',
    spaceKey: 'ENG',
    lastUpdated: recentIso(),
    version: 3,
    labels: ['prd', 'requirements'],
    relevanceLevel: 'HIGH_RELEVANCE',
    relevanceScore: 85,
    relevanceReasons: ['title matches issue key', 'directly linked from Jira'],
    authorityLevel: 'AUTHORITATIVE',
    authorityReasons: ['page has authority label', 'directly linked from Jira'],
    isStale: false,
    staleWarning: undefined,
    bodyMarkdown: '## Overview\nThis document describes authentication requirements.\n\n## Acceptance Criteria\n- Users must login with email/password\n- Session expires after 30 minutes',
    bodyTruncated: false,
    signals: {
      businessRules: ['Users must authenticate before accessing protected resources.'],
      userRoles: ['admin', 'user'],
      apiEndpoints: ['/api/v1/auth/login', '/api/v1/auth/logout'],
      uiScreens: ['Login screen', 'Dashboard screen'],
      tableNames: ['users', 'sessions'],
      validationRules: ['Email field is required', 'Password must be at least 8 chars.'],
      featureFlags: [],
      permissions: ['read', 'write'],
      releaseNotes: [],
      knownLimitations: [],
      dependencies: [],
      testingNotes: [],
      diagramsMentioned: [],
      relatedPageLinks: [],
    },
    sections: [
      { heading: 'Overview', level: 2, content: 'This document describes authentication requirements.' },
      { heading: 'Acceptance Criteria', level: 2, content: '- Users must login with email/password\n- Session expires after 30 minutes' },
    ],
    ...overrides,
  };
}

function makeConfluenceContext(overrides: Partial<ConfluenceContext> = {}): ConfluenceContext {
  return {
    pagesSearched: 5,
    pagesRead: 2,
    highRelevancePages: [makePageSummary()],
    mediumRelevancePages: [],
    lowRelevancePagesCount: 1,
    omittedCount: 2,
    warnings: [],
    budgetWarnings: [],
    ...overrides,
  };
}

function makeJiraContext(overrides: Partial<IssueContext> = {}): IssueContext {
  return {
    mainIssue: {
      id: '10001',
      key: 'CMPI-1234',
      fields: {
        summary: 'Implement user authentication flow',
        description: null,
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Alice' },
        reporter: { displayName: 'Bob' },
        labels: ['auth', 'security'],
        components: [{ name: 'Backend' }],
        fixVersions: [],
        issuetype: { name: 'Story' },
        parent: undefined,
        subtasks: [],
        attachment: [],
        comment: { comments: [], total: 0 },
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-10T00:00:00.000Z',
        issuelinks: [],
        epic: null,
      },
    } as IssueContext['mainIssue'],
    mainIssueDescription: 'As a user, I want to authenticate with my email and password.\n\nThe system must redirect to dashboard after login.',
    parentIssue: null,
    parentDescription: null,
    epicIssue: null,
    epicDescription: null,
    linkedIssues: [],
    subtasks: [],
    epicSiblings: [],
    truncationWarnings: [],
    ...overrides,
  };
}

function makeConflictResult(overrides: Partial<ConflictResult> = {}): ConflictResult {
  return {
    hasConflicts: false,
    conflicts: [],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('formatRelatedPagesOutput', () => {
  it('renders "No high-relevance pages found." when no HIGH pages exist', () => {
    const context = makeConfluenceContext({
      highRelevancePages: [],
      mediumRelevancePages: [],
      lowRelevancePagesCount: 0,
      omittedCount: 0,
    });

    const output = formatRelatedPagesOutput(context, 'CMPI-1234');

    expect(output).toContain('No high-relevance pages found.');
    expect(output).toContain('Related Confluence Pages for CMPI-1234');
  });

  it('renders HIGH section with correct metadata for a high-relevance page', () => {
    const page = makePageSummary();
    const context = makeConfluenceContext({
      highRelevancePages: [page],
      mediumRelevancePages: [],
    });

    const output = formatRelatedPagesOutput(context, 'CMPI-1234');

    expect(output).toContain('High Relevance');
    expect(output).toContain('Authentication PRD');
    expect(output).toContain(page.url);
    expect(output).toContain('Engineering');
    expect(output).toContain('AUTHORITATIVE');
    expect(output).not.toContain('No high-relevance pages found.');
  });

  it('renders omitted count in Omitted section', () => {
    const context = makeConfluenceContext({
      highRelevancePages: [],
      mediumRelevancePages: [],
      lowRelevancePagesCount: 3,
      omittedCount: 2,
    });

    const output = formatRelatedPagesOutput(context, 'CMPI-1234');

    expect(output).toContain('5 low-relevance pages omitted.');
  });
});

describe('formatPageSummaryOutput', () => {
  it('renders metadata section with all fields', () => {
    const page = makePageSummary();
    const output = formatPageSummaryOutput(page);

    expect(output).toContain('Confluence Page Summary: Authentication PRD');
    expect(output).toContain('## Metadata');
    expect(output).toContain('Space: Engineering (ENG)');
    expect(output).toContain('Page ID: page-100');
    expect(output).toContain(page.url);
    expect(output).toContain('Version: 3');
    expect(output).toContain('Labels: prd, requirements');
    expect(output).toContain('Authority: AUTHORITATIVE');
  });

  it('renders signals section', () => {
    const page = makePageSummary();
    const output = formatPageSummaryOutput(page);

    expect(output).toContain('## Key Signals');
    expect(output).toContain('/api/v1/auth/login');
    expect(output).toContain('users');
    expect(output).toContain('Business Rules');
  });

  it('renders sections found', () => {
    const page = makePageSummary();
    const output = formatPageSummaryOutput(page);

    expect(output).toContain('## Sections Found');
    expect(output).toContain('Overview');
    expect(output).toContain('Acceptance Criteria');
  });
});

describe('formatJiraConfluenceContextBrief', () => {
  it('renders all major sections', () => {
    const jiraContext = makeJiraContext();
    const confluenceContext = makeConfluenceContext();
    const conflicts = makeConflictResult();

    const output = formatJiraConfluenceContextBrief(jiraContext, confluenceContext, conflicts);

    expect(output).toContain('# Jira + Confluence Context Brief: CMPI-1234');
    expect(output).toContain('## Main Jira Task');
    expect(output).toContain('## Jira Requirement Summary');
    expect(output).toContain('## Related Confluence Pages');
    expect(output).toContain('## Confluence Business Rules');
    expect(output).toContain('## Confluence Technical Signals');
    expect(output).toContain('## Jira vs Confluence Conflicts');
    expect(output).toContain('## Combined Acceptance Criteria');
    expect(output).toContain('## Suggested Repo Inspection Targets');
    expect(output).toContain('## Risks / Ambiguity');
    expect(output).toContain('## Clarification Needed');
    expect(output).toContain('## Final Implementation Prompt');
  });

  it('renders issue metadata in Main Jira Task section', () => {
    const jiraContext = makeJiraContext();
    const confluenceContext = makeConfluenceContext();
    const conflicts = makeConflictResult();

    const output = formatJiraConfluenceContextBrief(jiraContext, confluenceContext, conflicts);

    expect(output).toContain('**Issue**: CMPI-1234');
    expect(output).toContain('**Type**: Story');
    expect(output).toContain('**Status**: In Progress');
    expect(output).toContain('**Summary**: Implement user authentication flow');
    expect(output).toContain('**Labels**: auth, security');
    expect(output).toContain('**Components**: Backend');
  });

  it('shows "Confluence integration not enabled" when confluenceContext is null', () => {
    const jiraContext = makeJiraContext();
    const conflicts = makeConflictResult();

    const output = formatJiraConfluenceContextBrief(jiraContext, null, conflicts);

    expect(output).toContain('Confluence integration not enabled.');
    expect(output).toContain('_Confluence integration not enabled._');
  });

  it('includes conflict warning in Final Prompt when conflicts exist', () => {
    const jiraContext = makeJiraContext();
    const confluenceContext = makeConfluenceContext();
    const conflicts: ConflictResult = {
      hasConflicts: true,
      conflicts: [
        {
          type: 'jira_confluence_behavior_conflict',
          description: 'Source A says allow while Source B says disallow.',
          source1: 'Jira task description',
          source2: 'Confluence: Auth Page',
          severity: 'medium',
          explanation: 'Contradictory behavior instructions.',
          likelyImpact: 'Incorrect user experience.',
          recommendedHandling: 'Follow Jira.',
        },
      ],
    };

    const output = formatJiraConfluenceContextBrief(jiraContext, confluenceContext, conflicts);

    expect(output).toContain('WARNING: Jira vs Confluence conflicts detected');
    expect(output).toContain('## Jira vs Confluence Conflicts');
    expect(output).toContain('Source A says allow while Source B says disallow.');
  });

  it('renders Confluence page links in Final Implementation Prompt section', () => {
    const jiraContext = makeJiraContext();
    const confluenceContext = makeConfluenceContext();
    const conflicts = makeConflictResult();

    const output = formatJiraConfluenceContextBrief(jiraContext, confluenceContext, conflicts);

    const promptSection = output.slice(output.indexOf('## Final Implementation Prompt'));
    expect(promptSection).toContain('Authentication PRD');
    expect(promptSection).toContain('https://example.atlassian.net/wiki');
  });
});

describe('Confluence not configured error messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confluenceSearchRelatedPages returns clear error message when not configured', async () => {
    const { confluenceSearchRelatedPages } = await import('../src/tools/confluenceSearchRelatedPages.js');
    const { getConfluenceConfig } = await import('../src/confluence/confluenceConfig.js');

    // getConfluenceConfig already mocked to return null at module level
    vi.mocked(getConfluenceConfig).mockReturnValue(null);

    const mockJiraClient = {
      getIssue: vi.fn().mockResolvedValue({
        fields: {
          summary: 'Test Issue',
          labels: [],
          components: [],
          description: null,
          parent: undefined,
        },
      }),
    };

    const mockConfig = {
      baseUrl: 'https://example.atlassian.net',
      email: 'test@example.com',
      apiToken: 'token',
      projectKey: 'CMPI',
      epicFieldId: null,
      storyPointsFieldId: null,
      acceptanceCriteriaFieldId: null,
      teamFieldId: null,
      highAuthorityEmails: [],
      highAuthorityAccountIds: [],
      maxContextChars: 30000,
    };

    const result = await confluenceSearchRelatedPages(
      { issueKey: 'CMPI-1234' },
      mockJiraClient as never,
      mockConfig
    );

    expect(result).toContain('Confluence is not configured');
    expect(result).toContain('CONFLUENCE_BASE_URL');
  });

  it('confluenceGetPageSummary returns clear error message when not configured', async () => {
    const { confluenceGetPageSummary } = await import('../src/tools/confluenceGetPageSummary.js');
    const { getConfluenceConfig } = await import('../src/confluence/confluenceConfig.js');

    vi.mocked(getConfluenceConfig).mockReturnValue(null);

    const mockConfig = {
      baseUrl: 'https://example.atlassian.net',
      email: 'test@example.com',
      apiToken: 'token',
      projectKey: 'CMPI',
      epicFieldId: null,
      storyPointsFieldId: null,
      acceptanceCriteriaFieldId: null,
      teamFieldId: null,
      highAuthorityEmails: [],
      highAuthorityAccountIds: [],
      maxContextChars: 30000,
    };

    const result = await confluenceGetPageSummary(
      { pageId: '12345' },
      null as never,
      mockConfig
    );

    expect(result).toContain('Confluence is not configured');
    expect(result).toContain('CONFLUENCE_BASE_URL');
  });

  it('confluenceGetPageSummary returns error when pageId is empty', async () => {
    const { confluenceGetPageSummary } = await import('../src/tools/confluenceGetPageSummary.js');

    const mockConfig = {
      baseUrl: 'https://example.atlassian.net',
      email: 'test@example.com',
      apiToken: 'token',
      projectKey: 'CMPI',
      epicFieldId: null,
      storyPointsFieldId: null,
      acceptanceCriteriaFieldId: null,
      teamFieldId: null,
      highAuthorityEmails: [],
      highAuthorityAccountIds: [],
      maxContextChars: 30000,
    };

    const result = await confluenceGetPageSummary(
      { pageId: '   ' },
      null as never,
      mockConfig
    );

    expect(result).toContain('Invalid page ID');
    expect(result).toContain('pageId is required');
  });
});
