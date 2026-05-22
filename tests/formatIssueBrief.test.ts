import { describe, it, expect } from 'vitest';
import { formatIssueBrief, formatSearchResult, JiraSearchIssue } from '../src/utils/formatIssueBrief.js';
import { JiraIssue } from '../src/jiraClient.js';

// ── Factory ───────────────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: '12345',
    key: 'CMPI-1234',
    fields: {
      summary: 'Test issue summary',
      description: null,
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      assignee: { displayName: 'Test User' },
      reporter: { displayName: 'Reporter Name' },
      labels: [],
      components: [],
      fixVersions: [],
      issuetype: { name: 'Story' },
      parent: undefined,
      subtasks: [],
      attachment: [],
      comment: { comments: [], total: 0 },
      created: '2024-01-15T10:00:00.000Z',
      updated: '2024-01-20T15:30:00.000Z',
    },
    ...overrides,
  };
}

/** Build a minimal ADF doc with a single paragraph of plain text */
function adfParagraph(text: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

/** Build an ADF doc with an "Acceptance Criteria" heading followed by bullet items */
function adfWithAC(...bullets: string[]) {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Acceptance Criteria' }],
      },
      ...bullets.map((b) => ({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: b }],
              },
            ],
          },
        ],
      })),
    ],
  };
}

/** Build an ADF comment body */
function adfComment(text: string) {
  return adfParagraph(text);
}

// ── formatIssueBrief tests ────────────────────────────────────────────────────

describe('formatIssueBrief — header', () => {
  it('includes the issue key in the header', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('CMPI-1234');
  });

  it('includes the summary in the header', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('Test issue summary');
  });

  it('formats header as "# Jira Task: KEY - Summary"', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('# Jira Task: CMPI-1234 - Test issue summary');
  });
});

describe('formatIssueBrief — status section', () => {
  it('shows the status name', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('In Progress');
  });

  it('shows the priority name', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('High');
  });

  it('shows the assignee display name', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('Test User');
  });

  it('shows the reporter display name', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('Reporter Name');
  });

  it('shows the issue type name', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('Story');
  });

  it('shows formatted created date (YYYY-MM-DD)', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('2024-01-15');
  });

  it('shows formatted updated date (YYYY-MM-DD)', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('2024-01-20');
  });

  it('shows labels when present', () => {
    const issue = makeIssue();
    issue.fields.labels = ['frontend', 'urgent'];
    const result = formatIssueBrief(issue);
    expect(result).toContain('frontend');
    expect(result).toContain('urgent');
  });

  it('does not show Labels line when labels array is empty', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).not.toContain('**Labels:**');
  });

  it('shows components when present', () => {
    const issue = makeIssue();
    issue.fields.components = [{ name: 'API' }, { name: 'Frontend' }];
    const result = formatIssueBrief(issue);
    expect(result).toContain('API');
    expect(result).toContain('Frontend');
  });
});

describe('formatIssueBrief — null fields show N/A', () => {
  it('shows N/A for null priority', () => {
    const issue = makeIssue();
    issue.fields.priority = null;
    const result = formatIssueBrief(issue);
    expect(result).toContain('**Priority:** N/A');
  });

  it('shows N/A for null assignee', () => {
    const issue = makeIssue();
    issue.fields.assignee = null;
    const result = formatIssueBrief(issue);
    expect(result).toContain('**Assignee:** N/A');
  });

  it('shows N/A for null reporter', () => {
    const issue = makeIssue();
    issue.fields.reporter = null;
    const result = formatIssueBrief(issue);
    expect(result).toContain('**Reporter:** N/A');
  });
});

describe('formatIssueBrief — description', () => {
  it('shows "No description provided." when description is null', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('No description provided.');
  });

  it('renders ADF description as markdown text', () => {
    const issue = makeIssue();
    issue.fields.description = adfParagraph('This is the description.');
    const result = formatIssueBrief(issue);
    expect(result).toContain('This is the description.');
  });

  it('has a ## Description section', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('## Description');
  });
});

