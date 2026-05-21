import { describe, it, expect } from "vitest";
import {
  scorePageRelevance,
  type RelevanceScorerInput,
} from "../src/confluence/confluenceRelevanceScorer.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** A recent ISO date (within the last 30 days) */
function recentDate(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

/** An old ISO date (more than 90 days ago) */
function oldDate(): string {
  return new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
}

const EMPTY_SIGNALS = {
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
};

const BASE_INPUT: RelevanceScorerInput = {
  pageId: "page-1",
  pageTitle: "Some Confluence Page",
  pageLabels: [],
  spaceKey: "TEAM",
  lastModified: oldDate(),
  pageBodyMarkdown: "This is a generic page with no special content.",
  signals: EMPTY_SIGNALS,
  jiraIssueKey: "PROJ-123",
  jiraEpicKey: undefined,
  jiraParentKey: undefined,
  jiraSummary: "Build user authentication feature",
  jiraLabels: [],
  jiraComponents: [],
  jiraTechnicalTerms: [],
  directlyLinkedFromJira: false,
  allowedSpaceKeys: [],
  labelBoosts: [],
  excludeLabels: [],
  titleBoostTerms: [],
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("scorePageRelevance — issue key in body (+40)", () => {
  it("issue key in body scores +40 and reaches at least MEDIUM_RELEVANCE", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageBodyMarkdown:
        "This page references PROJ-123 and describes its implementation.",
    };

    const result = scorePageRelevance(input);

    // +40 from issue key match → score = 40 → MEDIUM_RELEVANCE (>= 25, < 50)
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(["HIGH_RELEVANCE", "MEDIUM_RELEVANCE"]).toContain(result.level);
    expect(result.reasons.some((r) => r.includes("PROJ-123"))).toBe(true);
  });

  it("issue key + directly linked → HIGH_RELEVANCE (score >= 50)", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageBodyMarkdown:
        "This page references PROJ-123 and describes its implementation.",
      directlyLinkedFromJira: true,
    };

    const result = scorePageRelevance(input);

    // +40 (issue key) + +30 (directly linked) = 70 → HIGH_RELEVANCE
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.level).toBe("HIGH_RELEVANCE");
    expect(result.reasons.some((r) => r.includes("PROJ-123"))).toBe(true);
  });

  it("case-insensitive issue key match still scores +40", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageBodyMarkdown: "This page references proj-123 in lowercase.",
    };

    const result = scorePageRelevance(input);
    expect(result.score).toBeGreaterThanOrEqual(40);
    // 40 points alone → MEDIUM_RELEVANCE (>= 25, < 50)
    expect(["HIGH_RELEVANCE", "MEDIUM_RELEVANCE"]).toContain(result.level);
  });
});

describe("scorePageRelevance — no matching signals → LOW or OMIT", () => {
  it("OMIT when body has no relevant content", () => {
    const result = scorePageRelevance(BASE_INPUT);

    expect(result.level).toBe("OMIT");
    expect(result.score).toBeLessThan(10);
  });

  it("LOW_RELEVANCE for a single weak signal", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      // Only +5 from allowed space, no other signals
      allowedSpaceKeys: ["TEAM"],
      lastModified: recentDate(), // +5 for recency
    };

    const result = scorePageRelevance(input);
    // +5 (allowed space) + +5 (recent) = 10 → LOW_RELEVANCE
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.level).toBe("LOW_RELEVANCE");
  });
});

