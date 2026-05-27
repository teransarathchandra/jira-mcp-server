import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchIssueContext,
  type ContextFetchOptions,
} from "../src/jira/issueContextService.js";
import type { JiraClient, JiraIssue, JiraMinimalIssue, JiraComment } from "../src/jiraClient.js";
import type { Config } from "../src/config.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeComment(id: string): JiraComment {
  return {
    id,
    author: { displayName: "Alice" },
    body: null,
    created: "2024-01-01T00:00:00.000Z",
    updated: "2024-01-01T00:00:00.000Z",
  };
}

function makeIssue(
  commentOverrides: Partial<{
    comments: JiraComment[];
    total: number;
    startAt: number;
    maxResults: number;
  }> = {}
): JiraIssue {
  return {
    id: "10001",
    key: "PROJ-1",
    fields: {
      summary: "Test issue",
      description: null,
      status: { name: "In Progress" },
      priority: null,
      assignee: null,
      reporter: null,
      labels: [],
      components: [],
      fixVersions: [],
      issuetype: { name: "Story" },
      subtasks: [],
      attachment: [],
      comment: {
        comments: [makeComment("c1")],
        total: 1,
        ...commentOverrides,
      },
      created: "2024-01-01T00:00:00.000Z",
      updated: "2024-01-01T00:00:00.000Z",
      issuelinks: [],
    },
  };
}

function makeConfig(): Config {
  return {
    baseUrl: "https://example.atlassian.net",
    email: "test@example.com",
    apiToken: "secret",
    epicFieldId: null,
    storyPointsFieldId: null,
    acceptanceCriteriaFieldId: null,
    teamFieldId: null,
    highAuthorityEmails: [],
    highAuthorityAccountIds: [],
    maxContextChars: 30000,
    projectConfig: {
      defaultProjectKey: "PROJ",
      allowedProjectKeys: ["PROJ"],
      issueKeyPattern: /^[A-Z]+-\d+$/,
      strictProjectAllowlist: false,
      exampleIssueKey: "PROJ-1",
    },
    clientProfile: "default" as unknown as Config["clientProfile"],
  };
}

function makeOptions(overrides: Partial<ContextFetchOptions> = {}): ContextFetchOptions {
  return {
    includeComments: true,
    includeParent: false,
    includeEpic: false,
    includeLinkedIssues: false,
    includeSubtasks: false,
    includeEpicSiblings: false,
    maxLinkedIssues: 5,
    maxSubtasks: 5,
    maxCommentsPerIssue: 10,
    contextDepth: 1,
    ...overrides,
  };
}

