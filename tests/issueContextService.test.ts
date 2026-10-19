import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchIssueContext,
  type ContextFetchOptions,
} from "../src/jira/issueContextService.js";
import type { JiraClient, JiraIssue, JiraMinimalIssue, JiraComment } from "../src/jiraClient.js";
import type { Config } from "../src/config.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeComment(id: string): JiraComment {
  // "c7" is created on day 7, so comment ids sort the same way as their dates.
  const day = String(Number(id.replace(/\D/g, "")) || 1).padStart(2, "0");
  return {
    id,
    author: { displayName: "Alice" },
    body: null,
    created: `2024-01-${day}T00:00:00.000Z`,
    updated: `2024-01-${day}T00:00:00.000Z`,
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

  // Defect 3 (R2): Jira pages comments oldest-first, so the old forward
  // pagination kept the oldest comments and dropped the newest. The server now
  // asks for the newest `cap` comments in one call and sorts them oldest-first.
  it("fetches the newest page when total > comments.length and returns it chronologically", async () => {
    const issue = makeIssue({ comments: [makeComment("c1"), makeComment("c2")], total: 5 });
    const getIssueComments = vi.fn().mockResolvedValueOnce({
      comments: ["c5", "c4", "c3", "c2", "c1"].map(makeComment),
      total: 5,
      startAt: 0,
      maxResults: 10,
    });
    const client = makeMockClient(issue, { getIssueComments });

    const ctx = await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 10 }), client, makeConfig());

    expect(getIssueComments).toHaveBeenCalledOnce();
    expect(getIssueComments).toHaveBeenCalledWith("PROJ-1", 0, 10, "-created");
    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(ctx.truncationWarnings).toHaveLength(0);
    expect(ctx.evidence.comments).toBe("observed");
  });

  it("keeps the newest comments and warns when total exceeds the cap", async () => {
    const issue = makeIssue({ comments: [makeComment("c1")], total: 30 });
    const getIssueComments = vi.fn().mockResolvedValueOnce({
      comments: ["c30", "c29", "c28", "c27", "c26"].map(makeComment),
      total: 30,
      startAt: 0,
      maxResults: 5,
    });
    const client = makeMockClient(issue, { getIssueComments });

    const ctx = await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 5 }), client, makeConfig());

    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual(["c26", "c27", "c28", "c29", "c30"]);
    expect(ctx.truncationWarnings).toHaveLength(1);
    expect(ctx.truncationWarnings[0]).toMatch(/Comments truncated: showing the newest 5 of 30/);
    expect(ctx.truncationWarnings[0]).toMatch(/maxCommentsPerIssue cap=5/);
    expect(ctx.evidence.comments).toBe("truncated");
  });

  it("keeps the inline comments when the newest page comes back empty", async () => {
    const issue = makeIssue({ comments: [makeComment("c1")], total: 10 });
    const getIssueComments = vi.fn().mockResolvedValue({ comments: [], total: 10, startAt: 0, maxResults: 10 });
    const client = makeMockClient(issue, { getIssueComments });

    const ctx = await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 10 }), client, makeConfig());

    expect(getIssueComments).toHaveBeenCalledOnce();
    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual(["c1"]);
  });

  it("fetches the newest page even when the inline set already fills the cap", async () => {
    const issue = makeIssue({ comments: ["c1", "c2", "c3"].map(makeComment), total: 10 });
    const getIssueComments = vi.fn().mockResolvedValueOnce({
      comments: ["c10", "c9", "c8"].map(makeComment),
      total: 10,
      startAt: 0,
      maxResults: 3,
    });
    const client = makeMockClient(issue, { getIssueComments });

    const ctx = await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 3 }), client, makeConfig());

    expect(getIssueComments).toHaveBeenCalledWith("PROJ-1", 0, 3, "-created");
    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual(["c8", "c9", "c10"]);
    expect(ctx.truncationWarnings[0]).toMatch(/Comments truncated: showing the newest 3 of 10/);
  });

  it("caps comments at maxCommentsPerIssue when the API returns more than requested", async () => {
    const issue = makeIssue({ comments: [makeComment("c1")], total: 10 });
    const getIssueComments = vi.fn().mockResolvedValueOnce({
      comments: ["c10", "c9", "c8", "c7", "c6", "c5"].map(makeComment),
      total: 10,
      startAt: 0,
      maxResults: 6, // non-conformant: returned more than asked
    });
    const client = makeMockClient(issue, { getIssueComments });

    const ctx = await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 4 }), client, makeConfig());

    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual(["c7", "c8", "c9", "c10"]);
    expect(ctx.truncationWarnings[0]).toMatch(/Comments truncated: showing the newest 4 of 10/);
  });

  // R2 minor 3: when Jira already returned every comment inline, the newest
  // ones are on hand; no extra request is needed.
  it("uses the newest inline comments without a request when Jira returned all of them", async () => {
    const issue = makeIssue({ comments: ["c1", "c2", "c3"].map(makeComment), total: 3 });
    const client = makeMockClient(issue);

    const ctx = await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 2 }), client, makeConfig());

    expect(client.getIssueComments).not.toHaveBeenCalled();
    expect(ctx.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(ctx.truncationWarnings[0]).toMatch(/Comments truncated: showing the newest 2 of 3/);
    expect(ctx.truncationWarnings[0]).toMatch(/maxCommentsPerIssue cap=2/);
  });

  it("keeps no comments when the cap is 0", async () => {
    const issue = makeIssue({ comments: ["c1", "c2", "c3"].map(makeComment), total: 10 });
    const getIssueComments = vi.fn().mockResolvedValue({ comments: [], total: 10, startAt: 0, maxResults: 0 });
    const client = makeMockClient(issue, { getIssueComments });

    const ctx = await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 0 }), client, makeConfig());

    expect(ctx.mainIssue.fields.comment.comments).toEqual([]);
  });

  // R2 minor 4: the client caches issue objects; context building must not edit them.
  it("does not modify the issue object returned by the client", async () => {
    const issue = makeIssue({ comments: ["c1", "c2", "c3"].map(makeComment), total: 3 });
    const client = makeMockClient(issue);

    await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 2 }), client, makeConfig());

    expect(issue.fields.comment.comments.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("asks for at most `cap` newest comments in a single request", async () => {
    const issue = makeIssue({ comments: [makeComment("c1")], total: 20 });
    const getIssueComments = vi.fn().mockResolvedValueOnce({
      comments: ["c20", "c19", "c18", "c17", "c16"].map(makeComment),
      total: 20,
      startAt: 0,
      maxResults: 5,
    });
    const client = makeMockClient(issue, { getIssueComments });

    await fetchIssueContext("PROJ-1", makeOptions({ maxCommentsPerIssue: 5 }), client, makeConfig());

    expect(getIssueComments).toHaveBeenCalledTimes(1);
    expect(getIssueComments).toHaveBeenCalledWith("PROJ-1", 0, 5, "-created");
  });
});