describe('formatIssueBrief — acceptance criteria', () => {
  it('has a ## Acceptance Criteria section', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('## Acceptance Criteria');
  });

  it('shows fallback when no AC section exists', () => {
    const issue = makeIssue();
    issue.fields.description = adfParagraph('Just a plain description.');
    const result = formatIssueBrief(issue);
    expect(result).toContain('No explicit acceptance criteria found.');
  });

  it('extracts AC content when "Acceptance Criteria" heading is present', () => {
    const issue = makeIssue();
    issue.fields.description = adfWithAC('User can log in', 'User can log out');
    const result = formatIssueBrief(issue);
    // Should NOT show fallback
    expect(result).not.toContain('No explicit acceptance criteria found.');
    // Should contain the AC bullet content
    expect(result).toContain('User can log in');
  });

  it('shows fallback when description is null', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('No explicit acceptance criteria found.');
  });
});

describe('formatIssueBrief — comments', () => {
  it('has a ## Comments section', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('## Comments');
  });

  it('shows "No comments." when there are no comments', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('No comments.');
  });

  it('shows recent comment with author name and date', () => {
    const issue = makeIssue();
    issue.fields.comment = {
      total: 1,
      comments: [
        {
          id: 'c1',
          author: { displayName: 'Alice Smith' },
          body: adfComment('Great progress on this!'),
          created: '2024-01-18T09:00:00.000Z',
          updated: '2024-01-18T09:00:00.000Z',
        },
      ],
    };
    const result = formatIssueBrief(issue);
    expect(result).toContain('Alice Smith');
    expect(result).toContain('2024-01-18');
    expect(result).toContain('Great progress on this!');
  });

  it('formats comment as "**Author** (date):\\nbody"', () => {
    const issue = makeIssue();
    issue.fields.comment = {
      total: 1,
      comments: [
        {
          id: 'c1',
          author: { displayName: 'Bob Jones' },
          body: adfComment('LGTM!'),
          created: '2024-01-19T14:00:00.000Z',
          updated: '2024-01-19T14:00:00.000Z',
        },
      ],
    };
    const result = formatIssueBrief(issue);
    expect(result).toContain('**Bob Jones** (2024-01-19)');
  });

  it('shows only the most recent 5 comments', () => {
    const issue = makeIssue();
    issue.fields.comment = {
      total: 7,
      comments: Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`,
        author: { displayName: `User${i}` },
        body: adfComment(`Comment ${i}`),
        created: `2024-01-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
        updated: `2024-01-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
      })),
    };
    const result = formatIssueBrief(issue);
    // Should NOT contain the first two (oldest) comments
    expect(result).not.toContain('Comment 0');
    expect(result).not.toContain('Comment 1');
    // Should contain the last 5
    expect(result).toContain('Comment 2');
    expect(result).toContain('Comment 6');
  });

  it('filters out short status-transition noise comments', () => {
    const issue = makeIssue();
    issue.fields.comment = {
      total: 1,
      comments: [
        {
          id: 'c1',
          author: { displayName: 'Bot' },
          body: adfComment('Status changed'),
          created: '2024-01-18T09:00:00.000Z',
          updated: '2024-01-18T09:00:00.000Z',
        },
      ],
    };
    const result = formatIssueBrief(issue);
    expect(result).toContain('No comments.');
  });
});

describe('formatIssueBrief — attachments', () => {
  it('has a ## Attachments section', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('## Attachments');
  });

  it('shows "No attachments." when there are no attachments', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('No attachments.');
  });

  it('lists attachments with filename and URL', () => {
    const issue = makeIssue();
    issue.fields.attachment = [
      {
        filename: 'screenshot.png',
        content: 'https://jira.example.com/secure/attachment/1234/screenshot.png',
        mimeType: 'image/png',
      },
    ];
    const result = formatIssueBrief(issue);
    expect(result).toContain('screenshot.png');
    expect(result).toContain('https://jira.example.com/secure/attachment/1234/screenshot.png');
  });

  it('renders each attachment as a markdown link', () => {
    const issue = makeIssue();
    issue.fields.attachment = [
      {
        filename: 'report.pdf',
        content: 'https://example.com/report.pdf',
        mimeType: 'application/pdf',
      },
    ];
    const result = formatIssueBrief(issue);
    expect(result).toContain('[report.pdf](https://example.com/report.pdf)');
  });
});

describe('formatIssueBrief — subtasks / parent', () => {
  it('has a ## Subtasks / Linked Context section', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('## Subtasks / Linked Context');
  });

  it('shows "No subtasks or parent issue." when none exist', () => {
    const result = formatIssueBrief(makeIssue());
    expect(result).toContain('No subtasks or parent issue.');
  });

  it('shows parent issue when present', () => {
    const issue = makeIssue();
    issue.fields.parent = {
      key: 'CMPI-1000',
      fields: { summary: 'Parent epic' },
    };
    const result = formatIssueBrief(issue);
    expect(result).toContain('CMPI-1000');
    expect(result).toContain('Parent epic');
  });

  it('shows subtasks when present', () => {
    const issue = makeIssue();
    issue.fields.subtasks = [
      {
        key: 'CMPI-1235',
        fields: { summary: 'Subtask one', status: { name: 'To Do' } },
      },
    ];
    const result = formatIssueBrief(issue);
    expect(result).toContain('CMPI-1235');
    expect(result).toContain('Subtask one');
  });
});

// ── formatSearchResult tests ──────────────────────────────────────────────────

describe('formatSearchResult', () => {
  function makeSearchIssue(overrides: Partial<JiraSearchIssue> = {}): JiraSearchIssue {
    return {
      key: 'CMPI-1234',
      fields: {
        summary: 'Test summary',
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        updated: '2024-01-20T15:30:00.000Z',
      },
      ...overrides,
    };
  }

  it('returns "No issues found." when list is empty', () => {
    const result = formatSearchResult([]);
    expect(result).toContain('No issues found.');
  });

  it('includes a markdown table header with expected columns', () => {
    const result = formatSearchResult([makeSearchIssue()]);
    expect(result).toContain('| Key |');
    expect(result).toContain('| Summary |');
    expect(result).toContain('| Status |');
    expect(result).toContain('| Priority |');
    expect(result).toContain('| Updated |');
  });

  it('includes a table separator row', () => {
    const result = formatSearchResult([makeSearchIssue()]);
    expect(result).toContain('|-----|');
  });

  it('renders issue key in the table', () => {
    const result = formatSearchResult([makeSearchIssue()]);
    expect(result).toContain('CMPI-1234');
  });

  it('renders issue summary in the table', () => {
    const result = formatSearchResult([makeSearchIssue()]);
    expect(result).toContain('Test summary');
  });

  it('renders status in the table', () => {
    const result = formatSearchResult([makeSearchIssue()]);
    expect(result).toContain('In Progress');
  });

  it('renders priority in the table', () => {
    const result = formatSearchResult([makeSearchIssue()]);
    expect(result).toContain('High');
  });

  it('renders formatted date in the table', () => {
    const result = formatSearchResult([makeSearchIssue()]);
    expect(result).toContain('2024-01-20');
  });

  it('uses generic header when no project key provided', () => {
    const result = formatSearchResult([]);
    expect(result).toContain('My Open Issues');
    expect(result).not.toContain('CMPI');
  });

  it('uses custom project key in the header when provided', () => {
    const result = formatSearchResult([], 'MYPROJECT');
    expect(result).toContain('MYPROJECT');
  });

  it('renders multiple issues as multiple rows', () => {
    const issues = [
      makeSearchIssue({ key: 'CMPI-0001' }),
      makeSearchIssue({ key: 'CMPI-0002' }),
      makeSearchIssue({ key: 'CMPI-0003' }),
    ];
    const result = formatSearchResult(issues);
    expect(result).toContain('CMPI-0001');
    expect(result).toContain('CMPI-0002');
    expect(result).toContain('CMPI-0003');
  });

  it('shows N/A for null priority in search results', () => {
    const issue = makeSearchIssue();
    issue.fields.priority = null;
    const result = formatSearchResult([issue]);
    expect(result).toContain('N/A');
  });
});