function makeMockClient(
  issue: JiraIssue,
  overrides: Partial<JiraClient> = {}
): JiraClient {
  return {
    getIssue: vi.fn().mockResolvedValue(issue),
    getIssueMinimal: vi.fn().mockResolvedValue(null),
    getIssueComments: vi.fn().mockResolvedValue({ comments: [], total: 0, startAt: 0, maxResults: 50 }),
    searchIssues: vi.fn().mockResolvedValue({ issues: [], total: 0 }),
    issueCache: { get: vi.fn(), set: vi.fn() } as unknown as JiraClient["issueCache"],
    minimalCache: { get: vi.fn(), set: vi.fn() } as unknown as JiraClient["minimalCache"],
    searchCache: { get: vi.fn(), set: vi.fn() } as unknown as JiraClient["searchCache"],
    ...overrides,
  } as unknown as JiraClient;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("fetchIssueContext — comment pagination", () => {
  it("does not call getIssueComments when total equals comments.length", async () => {
    // API already returned all comments — no extra page fetch needed
    const issue = makeIssue({ comments: [makeComment("c1"), makeComment("c2")], total: 2 });
    const client = makeMockClient(issue);
    const config = makeConfig();
    const options = makeOptions({ includeComments: true, maxCommentsPerIssue: 10 });

    const ctx = await fetchIssueContext("PROJ-1", options, client, config);

    expect(client.getIssueComments).not.toHaveBeenCalled();
    expect(ctx.mainIssue.fields.comment.comments).toHaveLength(2);
    expect(ctx.truncationWarnings).toHaveLength(0);
  });

  it("does not call getIssueComments when includeComments is false", async () => {
    // Even if pagination would be needed, skip it when includeComments=false
    const issue = makeIssue({ comments: [makeComment("c1")], total: 10 });
    const client = makeMockClient(issue);
    const config = makeConfig();
    const options = makeOptions({ includeComments: false, maxCommentsPerIssue: 10 });

    const ctx = await fetchIssueContext("PROJ-1", options, client, config);

    expect(client.getIssueComments).not.toHaveBeenCalled();
    // comments remain as-is (only what the main issue fetch returned)
    expect(ctx.mainIssue.fields.comment.comments).toHaveLength(1);
  });

  it("paginates when total > comments.length and includeComments is true", async () => {
    // Simulate Jira Cloud returning 2 of 5 comments on the initial issue fetch
    const initialComments = [makeComment("c1"), makeComment("c2")];
    const issue = makeIssue({ comments: initialComments, total: 5 });

    // Mock getIssueComments to return the remaining 3 comments
    const remainingComments = [makeComment("c3"), makeComment("c4"), makeComment("c5")];
    const getIssueComments = vi.fn().mockResolvedValueOnce({
      comments: remainingComments,
      total: 5,
      startAt: 2,
      maxResults: 50,
    });

    const client = makeMockClient(issue, { getIssueComments });
    const config = makeConfig();
    const options = makeOptions({ includeComments: true, maxCommentsPerIssue: 10 });

    const ctx = await fetchIssueContext("PROJ-1", options, client, config);

    expect(getIssueComments).toHaveBeenCalledOnce();
    expect(getIssueComments).toHaveBeenCalledWith("PROJ-1", 2, expect.any(Number));
    expect(ctx.mainIssue.fields.comment.comments).toHaveLength(5);
    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual([
      "c1", "c2", "c3", "c4", "c5",
    ]);
    expect(ctx.truncationWarnings).toHaveLength(0);
  });

  it("adds truncation warning when paginated comments are capped at maxCommentsPerIssue", async () => {
    // 1 comment returned initially, 30 total, but cap is 5
    const issue = makeIssue({ comments: [makeComment("c1")], total: 30 });

    // Mock returns 4 more to reach the cap of 5
    const page1Comments = [makeComment("c2"), makeComment("c3"), makeComment("c4"), makeComment("c5")];
    const getIssueComments = vi.fn().mockResolvedValueOnce({
      comments: page1Comments,
      total: 30,
      startAt: 1,
      maxResults: 4,
    });

    const client = makeMockClient(issue, { getIssueComments });
    const config = makeConfig();
    const options = makeOptions({ includeComments: true, maxCommentsPerIssue: 5 });

    const ctx = await fetchIssueContext("PROJ-1", options, client, config);

    expect(ctx.mainIssue.fields.comment.comments).toHaveLength(5);
    expect(ctx.truncationWarnings).toHaveLength(1);
    expect(ctx.truncationWarnings[0]).toMatch(/Comments truncated: showing 5 of 30/);
    expect(ctx.truncationWarnings[0]).toMatch(/maxCommentsPerIssue cap=5/);
  });

  it("stops pagination loop on empty page to prevent infinite loop", async () => {
    // API says 10 total but returns empty pages — safety break must fire
    const issue = makeIssue({ comments: [makeComment("c1")], total: 10 });

    // getIssueComments always returns empty (simulates a buggy API)
    const getIssueComments = vi.fn().mockResolvedValue({
      comments: [],
      total: 10,
      startAt: 1,
      maxResults: 50,
    });

    const client = makeMockClient(issue, { getIssueComments });
    const config = makeConfig();
    const options = makeOptions({ includeComments: true, maxCommentsPerIssue: 10 });

    const ctx = await fetchIssueContext("PROJ-1", options, client, config);

    // Called once, then loop breaks because page.comments.length === 0
    expect(getIssueComments).toHaveBeenCalledOnce();
    // Only the original 1 comment is present
    expect(ctx.mainIssue.fields.comment.comments).toHaveLength(1);
  });

  it("does not paginate when initial comments.length already meets the cap, but emits truncation warning", async () => {
    // cap is 3 (maxCommentsPerIssue=3), API already returned 3 of 10 — no page needed
    // but we must still warn that comments were truncated (Issue 2 fix)
    const issue = makeIssue({
      comments: [makeComment("c1"), makeComment("c2"), makeComment("c3")],
      total: 10,
    });
    const client = makeMockClient(issue);
    const config = makeConfig();
    const options = makeOptions({ includeComments: true, maxCommentsPerIssue: 3 });

    const ctx = await fetchIssueContext("PROJ-1", options, client, config);

    expect(client.getIssueComments).not.toHaveBeenCalled();
    expect(ctx.mainIssue.fields.comment.comments).toHaveLength(3);
    // FIX 2: truncation warning must fire even though pagination block was skipped
    expect(ctx.truncationWarnings).toHaveLength(1);
    expect(ctx.truncationWarnings[0]).toMatch(/Comments truncated: showing 3 of 10/);
    expect(ctx.truncationWarnings[0]).toMatch(/maxCommentsPerIssue cap=3/);
  });

  it("caps comments at maxCommentsPerIssue when API returns more items than requested (overshoot)", async () => {
    // Simulate a non-conformant API returning 5 comments when only 3 were remaining to cap
    // Initial: 1 comment, total: 10, cap: 4
    const issue = makeIssue({ comments: [makeComment("c1")], total: 10 });

    // API returns 5 comments even though we asked for Math.min(3, 50)=3
    const overshotComments = [
      makeComment("c2"), makeComment("c3"), makeComment("c4"),
      makeComment("c5"), makeComment("c6"),
    ];
    const getIssueComments = vi.fn().mockResolvedValueOnce({
      comments: overshotComments,
      total: 10,
      startAt: 1,
      maxResults: 5, // non-conformant: returned more than asked
    });

    const client = makeMockClient(issue, { getIssueComments });
    const config = makeConfig();
    const options = makeOptions({ includeComments: true, maxCommentsPerIssue: 4 });

    const ctx = await fetchIssueContext("PROJ-1", options, client, config);

    // Must be capped at 4, not 6
    expect(ctx.mainIssue.fields.comment.comments).toHaveLength(4);
    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual([
      "c1", "c2", "c3", "c4",
    ]);
    expect(ctx.truncationWarnings).toHaveLength(1);
    expect(ctx.truncationWarnings[0]).toMatch(/Comments truncated: showing 4 of 10/);
  });

  it("paginates across multiple pages until cap is reached", async () => {
    // Initial: 1 comment, total: 20, cap: 5 — needs two getIssueComments calls
    const issue = makeIssue({ comments: [makeComment("c1")], total: 20 });

    const getIssueComments = vi
      .fn()
      .mockResolvedValueOnce({
        comments: [makeComment("c2"), makeComment("c3")],
        total: 20,
        startAt: 1,
        maxResults: 2,
      })
      .mockResolvedValueOnce({
        comments: [makeComment("c4"), makeComment("c5")],
        total: 20,
        startAt: 3,
        maxResults: 2,
      });

    const client = makeMockClient(issue, { getIssueComments });
    const config = makeConfig();
    const options = makeOptions({ includeComments: true, maxCommentsPerIssue: 5 });

    const ctx = await fetchIssueContext("PROJ-1", options, client, config);

    expect(getIssueComments).toHaveBeenCalledTimes(2);
    expect(ctx.mainIssue.fields.comment.comments).toHaveLength(5);
    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual([
      "c1", "c2", "c3", "c4", "c5",
    ]);
    expect(ctx.truncationWarnings).toHaveLength(1);
    expect(ctx.truncationWarnings[0]).toMatch(/Comments truncated: showing 5 of 20/);
  });
});
