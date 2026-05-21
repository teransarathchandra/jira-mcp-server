import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchConfluenceContext,
  type ConfluenceContextOptions,
  type ConfluenceContext,
} from "../src/confluence/confluenceContextService.js";
import {
  formatRelatedPagesOutput,
  formatPageSummaryOutput,
} from "../src/confluence/formatConfluenceSummary.js";
import type { ConfluenceClient, ConfluencePage } from "../src/confluence/confluenceClient.js";
import type { ConfluenceConfig } from "../src/confluence/confluenceConfig.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function recentIso(): string {
  return new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
}

function makeConfig(overrides: Partial<ConfluenceConfig> = {}): ConfluenceConfig {
  return {
    baseUrl: "https://example.atlassian.net/wiki",
    email: "test@example.com",
    apiToken: "secret",
    spaceKeys: ["ENG"],
    maxSearchResults: 10,
    maxPagesToRead: 5,
    maxPageChars: 12000,
    enabled: true,
    includeArchived: false,
    requireSpaceAllowlist: true,
    labelBoosts: ["requirements", "prd"],
    excludeLabels: ["deprecated", "archive"],
    titleBoostTerms: ["requirement", "spec", "design"],
    ...overrides,
  };
}

function makePage(overrides: Partial<ConfluencePage> = {}): ConfluencePage {
  return {
    id: "page-1",
    title: "Some Page",
    type: "page",
    status: "current",
    space: { key: "ENG", name: "Engineering" },
    version: { number: 1, when: recentIso() },
    ancestors: [],
    metadata: { labels: { results: [] } },
    _links: { webui: "/spaces/ENG/pages/page-1/Some+Page", base: "https://example.atlassian.net/wiki" },
    ...overrides,
  };
}

function makeOptions(overrides: Partial<ConfluenceContextOptions> = {}): ConfluenceContextOptions {
  return {
    jiraIssueKey: "PROJ-100",
    jiraSummary: "Build user authentication feature",
    jiraLabels: [],
    jiraComponents: [],
    jiraTechnicalTerms: [],
    jiraBusinessTerms: [],
    jiraLinkedIssueSummaries: [],
    confluenceLinksFromJira: [],
    ...overrides,
  };
}

