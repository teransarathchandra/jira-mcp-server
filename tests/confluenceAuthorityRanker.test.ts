import { describe, it, expect } from "vitest";
import {
  rankPageAuthority,
  type AuthorityRankerInput,
} from "../src/confluence/confluenceAuthorityRanker.js";
import type { Section } from "../src/confluence/confluenceContentConverter.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function recentDate(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

function oldDate(): string {
  return new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
}

const NO_SECTIONS: Section[] = [];

const BASE_INPUT: AuthorityRankerInput = {
  pageTitle: "Some Generic Page",
  pageLabels: [],
  spaceKey: "TEAM",
  lastModified: oldDate(),
  pageBodyMarkdown: "Generic content with no special signals.",
  sections: NO_SECTIONS,
  directlyLinkedFromJira: false,
  isStale: false,
  allowedSpaceKeys: [],
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("rankPageAuthority — AUTHORITATIVE", () => {
  it("directly linked + matching PRD title + recent → AUTHORITATIVE (score >= 60)", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "Product Requirements Document for Auth Feature",
      directlyLinkedFromJira: true,
      lastModified: recentDate(),
      allowedSpaceKeys: ["TEAM"],
    };

    const result = rankPageAuthority(input);

    // +40 (directly linked) + +30 (PRD title) + +20 (allowed space) + +15 (recent) = 105
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.level).toBe("AUTHORITATIVE");
  });

  it("directly linked alone does not reach AUTHORITATIVE threshold", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      directlyLinkedFromJira: true,
    };

    const result = rankPageAuthority(input);
    // +40 only = 40 → SUPPORTING
    expect(result.score).toBe(40);
    expect(result.level).toBe("SUPPORTING");
  });
});

describe("rankPageAuthority — STALE_OR_RISKY", () => {
  it("isStale=true → STALE_OR_RISKY regardless of other signals", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "Product Requirements Document — Auth",
      directlyLinkedFromJira: true,
      lastModified: recentDate(),
      allowedSpaceKeys: ["TEAM"],
      isStale: true, // overrides everything
    };

    const result = rankPageAuthority(input);

    expect(result.level).toBe("STALE_OR_RISKY");
    expect(result.reasons.some((r) => r.includes("stale"))).toBe(true);
  });

  it("score < 0 (non-stale) → STALE_OR_RISKY", () => {
    // -20 (deprecated label) with nothing else → score = -20
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageLabels: ["deprecated"],
      isStale: false,
    };

    const result = rankPageAuthority(input);

    expect(result.score).toBeLessThan(0);
    expect(result.level).toBe("STALE_OR_RISKY");
  });
});

describe("rankPageAuthority — SUPPORTING", () => {
  it("directly linked page with no other signals → SUPPORTING (score 30-59)", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      directlyLinkedFromJira: true,
    };

    const result = rankPageAuthority(input);

    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.score).toBeLessThan(60);
    expect(result.level).toBe("SUPPORTING");
  });

  it("allowed space + authority label → SUPPORTING", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageLabels: ["requirements"],
      allowedSpaceKeys: ["TEAM"],
    };

    const result = rankPageAuthority(input);

    // +20 (authority label) + +20 (allowed space) = 40 → SUPPORTING
    expect(result.score).toBe(40);
    expect(result.level).toBe("SUPPORTING");
  });
});

describe("rankPageAuthority — BACKGROUND_ONLY", () => {
  it("low score, not stale → BACKGROUND_ONLY", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      // No signals at all
    };

    const result = rankPageAuthority(input);

    expect(result.score).toBeLessThan(30);
    expect(result.level).toBe("BACKGROUND_ONLY");
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("recent update but no other signals → still BACKGROUND_ONLY", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      lastModified: recentDate(),
    };

    const result = rankPageAuthority(input);

    // +15 (recent) = 15 → BACKGROUND_ONLY
    expect(result.score).toBe(15);
    expect(result.level).toBe("BACKGROUND_ONLY");
  });
});

