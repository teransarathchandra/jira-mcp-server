import { describe, it, expect } from "vitest";
import {
  escapeCqlValue,
  buildJiraKeyQuery,
  buildEpicParentQuery,
  buildSummaryPhraseQuery,
  buildTechnicalTermsQuery,
  buildSpaceRestrictedQuery,
  buildAllQueries,
  extractPageIdsFromLinks,
} from "../src/confluence/confluenceSearchQueryBuilder.js";
import type { JiraSearchSignals } from "../src/confluence/confluenceSearchQueryBuilder.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSignals(overrides: Partial<JiraSearchSignals> = {}): JiraSearchSignals {
  return {
    issueKey: "CMPI-1234",
    summary: "Add user authentication flow",
    labels: [],
    components: [],
    technicalTerms: [],
    businessTerms: [],
    linkedIssueSummaries: [],
    ...overrides,
  };
}

// ── 1. escapeCqlValue: escapes single quotes ──────────────────────────────────

describe("escapeCqlValue — single quote escaping", () => {
  it("escapes a single quote in a value", () => {
    const result = escapeCqlValue("it's");
    expect(result).toBe("it\\'s");
  });

  it("escapes multiple single quotes", () => {
    const result = escapeCqlValue("O'Brien's");
    expect(result).toBe("O\\'Brien\\'s");
  });

  it("leaves a value without single quotes unchanged", () => {
    const result = escapeCqlValue("hello world");
    expect(result).toBe("hello world");
  });
});

// ── 2. escapeCqlValue: removes injection chars ────────────────────────────────

describe("escapeCqlValue — injection character removal", () => {
  it("removes semicolons", () => {
    const result = escapeCqlValue("foo;bar");
    expect(result).toBe("foobar");
  });

  it("removes parentheses", () => {
    const result = escapeCqlValue("foo(bar)");
    expect(result).toBe("foobar");
  });

  it("removes square brackets", () => {
    const result = escapeCqlValue("foo[bar]");
    expect(result).toBe("foobar");
  });

  it("removes curly braces", () => {
    const result = escapeCqlValue("foo{bar}");
    expect(result).toBe("foobar");
  });

  it("removes double quotes", () => {
    const result = escapeCqlValue('say "hello"');
    expect(result).toBe("say hello");
  });

  it("removes backticks", () => {
    const result = escapeCqlValue("foo`bar");
    expect(result).toBe("foobar");
  });

  it("removes multiple injection characters at once", () => {
    const result = escapeCqlValue('a;b"c`d(e)f[g]h{i}');
    expect(result).toBe("abcdefghi");
  });
});

// ── 3. escapeCqlValue: truncates at 100 chars ─────────────────────────────────

describe("escapeCqlValue — truncation", () => {
  it("truncates to 100 chars when input exceeds limit", () => {
    const longInput = "a".repeat(150);
    const result = escapeCqlValue(longInput);
    expect(result.length).toBe(100);
  });

  it("does not truncate values at or below 100 chars", () => {
    const input = "a".repeat(100);
    const result = escapeCqlValue(input);
    expect(result.length).toBe(100);
  });

  it("returns the original string when it is short", () => {
    const result = escapeCqlValue("CMPI-1234");
    expect(result).toBe("CMPI-1234");
  });
});

// ── 4. buildJiraKeyQuery: correct CQL with escaped issue key ──────────────────

describe("buildJiraKeyQuery", () => {
  it("produces the correct CQL with the issue key", () => {
    const signals = makeSignals({ issueKey: "CMPI-1234" });
    const query = buildJiraKeyQuery(signals);
    expect(query.cql).toBe('text ~ "CMPI-1234" ORDER BY lastModified DESC');
    expect(query.strategy).toBe("jira-key-search");
  });

  it("escapes special chars in issue key", () => {
    const signals = makeSignals({ issueKey: "CMPI'1234" });
    const query = buildJiraKeyQuery(signals);
    expect(query.cql).toContain("CMPI\\'1234");
  });
});

// ── 5. buildEpicParentQuery: uses epicKey when available ──────────────────────

describe("buildEpicParentQuery — epicKey present", () => {
  it("uses epicKey in the CQL query", () => {
    const signals = makeSignals({ epicKey: "CMPI-1000", parentKey: "CMPI-999" });
    const query = buildEpicParentQuery(signals);
    expect(query).not.toBeNull();
    expect(query!.cql).toBe(
      'text ~ "CMPI-1000" AND type = "page" ORDER BY lastModified DESC'
    );
    expect(query!.strategy).toBe("epic-parent-search");
  });

  it("escapes special chars in epicKey", () => {
    const signals = makeSignals({ epicKey: "CMPI'1000" });
    const query = buildEpicParentQuery(signals);
    expect(query!.cql).toContain("CMPI\\'1000");
  });
});