/** Build a mock ConfluenceClient using vi.fn(). */
function makeMockClient(
  overrides: Partial<ConfluenceClient> = {}
): ConfluenceClient {
  return {
    searchContentByCql: vi.fn().mockResolvedValue({ results: [], start: 0, limit: 10, size: 0 }),
    getPageById: vi.fn().mockRejectedValue(new Error("not found")),
    getPageBody: vi.fn().mockResolvedValue(""),
    getPageLabels: vi.fn().mockResolvedValue([]),
    getPageAncestors: vi.fn().mockResolvedValue([]),
    getPageChildren: vi.fn().mockResolvedValue([]),
    getPageUrl: vi.fn().mockImplementation((page: ConfluencePage) => {
      const base = page._links.base ?? "https://example.atlassian.net/wiki";
      return base + page._links.webui;
    }),
    ...overrides,
  } as unknown as ConfluenceClient;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("fetchConfluenceContext — empty results", () => {
  it("returns empty ConfluenceContext when search returns no results", async () => {
    const client = makeMockClient();
    const config = makeConfig();
    const options = makeOptions();

    const ctx = await fetchConfluenceContext(options, client, config);

    expect(ctx.pagesSearched).toBe(0);
    expect(ctx.pagesRead).toBe(0);
    expect(ctx.highRelevancePages).toHaveLength(0);
    expect(ctx.mediumRelevancePages).toHaveLength(0);
    expect(ctx.omittedCount).toBe(0);
    expect(ctx.lowRelevancePagesCount).toBe(0);
    // Should warn about no relevant pages
    expect(ctx.budgetWarnings.some((w) => w.includes("No relevant"))).toBe(true);
  });
});

describe("fetchConfluenceContext — deduplication", () => {
  it("deduplicates pages with same pageId from multiple queries", async () => {
    const page = makePage({ id: "dup-page" });

    // Every query returns the same page
    const client = makeMockClient({
      searchContentByCql: vi.fn().mockResolvedValue({
        results: [page],
        start: 0,
        limit: 10,
        size: 1,
      }),
    });

    const ctx = await fetchConfluenceContext(makeOptions(), client, makeConfig());

    // Multiple queries run but the page should only appear once
    expect(ctx.pagesSearched).toBe(1);
  });
});

describe("fetchConfluenceContext — relevance scoring", () => {
  it("page with issueKey in body reaches HIGH_RELEVANCE (score >= 50 with directlyLinked)", async () => {
    const issueKey = "PROJ-100";
    const numericPageId = "987654";
    const page = makePage({
      id: numericPageId,
      title: "Authentication Feature Design",
      body: {
        view: {
          value: `<p>This page covers ${issueKey} in detail. It was directly linked from the issue.</p>`,
        },
      },
    });

    // The page is directly linked from Jira (comes from getPageById)
    const client = makeMockClient({
      searchContentByCql: vi.fn().mockResolvedValue({ results: [], start: 0, limit: 10, size: 0 }),
      getPageById: vi.fn().mockResolvedValue(page),
    });

    const options = makeOptions({
      jiraIssueKey: issueKey,
      // Use a numeric page ID in the URL so extractPageIdsFromLinks can parse it
      confluenceLinksFromJira: [`https://example.atlassian.net/wiki/spaces/ENG/pages/${numericPageId}/Auth+Feature`],
    });

    const ctx = await fetchConfluenceContext(options, client, makeConfig());

    // Page body has the issue key AND is directly linked → should be HIGH_RELEVANCE
    const allPages = [
      ...ctx.highRelevancePages,
      ...ctx.mediumRelevancePages,
    ];
    expect(allPages.length).toBeGreaterThan(0);
    const found = allPages.find((p) => p.pageId === numericPageId);
    expect(found).toBeDefined();
    if (found) {
      // +40 (issue key) + +30 (directly linked) = 70 → HIGH
      expect(found.relevanceLevel).toBe("HIGH_RELEVANCE");
    }
  });
});

describe("fetchConfluenceContext — budget limit on body reads", () => {
  it("only reads body for up to maxPagesToRead pages", async () => {
    // 4 pages from search, none with bodies
    const pages: ConfluencePage[] = [1, 2, 3, 4].map((i) =>
      makePage({ id: `page-${i}`, title: `Page ${i}` })
    );

    const getPageBodyMock = vi.fn().mockResolvedValue("<p>Some content</p>");

    const client = makeMockClient({
      searchContentByCql: vi.fn().mockResolvedValue({
        results: pages,
        start: 0,
        limit: 10,
        size: pages.length,
      }),
      getPageBody: getPageBodyMock,
    });

    // Restrict maxPagesToRead to 2
    const config = makeConfig({ maxPagesToRead: 2 });
    const ctx = await fetchConfluenceContext(makeOptions(), client, config);

    // getPageBody should be called at most maxPagesToRead times
    expect(getPageBodyMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(ctx.pagesRead).toBeLessThanOrEqual(2);
  });
});

describe("fetchConfluenceContext — budget warning when no pages found", () => {
  it("adds budget warning when no HIGH/MEDIUM pages found", async () => {
    const client = makeMockClient(); // returns empty results

    const ctx = await fetchConfluenceContext(makeOptions(), client, makeConfig());

    expect(ctx.budgetWarnings.some((w) => w.includes("No relevant"))).toBe(true);
    expect(ctx.budgetWarnings.some((w) => w.includes("PROJ-100"))).toBe(true);
  });
});

describe("fetchConfluenceContext — directly linked pages", () => {
  it("directly linked pages from Jira are fetched via getPageById", async () => {
    const linkedPageId = "12345";
    const linkedPage = makePage({
      id: linkedPageId,
      title: "Linked Spec Page",
      body: { view: { value: "<p>Linked content</p>" } },
    });

    const getPageByIdMock = vi.fn().mockResolvedValue(linkedPage);

    const client = makeMockClient({
      searchContentByCql: vi.fn().mockResolvedValue({ results: [], start: 0, limit: 10, size: 0 }),
      getPageById: getPageByIdMock,
    });

    const options = makeOptions({
      confluenceLinksFromJira: [
        `https://example.atlassian.net/wiki/spaces/ENG/pages/${linkedPageId}/Some+Page`,
      ],
    });

    await fetchConfluenceContext(options, client, makeConfig());

    expect(getPageByIdMock).toHaveBeenCalledWith(linkedPageId);
  });
});

describe("fetchConfluenceContext — 403 error handling", () => {
  it("handles 403 on a page gracefully, skips page and adds to warnings", async () => {
    const goodPage = makePage({ id: "good-page", title: "Good Page" });
    const badPageId = "99999";

    const client = makeMockClient({
      searchContentByCql: vi.fn().mockResolvedValue({
        results: [goodPage],
        start: 0,
        limit: 10,
        size: 1,
      }),
      getPageById: vi.fn().mockImplementation((id: string) => {
        if (id === badPageId) {
          return Promise.reject(new Error("Confluence access denied. This page may be restricted."));
        }
        return Promise.resolve(goodPage);
      }),
    });

    const options = makeOptions({
      confluenceLinksFromJira: [
        `https://example.atlassian.net/wiki/spaces/ENG/pages/${badPageId}/restricted`,
      ],
    });

    // Should not throw
    const ctx = await fetchConfluenceContext(options, client, makeConfig());

    // Warning about the inaccessible page
    expect(ctx.warnings.some((w) => w.includes(badPageId))).toBe(true);
    // Good page still processed
    expect(ctx.pagesSearched).toBeGreaterThanOrEqual(1);
  });
});

describe("fetchConfluenceContext — OMIT pages excluded", () => {
  it("OMIT-level pages are not included in any relevance bucket", async () => {
    // A page with no relevant signals at all → OMIT
    const irrelevantPage = makePage({
      id: "irrelevant-page",
      title: "Completely Unrelated Document",
      body: { view: { value: "<p>Nothing related here whatsoever.</p>" } },
    });

    const client = makeMockClient({
      searchContentByCql: vi.fn().mockResolvedValue({
        results: [irrelevantPage],
        start: 0,
        limit: 10,
        size: 1,
      }),
    });

    const config = makeConfig({ spaceKeys: [] }); // no space bonus
    const ctx = await fetchConfluenceContext(makeOptions(), client, config);

    expect(ctx.highRelevancePages).toHaveLength(0);
    expect(ctx.mediumRelevancePages).toHaveLength(0);
    // OMIT count may or may not be 1 depending on final score;
    // what matters is the page is not in high or medium
    const allIncluded = [
      ...ctx.highRelevancePages,
      ...ctx.mediumRelevancePages,
    ];
    expect(allIncluded.find((p) => p.pageId === "irrelevant-page")).toBeUndefined();
  });
});

// ── formatRelatedPagesOutput tests ────────────────────────────────────────────

describe("formatRelatedPagesOutput", () => {
  it("renders HIGH and MEDIUM sections correctly", () => {
    const highPage = {
      pageId: "h1",
      title: "High Relevance Page",
      url: "https://example.atlassian.net/wiki/spaces/ENG/pages/h1",
      space: "Engineering",
      spaceKey: "ENG",
      lastUpdated: "2025-01-15T10:00:00.000Z",
      version: 3,
      labels: ["prd"],
      relevanceLevel: "HIGH_RELEVANCE" as const,
      relevanceScore: 70,
      relevanceReasons: ["page body contains Jira issue key \"PROJ-100\" (+40)", "page is directly linked from Jira issue (+30)"],
      authorityLevel: "AUTHORITATIVE" as const,
      authorityReasons: [],
      isStale: false,
      bodyMarkdown: "## Overview\nThis is the PRD.",
      bodyTruncated: false,
      signals: {
        businessRules: [],
        userRoles: [],
        apiEndpoints: [],
        uiScreens: [],
        tableNames: [],
        validationRules: [],
        featureFlags: [],
        permissions: [],
        releaseNotes: [],
        knownLimitations: [],
        dependencies: [],
        testingNotes: [],
        diagramsMentioned: [],
        relatedPageLinks: [],
      },
      sections: [{ heading: "Overview", level: 2, content: "This is the PRD." }],
    };

    const mediumPage = {
      ...highPage,
      pageId: "m1",
      title: "Medium Relevance Page",
      relevanceLevel: "MEDIUM_RELEVANCE" as const,
      relevanceScore: 30,
      relevanceReasons: ["page is directly linked from Jira issue (+30)"],
      authorityLevel: "SUPPORTING" as const,
    };

    const ctx: ConfluenceContext = {
      pagesSearched: 5,
      pagesRead: 2,
      highRelevancePages: [highPage],
      mediumRelevancePages: [mediumPage],
      lowRelevancePagesCount: 2,
      omittedCount: 1,
      warnings: [],
      budgetWarnings: [],
    };

    const output = formatRelatedPagesOutput(ctx, "PROJ-100");

    expect(output).toContain("# Related Confluence Pages for PROJ-100");
    expect(output).toContain("## High Relevance");
    expect(output).toContain("**High Relevance Page**");
    expect(output).toContain("AUTHORITATIVE");
    expect(output).toContain("## Medium Relevance");
    expect(output).toContain("**Medium Relevance Page**");
    expect(output).toContain("## Omitted");
    expect(output).toContain("3 low-relevance pages omitted");
    expect(output).toContain("Searched 5 pages total. Read 2 page bodies.");
  });

  it("shows 'No high-relevance pages found.' when high list is empty", () => {
    const ctx: ConfluenceContext = {
      pagesSearched: 1,
      pagesRead: 0,
      highRelevancePages: [],
      mediumRelevancePages: [],
      lowRelevancePagesCount: 0,
      omittedCount: 0,
      warnings: [],
      budgetWarnings: ["No relevant Confluence pages found for PROJ-100."],
    };

    const output = formatRelatedPagesOutput(ctx, "PROJ-100");
    expect(output).toContain("No high-relevance pages found.");
    expect(output).toContain("No relevant Confluence pages found for PROJ-100.");
  });

  it("omits Medium Relevance section when there are no medium pages", () => {
    const ctx: ConfluenceContext = {
      pagesSearched: 1,
      pagesRead: 0,
      highRelevancePages: [],
      mediumRelevancePages: [],
      lowRelevancePagesCount: 0,
      omittedCount: 0,
      warnings: [],
      budgetWarnings: [],
    };

    const output = formatRelatedPagesOutput(ctx, "PROJ-100");
    expect(output).not.toContain("## Medium Relevance");
  });

  it("omits Omitted section when omittedCount and lowRelevancePagesCount are 0", () => {
    const ctx: ConfluenceContext = {
      pagesSearched: 0,
      pagesRead: 0,
      highRelevancePages: [],
      mediumRelevancePages: [],
      lowRelevancePagesCount: 0,
      omittedCount: 0,
      warnings: [],
      budgetWarnings: [],
    };

    const output = formatRelatedPagesOutput(ctx, "PROJ-100");
    expect(output).not.toContain("## Omitted");
  });
});

// ── formatPageSummaryOutput tests ─────────────────────────────────────────────

describe("formatPageSummaryOutput", () => {
  it("renders metadata and signals correctly", () => {
    const page = {
      pageId: "abc123",
      title: "Authentication Architecture",
      url: "https://example.atlassian.net/wiki/spaces/ENG/pages/abc123",
      space: "Engineering",
      spaceKey: "ENG",
      lastUpdated: "2025-03-01T08:00:00.000Z",
      version: 7,
      labels: ["architecture", "prd"],
      relevanceLevel: "HIGH_RELEVANCE" as const,
      relevanceScore: 75,
      relevanceReasons: [],
      authorityLevel: "AUTHORITATIVE" as const,
      authorityReasons: [],
      isStale: false,
      bodyMarkdown: "## Overview\nThis describes the OAuth2 flow.\n\n## API Endpoints\nGET /auth/token",
      bodyTruncated: false,
      signals: {
        businessRules: [],
        userRoles: ["admin", "user"],
        apiEndpoints: ["GET /auth/token"],
        uiScreens: [],
        tableNames: [],
        validationRules: [],
        featureFlags: [],
        permissions: [],
        releaseNotes: [],
        knownLimitations: [],
        dependencies: [],
        testingNotes: [],
        diagramsMentioned: [],
        relatedPageLinks: ["[Auth Flow](https://example.atlassian.net/wiki/spaces/ENG/pages/999)"],
      },
      sections: [
        { heading: "Overview", level: 2, content: "OAuth2 flow" },
        { heading: "API Endpoints", level: 2, content: "GET /auth/token" },
      ],
    };

    const output = formatPageSummaryOutput(page);

    expect(output).toContain("# Confluence Page Summary: Authentication Architecture");
    expect(output).toContain("## Metadata");
    expect(output).toContain("Space: Engineering (ENG)");
    expect(output).toContain("Page ID: abc123");
    expect(output).toContain("Last updated: 2025-03-01");
    expect(output).toContain("Version: 7");
    expect(output).toContain("Labels: architecture, prd");
    expect(output).toContain("Authority: AUTHORITATIVE");
    expect(output).toContain("Staleness warning: None");
    expect(output).toContain("## Key Content");
    expect(output).toContain("## Sections Found");
    expect(output).toContain("Level 2: Overview");
    expect(output).toContain("Level 2: API Endpoints");
    expect(output).toContain("## Key Signals");
    expect(output).toContain("API Endpoints: GET /auth/token");
    expect(output).toContain("User Roles: admin, user");
    expect(output).toContain("## Related Links");
    expect(output).toContain("[Auth Flow]");
  });

  it("shows truncation warning when bodyTruncated is true", () => {
    const page = {
      pageId: "t1",
      title: "Long Page",
      url: "https://example.atlassian.net/wiki/spaces/ENG/pages/t1",
      space: "Engineering",
      spaceKey: "ENG",
      lastUpdated: recentIso(),
      version: 1,
      labels: [],
      relevanceLevel: "MEDIUM_RELEVANCE" as const,
      relevanceScore: 30,
      relevanceReasons: [],
      authorityLevel: "SUPPORTING" as const,
      authorityReasons: [],
      isStale: false,
      bodyMarkdown: "x".repeat(12015),
      bodyTruncated: true,
      signals: {
        businessRules: [],
        userRoles: [],
        apiEndpoints: [],
        uiScreens: [],
        tableNames: [],
        validationRules: [],
        featureFlags: [],
        permissions: [],
        releaseNotes: [],
        knownLimitations: [],
        dependencies: [],
        testingNotes: [],
        diagramsMentioned: [],
        relatedPageLinks: [],
      },
      sections: [],
    };

    const output = formatPageSummaryOutput(page);
    expect(output).toContain("⚠️ Page content truncated at");
  });

  it("shows 'none' for labels when labels array is empty", () => {
    const page = {
      pageId: "no-labels",
      title: "Page With No Labels",
      url: "https://example.atlassian.net/wiki/spaces/ENG/pages/no-labels",
      space: "Engineering",
      spaceKey: "ENG",
      lastUpdated: recentIso(),
      version: 1,
      labels: [],
      relevanceLevel: "LOW_RELEVANCE" as const,
      relevanceScore: 12,
      relevanceReasons: [],
      authorityLevel: "BACKGROUND_ONLY" as const,
      authorityReasons: [],
      isStale: false,
      bodyMarkdown: "Some content",
      bodyTruncated: false,
      signals: {
        businessRules: [],
        userRoles: [],
        apiEndpoints: [],
        uiScreens: [],
        tableNames: [],
        validationRules: [],
        featureFlags: [],
        permissions: [],
        releaseNotes: [],
        knownLimitations: [],
        dependencies: [],
        testingNotes: [],
        diagramsMentioned: [],
        relatedPageLinks: [],
      },
      sections: [],
    };

    const output = formatPageSummaryOutput(page);
    expect(output).toContain("Labels: none");
    expect(output).toContain("Related Links");
    expect(output).toContain("None found.");
  });
});