describe("rankPageAuthority — title pattern matching (+30)", () => {
  it("'PRD' in title matches authoritative pattern", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "PRD: User Authentication",
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("authoritative document pattern"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(30);
  });

  it("'Technical Design' in title matches pattern", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "Technical Design for Auth Service",
    };

    const result = rankPageAuthority(input);
    expect(result.score).toBeGreaterThanOrEqual(30);
  });

  it("'Architecture' in title matches pattern", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "System Architecture Overview",
    };

    const result = rankPageAuthority(input);
    expect(result.score).toBeGreaterThanOrEqual(30);
  });

  it("'spec' as word boundary matches pattern", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "API spec for User Service",
    };

    const result = rankPageAuthority(input);
    expect(result.score).toBeGreaterThanOrEqual(30);
  });

  it("'product requirements' in title matches pattern", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "Product Requirements for Auth",
    };

    const result = rankPageAuthority(input);
    expect(result.score).toBeGreaterThanOrEqual(30);
  });

  it("non-document title → no title match", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "Meeting Notes July 2024",
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("authoritative document pattern"))
    ).toBe(false);
  });
});

describe("rankPageAuthority — section heading matching (+10)", () => {
  it("section with 'Requirements' heading gives +10", () => {
    const sections: Section[] = [
      { heading: "Requirements", level: 2, content: "Must do X." },
    ];

    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      sections,
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("section heading matching"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it("section with 'Acceptance Criteria' heading gives +10", () => {
    const sections: Section[] = [
      {
        heading: "Acceptance Criteria",
        level: 2,
        content: "The user must be able to log in.",
      },
    ];

    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      sections,
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("section heading matching"))
    ).toBe(true);
  });

  it("section with 'Business Rules' heading gives +10", () => {
    const sections: Section[] = [
      { heading: "Business Rules", level: 3, content: "Rule 1: ..." },
    ];

    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      sections,
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("section heading matching"))
    ).toBe(true);
  });

  it("section with 'API' heading gives +10", () => {
    const sections: Section[] = [
      { heading: "API Reference", level: 2, content: "GET /users" },
    ];

    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      sections,
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("section heading matching"))
    ).toBe(true);
  });

  it("no matching headings → no +10", () => {
    const sections: Section[] = [
      { heading: "Introduction", level: 1, content: "Overview text." },
      { heading: "Background", level: 2, content: "Some history." },
    ];

    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      sections,
    };

    const noSectionsResult = rankPageAuthority(BASE_INPUT);
    const withSectionsResult = rankPageAuthority(input);

    expect(withSectionsResult.score).toBe(noSectionsResult.score);
  });
});

describe("rankPageAuthority — space key in allowedSpaceKeys (+20)", () => {
  it("spaceKey in allowedSpaceKeys → +20", () => {
    const withSpace: AuthorityRankerInput = {
      ...BASE_INPUT,
      spaceKey: "DOCS",
      allowedSpaceKeys: ["DOCS", "ENG"],
    };
    const withoutSpace: AuthorityRankerInput = {
      ...BASE_INPUT,
      spaceKey: "DOCS",
      allowedSpaceKeys: [],
    };

    const withResult = rankPageAuthority(withSpace);
    const withoutResult = rankPageAuthority(withoutSpace);

    expect(withResult.score).toBe(withoutResult.score + 20);
    expect(
      withResult.reasons.some((r) => r.includes("allowed spaces"))
    ).toBe(true);
  });

  it("space key match is case-insensitive", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      spaceKey: "docs",
      allowedSpaceKeys: ["DOCS"],
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("allowed spaces"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(20);
  });
});

describe("rankPageAuthority — authority labels (+20)", () => {
  it("'prd' label → +20", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageLabels: ["prd"],
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("authority label"))
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(20);
  });

  it("'technical-design' label → +20", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageLabels: ["technical-design"],
    };

    const result = rankPageAuthority(input);
    expect(result.score).toBeGreaterThanOrEqual(20);
  });
});

describe("rankPageAuthority — deprecated/archive/draft penalty (-20)", () => {
  it("'deprecated' in pageLabels → -20", () => {
    const withDeprecated: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageLabels: ["deprecated"],
      isStale: false, // test the label penalty independently
    };
    const withoutDeprecated: AuthorityRankerInput = {
      ...BASE_INPUT,
      isStale: false,
    };

    const withResult = rankPageAuthority(withDeprecated);
    const withoutResult = rankPageAuthority(withoutDeprecated);

    expect(withResult.score).toBe(withoutResult.score - 20);
    expect(
      withResult.reasons.some((r) => r.includes("deprecated/archive/draft"))
    ).toBe(true);
  });

  it("'draft' in pageTitle → -20", () => {
    const input: AuthorityRankerInput = {
      ...BASE_INPUT,
      pageTitle: "Draft: Feature Proposal",
      isStale: false,
    };

    const result = rankPageAuthority(input);
    expect(
      result.reasons.some((r) => r.includes("deprecated/archive/draft"))
    ).toBe(true);
  });
});
