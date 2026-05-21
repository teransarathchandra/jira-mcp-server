import { describe, it, expect } from "vitest";
import {
  confluenceHtmlToMarkdown,
  extractConfluenceSections,
  extractConfluenceSignals,
  isStaleOrDeprecated,
} from "../src/confluence/confluenceContentConverter.js";

// ── confluenceHtmlToMarkdown ──────────────────────────────────────────────────

describe("confluenceHtmlToMarkdown — strips script/style tags", () => {
  it("removes <script> blocks entirely", () => {
    const html = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const result = confluenceHtmlToMarkdown(html);
    expect(result).not.toContain("alert");
    expect(result).not.toContain("script");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("removes <style> blocks entirely", () => {
    const html = "<p>Text</p><style>body { color: red; }</style><p>More</p>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).not.toContain("color: red");
    expect(result).not.toContain("style");
    expect(result).toContain("Text");
  });
});

describe("confluenceHtmlToMarkdown — converts headings", () => {
  it("converts h1 to # heading", () => {
    const html = "<h1>Title One</h1>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("# Title One");
  });

  it("converts h2 to ## heading", () => {
    const html = "<h2>Section Two</h2>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("## Section Two");
  });

  it("converts h3 to ### heading", () => {
    const html = "<h3>Sub Section</h3>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("### Sub Section");
  });
});

describe("confluenceHtmlToMarkdown — converts ul/li to bullets", () => {
  it("converts <ul><li> items to - bullets", () => {
    const html = "<ul><li>Item one</li><li>Item two</li></ul>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("- Item one");
    expect(result).toContain("- Item two");
  });

  it("converts <ol><li> items to numbered bullets", () => {
    const html = "<ol><li>First</li><li>Second</li></ol>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
  });
});

describe("confluenceHtmlToMarkdown — converts strong/em formatting", () => {
  it("converts <strong> to **bold**", () => {
    const html = "<p>This is <strong>bold</strong> text.</p>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("**bold**");
  });

  it("converts <em> to *italic*", () => {
    const html = "<p>This is <em>italic</em> text.</p>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("*italic*");
  });

  it("converts <b> to **bold**", () => {
    const html = "<p><b>bolded</b></p>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("**bolded**");
  });

  it("converts <i> to *italic*", () => {
    const html = "<p><i>italicized</i></p>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("*italicized*");
  });
});

describe("confluenceHtmlToMarkdown — strips remaining HTML tags", () => {
  it("removes unknown HTML tags leaving only text content", () => {
    const html = "<div><span>Hello</span> <custom-tag>World</custom-tag></div>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("<div>");
    expect(result).not.toContain("<span>");
    expect(result).not.toContain("<custom-tag>");
  });
});

describe("confluenceHtmlToMarkdown — decodes HTML entities", () => {
  it("decodes &amp; to &", () => {
    const html = "<p>A &amp; B</p>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("A & B");
  });

  it("decodes &lt; and &gt;", () => {
    const html = "<p>&lt;code&gt;</p>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("<code>");
  });

  it("decodes &nbsp; to space", () => {
    const html = "<p>Hello&nbsp;World</p>";
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain("Hello World");
  });

  it("decodes &quot; to double quote", () => {
    const html = '<p>Say &quot;hello&quot;</p>';
    const result = confluenceHtmlToMarkdown(html);
    expect(result).toContain('Say "hello"');
  });
});

describe("confluenceHtmlToMarkdown — collapses multiple blank lines", () => {
  it("collapses 3+ consecutive blank lines to 2", () => {
    const html = "<p>Para one</p><p>Para two</p><p>Para three</p>";
    // Add extra blank lines by using many p tags with br
    const withBlanks = "<p>A</p>\n\n\n\n\n<p>B</p>";
    const result = confluenceHtmlToMarkdown(withBlanks);
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe("confluenceHtmlToMarkdown — handles empty string input", () => {
  it("returns empty string for empty input", () => {
    expect(confluenceHtmlToMarkdown("")).toBe("");
  });
});

// ── extractConfluenceSections ─────────────────────────────────────────────────

describe("extractConfluenceSections — no headings", () => {
  it("returns empty array when markdown has no headings", () => {
    const markdown = "Just some plain text with no headings at all.";
    const sections = extractConfluenceSections(markdown);
    expect(sections).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(extractConfluenceSections("")).toHaveLength(0);
  });
});

describe("extractConfluenceSections — returns sections with heading, level, content", () => {
  it("returns a single section with heading and content", () => {
    const markdown = "# Introduction\n\nThis is the introduction paragraph.";
    const sections = extractConfluenceSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Introduction");
    expect(sections[0].level).toBe(1);
    expect(sections[0].content).toContain("introduction paragraph");
  });

  it("returns multiple sections in order", () => {
    const markdown = "# First\n\nContent A.\n\n# Second\n\nContent B.";
    const sections = extractConfluenceSections(markdown);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("First");
    expect(sections[1].heading).toBe("Second");
  });

  it("associates content with its heading until the next heading", () => {
    const markdown = "# Alpha\nLine one\nLine two\n# Beta\nLine three";
    const sections = extractConfluenceSections(markdown);
    expect(sections[0].content).toContain("Line one");
    expect(sections[0].content).toContain("Line two");
    expect(sections[0].content).not.toContain("Line three");
    expect(sections[1].content).toContain("Line three");
  });
});

describe("extractConfluenceSections — handles multiple heading levels", () => {
  it("correctly assigns level numbers for h1-h3", () => {
    const markdown =
      "# Top Level\n\nText A\n\n## Sub Level\n\nText B\n\n### Sub Sub Level\n\nText C";
    const sections = extractConfluenceSections(markdown);
    expect(sections).toHaveLength(3);
    expect(sections[0].level).toBe(1);
    expect(sections[1].level).toBe(2);
    expect(sections[2].level).toBe(3);
  });

  it("handles h6 correctly", () => {
    const markdown = "###### Deep Heading\n\nDeep content";
    const sections = extractConfluenceSections(markdown);
    expect(sections[0].level).toBe(6);
    expect(sections[0].heading).toBe("Deep Heading");
  });
});

// ── extractConfluenceSignals ──────────────────────────────────────────────────

describe("extractConfluenceSignals — extracts apiEndpoints", () => {
  it("extracts /api/ path from markdown", () => {
    const markdown = "Call the endpoint GET /api/users/profile to fetch data.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.apiEndpoints.length).toBeGreaterThan(0);
    expect(signals.apiEndpoints.some((e) => e.includes("/api/"))).toBe(true);
  });

  it("extracts versioned API path /v1/", () => {
    const markdown = "The service endpoint is POST /v1/orders/create for new orders.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.apiEndpoints.some((e) => e.includes("/v1/"))).toBe(true);
  });
});

describe("extractConfluenceSignals — extracts permissions", () => {
  it("extracts lines containing 'permission'", () => {
    const markdown = "Users need permission to access this resource.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.permissions.length).toBeGreaterThan(0);
    expect(signals.permissions[0]).toContain("permission");
  });

  it("extracts lines containing 'access control'", () => {
    const markdown = "The access control list is managed by the admin.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.permissions.some((p) => p.includes("access control"))).toBe(true);
  });

  it("extracts lines containing 'role'", () => {
    const markdown = "Each role has a different set of capabilities.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.permissions.some((p) => p.toLowerCase().includes("role"))).toBe(true);
  });
});

describe("extractConfluenceSignals — extracts businessRules", () => {
  it("extracts lines containing 'must'", () => {
    const markdown = "Users must verify their email before accessing the dashboard.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.businessRules.some((r) => r.includes("must"))).toBe(true);
  });

  it("extracts lines containing 'shall'", () => {
    const markdown = "The system shall send a confirmation email after registration.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.businessRules.some((r) => r.includes("shall"))).toBe(true);
  });

  it("extracts lines containing 'business rule'", () => {
    const markdown = "This is a business rule that governs all transactions.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.businessRules.some((r) => r.toLowerCase().includes("business rule"))).toBe(true);
  });
});

describe("extractConfluenceSignals — returns empty arrays when no signals", () => {
  it("returns empty arrays for plain text with no signals", () => {
    const markdown = "The quick brown fox jumps over the lazy dog.";
    const signals = extractConfluenceSignals(markdown);
    expect(signals.businessRules).toHaveLength(0);
    expect(signals.apiEndpoints).toHaveLength(0);
    expect(signals.featureFlags).toHaveLength(0);
    expect(signals.knownLimitations).toHaveLength(0);
    expect(signals.relatedPageLinks).toHaveLength(0);
  });

  it("returns empty arrays for empty input", () => {
    const signals = extractConfluenceSignals("");
    expect(signals.businessRules).toHaveLength(0);
    expect(signals.userRoles).toHaveLength(0);
    expect(signals.apiEndpoints).toHaveLength(0);
  });
});

// ── isStaleOrDeprecated ───────────────────────────────────────────────────────

describe("isStaleOrDeprecated — title checks", () => {
  it("returns true when title contains 'deprecated'", () => {
    expect(isStaleOrDeprecated("Old Feature deprecated", [], "")).toBe(true);
  });

  it("returns true when title contains 'archive'", () => {
    expect(isStaleOrDeprecated("Archive: Old Docs", [], "")).toBe(true);
  });

  it("returns true when title contains 'legacy'", () => {
    expect(isStaleOrDeprecated("Legacy Payment Flow", [], "")).toBe(true);
  });

  it("returns true when title contains 'obsolete'", () => {
    expect(isStaleOrDeprecated("Obsolete Integration Guide", [], "")).toBe(true);
  });
});

describe("isStaleOrDeprecated — label checks", () => {
  it("returns true when label is 'archive'", () => {
    expect(isStaleOrDeprecated("Normal Title", ["archive"], "")).toBe(true);
  });

  it("returns true when label is 'deprecated' (case-insensitive)", () => {
    expect(isStaleOrDeprecated("Normal Title", ["Deprecated"], "")).toBe(true);
  });

  it("returns true when label is 'draft'", () => {
    expect(isStaleOrDeprecated("Normal Title", ["draft"], "Some body text.")).toBe(true);
  });

  it("returns true when label is 'legacy'", () => {
    expect(isStaleOrDeprecated("Normal Title", ["legacy"], "")).toBe(true);
  });
});

describe("isStaleOrDeprecated — body snippet checks", () => {
  it("returns true when body starts with 'This page is deprecated'", () => {
    expect(
      isStaleOrDeprecated("My Page", [], "This page is deprecated and should not be used.")
    ).toBe(true);
  });

  it("returns true when body starts with 'This page is outdated'", () => {
    expect(
      isStaleOrDeprecated("My Page", [], "This page is outdated. Please refer to the new docs.")
    ).toBe(true);
  });

  it("returns true when body starts with 'This page is no longer'", () => {
    expect(
      isStaleOrDeprecated("My Page", [], "This page is no longer maintained.")
    ).toBe(true);
  });

  it("returns true when body starts with 'Archived'", () => {
    expect(
      isStaleOrDeprecated("My Page", [], "Archived content from 2020.")
    ).toBe(true);
  });

  it("returns true when body starts with 'Do not use'", () => {
    expect(
      isStaleOrDeprecated("My Page", [], "Do not use this page for current implementation.")
    ).toBe(true);
  });
});

describe("isStaleOrDeprecated — false for normal page", () => {
  it("returns false for a normal, active page", () => {
    expect(
      isStaleOrDeprecated(
        "Payment Service Architecture",
        ["engineering", "architecture"],
        "This document describes the current payment service architecture."
      )
    ).toBe(false);
  });

  it("returns false for empty inputs", () => {
    expect(isStaleOrDeprecated("", [], "")).toBe(false);
  });

  it("returns false when title, labels, and body have no stale indicators", () => {
    expect(
      isStaleOrDeprecated(
        "User Authentication Guide",
        ["auth", "security"],
        "This page covers user authentication best practices."
      )
    ).toBe(false);
  });
});