// ── 6. buildEpicParentQuery: uses parentKey when epicKey absent ───────────────

describe("buildEpicParentQuery — only parentKey present", () => {
  it("falls back to parentKey when epicKey is absent", () => {
    const signals = makeSignals({ parentKey: "CMPI-500" });
    const query = buildEpicParentQuery(signals);
    expect(query).not.toBeNull();
    expect(query!.cql).toBe(
      'text ~ "CMPI-500" AND type = "page" ORDER BY lastModified DESC'
    );
    expect(query!.strategy).toBe("epic-parent-search");
  });
});

// ── 7. buildEpicParentQuery: returns null when neither available ──────────────

describe("buildEpicParentQuery — neither key available", () => {
  it("returns null when no epicKey or parentKey", () => {
    const signals = makeSignals();
    const query = buildEpicParentQuery(signals);
    expect(query).toBeNull();
  });

  it("returns null when epicKey and parentKey are both undefined", () => {
    const signals = makeSignals({ epicKey: undefined, parentKey: undefined });
    const query = buildEpicParentQuery(signals);
    expect(query).toBeNull();
  });
});

// ── 8. buildSummaryPhraseQuery: extracts meaningful words, skips stopwords ────

describe("buildSummaryPhraseQuery — meaningful word extraction", () => {
  it("builds a title query using meaningful words from summary", () => {
    const signals = makeSignals({
      summary: "Add user authentication flow",
    });
    const query = buildSummaryPhraseQuery(signals);
    expect(query).not.toBeNull();
    expect(query!.strategy).toBe("summary-phrase-search");
    // "add" is 3 chars (filtered), "user" 4 chars kept, "authentication" kept, "flow" 4 chars kept
    expect(query!.cql).toContain('title ~ "user"');
    expect(query!.cql).toContain('title ~ "authentication"');
    expect(query!.cql).toContain('title ~ "flow"');
    // should not contain stopwords
    expect(query!.cql).not.toContain('"add"');
  });

  it("skips stopwords like 'the', 'and', 'for', 'with'", () => {
    const signals = makeSignals({
      summary: "Implement authentication with database integration",
    });
    const query = buildSummaryPhraseQuery(signals);
    expect(query).not.toBeNull();
    expect(query!.cql).not.toContain('"with"');
    expect(query!.cql).toContain('title ~ "implement"');
    expect(query!.cql).toContain('title ~ "authentication"');
    expect(query!.cql).toContain('title ~ "database"');
    expect(query!.cql).toContain('title ~ "integration"');
  });

  it("takes at most 4 words", () => {
    const signals = makeSignals({
      summary: "Build complex microservice architecture deployment pipeline system",
    });
    const query = buildSummaryPhraseQuery(signals);
    expect(query).not.toBeNull();
    // Count how many title ~ conditions appear
    const titleConditions = (query!.cql.match(/title ~ /g) || []).length;
    expect(titleConditions).toBeLessThanOrEqual(4);
  });

  it("uses AND to join multiple title conditions", () => {
    const signals = makeSignals({
      summary: "Update payment processing flow",
    });
    const query = buildSummaryPhraseQuery(signals);
    expect(query).not.toBeNull();
    expect(query!.cql).toContain(" AND ");
    expect(query!.cql).toContain('type = "page"');
    expect(query!.cql).toContain("ORDER BY lastModified DESC");
  });
});

// ── 9. buildSummaryPhraseQuery: returns null for very short summary ────────────

describe("buildSummaryPhraseQuery — short/insufficient summary", () => {
  it("returns null when summary is shorter than 5 chars", () => {
    const signals = makeSignals({ summary: "Fix" });
    const query = buildSummaryPhraseQuery(signals);
    expect(query).toBeNull();
  });

  it("returns null when summary is empty", () => {
    const signals = makeSignals({ summary: "" });
    const query = buildSummaryPhraseQuery(signals);
    expect(query).toBeNull();
  });

  it("returns null when all words are stopwords or too short", () => {
    const signals = makeSignals({ summary: "Fix the bug in it" });
    const query = buildSummaryPhraseQuery(signals);
    // "fix" = 3 chars (filtered), "the" = stopword, "bug" = 3 chars (filtered), "in" = stopword, "it" = stopword
    expect(query).toBeNull();
  });

  it("returns null when only 1 meaningful word remains", () => {
    const signals = makeSignals({ summary: "Update authentication" });
    // "update" = 6 chars kept, "authentication" = 14 chars kept -> 2 words, should NOT be null
    const query = buildSummaryPhraseQuery(signals);
    expect(query).not.toBeNull();
  });
});