describe("scorePageRelevance — stale page penalty (-30)", () => {
  it("stale page title reduces score by 30", () => {
    const staleInput: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageTitle: "Deprecated Authentication Design",
      pageBodyMarkdown:
        "This page is deprecated. Do not use. PROJ-123 was here.",
      allowedSpaceKeys: ["TEAM"],
    };

    const freshInput: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageBodyMarkdown:
        "PROJ-123 is referenced here. Current design documentation.",
      allowedSpaceKeys: ["TEAM"],
    };

    const staleResult = scorePageRelevance(staleInput);
    const freshResult = scorePageRelevance(freshInput);

    expect(staleResult.isStale).toBe(true);
    expect(staleResult.staleWarning).toBeDefined();
    // Stale page has lower score
    expect(staleResult.score).toBeLessThan(freshResult.score);
    expect(
      staleResult.reasons.some((r) => r.includes("stale"))
    ).toBe(true);
  });

  it("stale label triggers -30 penalty", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageLabels: ["deprecated"],
      pageBodyMarkdown: "PROJ-123 is mentioned here.",
    };

    const result = scorePageRelevance(input);
    expect(result.isStale).toBe(true);
    // +40 (issue key) - 30 (stale) = 10, clamped to 10
    expect(result.score).toBe(10);
  });
});

describe("scorePageRelevance — directlyLinkedFromJira (+30)", () => {
  it("directly linked page gives +30", () => {
    const withLink: RelevanceScorerInput = {
      ...BASE_INPUT,
      directlyLinkedFromJira: true,
    };
    const withoutLink: RelevanceScorerInput = {
      ...BASE_INPUT,
      directlyLinkedFromJira: false,
    };

    const linkedResult = scorePageRelevance(withLink);
    const unlinkedResult = scorePageRelevance(withoutLink);

    expect(linkedResult.score).toBe(unlinkedResult.score + 30);
    expect(
      linkedResult.reasons.some((r) => r.includes("directly linked"))
    ).toBe(true);
  });
});

describe("scorePageRelevance — title word match (+20)", () => {
  it("2+ long words from summary in title gives +20", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageTitle: "User Authentication Design Document",
      jiraSummary: "Build user authentication feature",
    };

    const result = scorePageRelevance(input);

    // "user" and "authentication" (both length >= 4) appear in title
    expect(
      result.reasons.some((r) => r.includes("title shares 2+"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(20);
  });

  it("only 1 long word in title → no +20 bonus", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageTitle: "Authentication Reference",
      jiraSummary: "Build user authentication feature",
    };

    const result = scorePageRelevance(input);
    expect(
      result.reasons.some((r) => r.includes("title shares 2+"))
    ).toBe(false);
  });
});

describe("scorePageRelevance — score clamped to 0 minimum", () => {
  it("score is never negative", () => {
    // Stale (-30) + excluded label (-20) = -50, but body has no other matches
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageTitle: "Archived Old Feature",
      pageLabels: ["archive", "old-product"],
      excludeLabels: ["old-product"],
      pageBodyMarkdown: "Some unrelated content.",
    };

    const result = scorePageRelevance(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("scorePageRelevance — recently updated (+5)", () => {
  it("page updated within 90 days gives +5", () => {
    const recentInput: RelevanceScorerInput = {
      ...BASE_INPUT,
      lastModified: recentDate(),
    };
    const oldInput: RelevanceScorerInput = {
      ...BASE_INPUT,
      lastModified: oldDate(),
    };

    const recentResult = scorePageRelevance(recentInput);
    const oldResult = scorePageRelevance(oldInput);

    expect(recentResult.score).toBe(oldResult.score + 5);
    expect(
      recentResult.reasons.some((r) => r.includes("90 days"))
    ).toBe(true);
  });
});

describe("scorePageRelevance — excluded label (-20)", () => {
  it("excluded label reduces score by 20", () => {
    const withExclude: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageLabels: ["do-not-use"],
      excludeLabels: ["do-not-use"],
      pageBodyMarkdown: "PROJ-123 mentioned here.",
    };

    const withoutExclude: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageBodyMarkdown: "PROJ-123 mentioned here.",
    };

    const excludedResult = scorePageRelevance(withExclude);
    const normalResult = scorePageRelevance(withoutExclude);

    expect(excludedResult.score).toBe(normalResult.score - 20);
    expect(
      excludedResult.reasons.some((r) => r.includes("excluded label"))
    ).toBe(true);
  });
});

describe("scorePageRelevance — level threshold boundaries", () => {
  it("score >= 50 → HIGH_RELEVANCE", () => {
    // +40 (issue key) + +30 (directly linked) = 70 → HIGH_RELEVANCE
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageBodyMarkdown: "PROJ-123 is the main subject of this page.",
      directlyLinkedFromJira: true,
    };

    const result = scorePageRelevance(input);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.level).toBe("HIGH_RELEVANCE");
  });

  it("score >= 25 and < 50 → MEDIUM_RELEVANCE", () => {
    // +30 (directly linked) = 30 → MEDIUM_RELEVANCE
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      directlyLinkedFromJira: true,
    };

    const result = scorePageRelevance(input);
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.score).toBeLessThan(50);
    expect(result.level).toBe("MEDIUM_RELEVANCE");
  });

  it("score >= 10 and < 25 → LOW_RELEVANCE", () => {
    // +5 (allowed space) + +5 (recent) = 10 → LOW_RELEVANCE
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      allowedSpaceKeys: ["TEAM"],
      lastModified: recentDate(),
    };

    const result = scorePageRelevance(input);
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.score).toBeLessThan(25);
    expect(result.level).toBe("LOW_RELEVANCE");
  });

  it("score < 10 → OMIT", () => {
    const result = scorePageRelevance(BASE_INPUT);
    expect(result.score).toBeLessThan(10);
    expect(result.level).toBe("OMIT");
  });
});