// ── 10. buildTechnicalTermsQuery: uses max 3 terms ────────────────────────────

describe("buildTechnicalTermsQuery — max 3 terms", () => {
  it("uses at most 3 technical terms", () => {
    const signals = makeSignals({
      technicalTerms: ["OAuth", "JWT", "Redis", "PostgreSQL", "Kafka"],
    });
    const query = buildTechnicalTermsQuery(signals);
    expect(query).not.toBeNull();
    // Should only contain the first 3 terms
    const textConditions = (query!.cql.match(/text ~ /g) || []).length;
    expect(textConditions).toBe(3);
    expect(query!.cql).toContain('text ~ "OAuth"');
    expect(query!.cql).toContain('text ~ "JWT"');
    expect(query!.cql).toContain('text ~ "Redis"');
    expect(query!.cql).not.toContain('"PostgreSQL"');
    expect(query!.cql).not.toContain('"Kafka"');
  });

  it("uses fewer than 3 terms when fewer provided", () => {
    const signals = makeSignals({ technicalTerms: ["Redis"] });
    const query = buildTechnicalTermsQuery(signals);
    expect(query).not.toBeNull();
    expect(query!.cql).toBe(
      'text ~ "Redis" AND type = "page" ORDER BY lastModified DESC'
    );
    expect(query!.strategy).toBe("technical-terms-search");
  });

  it("filters out terms shorter than 3 chars", () => {
    const signals = makeSignals({ technicalTerms: ["OK", "go", "Redis"] });
    const query = buildTechnicalTermsQuery(signals);
    expect(query).not.toBeNull();
    expect(query!.cql).toContain('text ~ "Redis"');
    expect(query!.cql).not.toContain('"OK"');
    expect(query!.cql).not.toContain('"go"');
  });

  it("escapes special chars in technical terms", () => {
    const signals = makeSignals({ technicalTerms: ["OAuth2.0", "user's-api"] });
    const query = buildTechnicalTermsQuery(signals);
    expect(query).not.toBeNull();
    // Single quote should be escaped
    expect(query!.cql).toContain("user\\'s-api");
  });
});

// ── 11. buildTechnicalTermsQuery: returns null for empty terms ─────────────────

describe("buildTechnicalTermsQuery — empty terms", () => {
  it("returns null when technicalTerms is empty", () => {
    const signals = makeSignals({ technicalTerms: [] });
    const query = buildTechnicalTermsQuery(signals);
    expect(query).toBeNull();
  });

  it("returns null when all terms are too short (< 3 chars)", () => {
    const signals = makeSignals({ technicalTerms: ["OK", "go"] });
    const query = buildTechnicalTermsQuery(signals);
    expect(query).toBeNull();
  });
});

// ── 12. buildSpaceRestrictedQuery: adds AND space.key IN clause ───────────────

describe("buildSpaceRestrictedQuery — with space keys", () => {
  it("wraps the base CQL with space restriction", () => {
    const base = 'text ~ "CMPI-1234" ORDER BY lastModified DESC';
    const result = buildSpaceRestrictedQuery(base, ["ENG", "ARCH"]);
    expect(result).toBe(
      '(text ~ "CMPI-1234" ORDER BY lastModified DESC) AND space.key IN (ENG,ARCH)'
    );
  });

  it("escapes space keys before inserting", () => {
    const base = 'text ~ "test" ORDER BY lastModified DESC';
    const result = buildSpaceRestrictedQuery(base, ["ENG'S"]);
    expect(result).toContain("ENG\\'S");
  });

  it("handles a single space key", () => {
    const base = 'text ~ "CMPI-99" ORDER BY lastModified DESC';
    const result = buildSpaceRestrictedQuery(base, ["PROD"]);
    expect(result).toBe(
      '(text ~ "CMPI-99" ORDER BY lastModified DESC) AND space.key IN (PROD)'
    );
  });
});

// ── 13. buildSpaceRestrictedQuery: returns unchanged when no spaces ────────────

describe("buildSpaceRestrictedQuery — no space keys", () => {
  it("returns the base CQL unchanged when spaceKeys is empty", () => {
    const base = 'text ~ "CMPI-1234" ORDER BY lastModified DESC';
    const result = buildSpaceRestrictedQuery(base, []);
    expect(result).toBe(base);
  });
});

// ── 14. buildAllQueries: deduplicated list up to 5 ────────────────────────────