describe("scorePageRelevance — label and component matching", () => {
  it("+15 when page labels intersect with jira labels", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageLabels: ["authentication", "security"],
      jiraLabels: ["authentication"],
    };

    const result = scorePageRelevance(input);
    expect(
      result.reasons.some((r) => r.includes("labels match Jira issue labels"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it("+15 when page labels intersect with jira components", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageLabels: ["backend"],
      jiraComponents: ["backend"],
    };

    const result = scorePageRelevance(input);
    expect(
      result.reasons.some((r) => r.includes("labels match Jira issue components"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it("+15 when page has a label-boost label", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      pageLabels: ["featured"],
      labelBoosts: ["featured"],
    };

    const result = scorePageRelevance(input);
    expect(
      result.reasons.some((r) => r.includes("label-boost"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(15);
  });
});

describe("scorePageRelevance — epic and parent key matching", () => {
  it("+25 when epic key appears in body", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      jiraEpicKey: "EPIC-42",
      pageBodyMarkdown: "This page is part of EPIC-42.",
    };

    const result = scorePageRelevance(input);
    expect(
      result.reasons.some((r) => r.includes("EPIC-42"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it("+25 when parent key appears in body (stacks with epic)", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      jiraEpicKey: "EPIC-42",
      jiraParentKey: "STORY-10",
      pageBodyMarkdown: "References both EPIC-42 and STORY-10.",
    };

    const result = scorePageRelevance(input);
    // +25 (epic) + +25 (parent) = 50
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.level).toBe("HIGH_RELEVANCE");
  });
});

describe("scorePageRelevance — technical terms", () => {
  it("+10 when 2+ technical terms appear in body", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      jiraTechnicalTerms: ["OAuth", "JWT", "PKCE"],
      pageBodyMarkdown:
        "This page describes OAuth and JWT token handling.",
    };

    const result = scorePageRelevance(input);
    expect(
      result.reasons.some((r) => r.includes("technical terms"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it("only 1 technical term → no +10 bonus", () => {
    const input: RelevanceScorerInput = {
      ...BASE_INPUT,
      jiraTechnicalTerms: ["OAuth", "JWT"],
      pageBodyMarkdown: "This page describes OAuth only.",
    };

    const noTermsResult = scorePageRelevance({
      ...BASE_INPUT,
      jiraTechnicalTerms: ["OAuth", "JWT"],
      pageBodyMarkdown: "No terms here.",
    });
    const oneTermResult = scorePageRelevance(input);

    expect(oneTermResult.score).toBe(noTermsResult.score);
  });
});