describe("buildAllQueries — deduplication and limit", () => {
  it("always includes jira-key-search as first query", () => {
    const signals = makeSignals();
    const queries = buildAllQueries(signals);
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries[0].strategy).toBe("jira-key-search");
  });

  it("returns at most 5 queries", () => {
    const signals = makeSignals({
      epicKey: "CMPI-1000",
      summary: "Implement payment processing service integration flow",
      technicalTerms: ["Redis", "Kafka", "OAuth"],
    });
    const queries = buildAllQueries(signals);
    expect(queries.length).toBeLessThanOrEqual(5);
  });

  it("deduplicates queries with identical CQL strings", () => {
    // If issueKey equals epicKey (edge case), dedup should collapse them
    const signals = makeSignals({
      issueKey: "CMPI-1234",
      epicKey: "CMPI-1234",
      summary: "Fix the bug",
      technicalTerms: [],
    });
    const queries = buildAllQueries(signals);
    const cqlStrings = queries.map((q) => q.cql);
    const uniqueCqls = new Set(cqlStrings);
    expect(cqlStrings.length).toBe(uniqueCqls.size);
  });

  it("applies space restriction to all queries when spaceKeys provided", () => {
    const signals = makeSignals({
      spaceKeys: ["ENG", "ARCH"],
      epicKey: "CMPI-1000",
      summary: "Deploy microservice architecture pipeline",
      technicalTerms: ["Redis"],
    });
    const queries = buildAllQueries(signals);
    for (const q of queries) {
      expect(q.cql).toContain("space.key IN (ENG,ARCH)");
    }
  });

  it("does not apply space restriction when spaceKeys is absent", () => {
    const signals = makeSignals({ epicKey: "CMPI-999" });
    const queries = buildAllQueries(signals);
    for (const q of queries) {
      expect(q.cql).not.toContain("space.key");
    }
  });

  it("returns only jira-key-search when no other signals available", () => {
    const signals = makeSignals({
      summary: "Fix",  // too short
      technicalTerms: [],
    });
    const queries = buildAllQueries(signals);
    expect(queries.length).toBe(1);
    expect(queries[0].strategy).toBe("jira-key-search");
  });
});

// ── 15. extractPageIdsFromLinks: extracts IDs from Confluence URLs ────────────

describe("extractPageIdsFromLinks — URL parsing", () => {
  it("extracts page ID from a standard /pages/{id} URL", () => {
    const urls = ["https://myorg.atlassian.net/wiki/spaces/ENG/pages/123456789"];
    const ids = extractPageIdsFromLinks(urls);
    expect(ids).toEqual(["123456789"]);
  });

  it("extracts page ID from a URL with /pages/{id}/ trailing slash", () => {
    const urls = [
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/987654321/My-Page-Title",
    ];
    const ids = extractPageIdsFromLinks(urls);
    expect(ids).toEqual(["987654321"]);
  });

  it("extracts page ID from a URL with query string /pages/{id}?...", () => {
    const urls = [
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/111222333?focusedCommentId=456",
    ];
    const ids = extractPageIdsFromLinks(urls);
    expect(ids).toEqual(["111222333"]);
  });

  it("extracts page ID from multiple URLs", () => {
    const urls = [
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/100",
      "https://myorg.atlassian.net/wiki/spaces/ARCH/pages/200/",
    ];
    const ids = extractPageIdsFromLinks(urls);
    expect(ids).toEqual(["100", "200"]);
  });

  it("handles empty URL list", () => {
    const ids = extractPageIdsFromLinks([]);
    expect(ids).toEqual([]);
  });

  it("ignores URLs without a /pages/ segment", () => {
    const urls = [
      "https://myorg.atlassian.net/wiki/spaces/ENG",
      "https://example.com/about",
    ];
    const ids = extractPageIdsFromLinks(urls);
    expect(ids).toEqual([]);
  });
});

// ── 16. extractPageIdsFromLinks: deduplicates, ignores non-numeric ─────────────

describe("extractPageIdsFromLinks — deduplication and non-numeric filtering", () => {
  it("deduplicates repeated page IDs", () => {
    const urls = [
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/555",
      "https://myorg.atlassian.net/wiki/spaces/ARCH/pages/555/",
    ];
    const ids = extractPageIdsFromLinks(urls);
    expect(ids).toEqual(["555"]);
  });

  it("ignores non-numeric page IDs", () => {
    const urls = [
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/abc123",
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/999",
    ];
    const ids = extractPageIdsFromLinks(urls);
    // "abc123" should not match the numeric-only pattern
    expect(ids).toEqual(["999"]);
  });

  it("returns deduplicated results across mixed valid/invalid URLs", () => {
    const urls = [
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/123",
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/123",
      "https://myorg.atlassian.net/wiki/spaces/ENG/pages/456",
      "https://example.com/no-pages",
    ];
    const ids = extractPageIdsFromLinks(urls);
    expect(ids).toEqual(["123", "456"]);
  });
});
