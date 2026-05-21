import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getConfluenceConfig,
  isConfluenceEnabled,
  ConfluenceNotConfiguredError,
  ConfluenceAuthError,
  ConfluenceNotFoundError,
  ConfluenceRateLimitError,
  ConfluenceServerError,
  ConfluenceNetworkError,
} from "../src/confluence/confluenceConfig.js";

// ── Env helpers ────────────────────────────────────────────────────────────────

const CONFLUENCE_ENV_KEYS = [
  "CONFLUENCE_BASE_URL",
  "CONFLUENCE_EMAIL",
  "CONFLUENCE_API_TOKEN",
  "CONFLUENCE_SPACE_KEYS",
  "CONFLUENCE_MAX_SEARCH_RESULTS",
  "CONFLUENCE_MAX_PAGES_TO_READ",
  "CONFLUENCE_MAX_PAGE_CHARS",
  "CONFLUENCE_ENABLED",
  "CONFLUENCE_INCLUDE_ARCHIVED",
  "CONFLUENCE_REQUIRE_SPACE_ALLOWLIST",
  "CONFLUENCE_LABEL_BOOSTS",
  "CONFLUENCE_EXCLUDE_LABELS",
  "CONFLUENCE_TITLE_BOOST_TERMS",
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // Save and clear all Confluence-related env vars before each test.
  for (const key of CONFLUENCE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  // Restore all saved env vars.
  for (const key of CONFLUENCE_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  savedEnv = {};
});

// ── 1. Returns null when CONFLUENCE_BASE_URL not set ──────────────────────────

describe("getConfluenceConfig — no BASE_URL", () => {
  it("returns null when CONFLUENCE_BASE_URL is not set", () => {
    const result = getConfluenceConfig();
    expect(result).toBeNull();
  });
});

// ── 2. Returns null when CONFLUENCE_EMAIL is missing ──────────────────────────

describe("getConfluenceConfig — missing CONFLUENCE_EMAIL", () => {
  it("returns null when BASE_URL set but CONFLUENCE_EMAIL missing", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";

    const result = getConfluenceConfig();
    expect(result).toBeNull();
  });
});

// ── 3. Returns null when CONFLUENCE_API_TOKEN is missing ─────────────────────

describe("getConfluenceConfig — missing CONFLUENCE_API_TOKEN", () => {
  it("returns null when BASE_URL set but CONFLUENCE_API_TOKEN missing", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";

    const result = getConfluenceConfig();
    expect(result).toBeNull();
  });
});

// ── 4. Returns valid config when all required vars set ────────────────────────

describe("getConfluenceConfig — valid required vars", () => {
  it("returns a non-null ConfluenceConfig when all required vars are present", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";

    const result = getConfluenceConfig();
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toBe("https://myorg.atlassian.net/wiki");
    expect(result!.email).toBe("user@example.com");
    expect(result!.apiToken).toBe("my-api-token");
  });

  it("strips trailing slash from baseUrl", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki/";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";

    const result = getConfluenceConfig();
    expect(result!.baseUrl).toBe("https://myorg.atlassian.net/wiki");
  });
});

// ── 5. Applies correct defaults ───────────────────────────────────────────────

describe("getConfluenceConfig — defaults", () => {
  beforeEach(() => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
  });

  it("defaults maxSearchResults to 10", () => {
    const result = getConfluenceConfig();
    expect(result!.maxSearchResults).toBe(10);
  });

  it("defaults maxPagesToRead to 5", () => {
    const result = getConfluenceConfig();
    expect(result!.maxPagesToRead).toBe(5);
  });

  it("defaults maxPageChars to 12000", () => {
    const result = getConfluenceConfig();
    expect(result!.maxPageChars).toBe(12000);
  });

  it("defaults enabled to true", () => {
    const result = getConfluenceConfig();
    expect(result!.enabled).toBe(true);
  });

  it("defaults includeArchived to false", () => {
    const result = getConfluenceConfig();
    expect(result!.includeArchived).toBe(false);
  });

  it("defaults requireSpaceAllowlist to true", () => {
    const result = getConfluenceConfig();
    expect(result!.requireSpaceAllowlist).toBe(true);
  });

  it("defaults spaceKeys to empty array", () => {
    const result = getConfluenceConfig();
    expect(result!.spaceKeys).toEqual([]);
  });

  it("defaults labelBoosts to expected list", () => {
    const result = getConfluenceConfig();
    expect(result!.labelBoosts).toEqual([
      "requirements",
      "prd",
      "technical-design",
      "architecture",
      "user-guide",
      "release-notes",
    ]);
  });

  it("defaults excludeLabels to expected list", () => {
    const result = getConfluenceConfig();
    expect(result!.excludeLabels).toEqual(["deprecated", "archive", "draft"]);
  });

  it("defaults titleBoostTerms to expected list", () => {
    const result = getConfluenceConfig();
    expect(result!.titleBoostTerms).toEqual([
      "requirement",
      "prd",
      "design",
      "spec",
      "architecture",
      "flow",
    ]);
  });
});

// ── 6. Parses CONFLUENCE_SPACE_KEYS correctly ─────────────────────────────────

describe("getConfluenceConfig — CONFLUENCE_SPACE_KEYS parsing", () => {
  beforeEach(() => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
  });

  it("splits comma-separated space keys", () => {
    process.env.CONFLUENCE_SPACE_KEYS = "ENG,PROD,ARCH";
    const result = getConfluenceConfig();
    expect(result!.spaceKeys).toEqual(["ENG", "PROD", "ARCH"]);
  });

  it("trims whitespace from space keys", () => {
    process.env.CONFLUENCE_SPACE_KEYS = " ENG , PROD , ARCH ";
    const result = getConfluenceConfig();
    expect(result!.spaceKeys).toEqual(["ENG", "PROD", "ARCH"]);
  });

  it("filters out empty strings after split+trim", () => {
    process.env.CONFLUENCE_SPACE_KEYS = "ENG,,PROD, ,ARCH";
    const result = getConfluenceConfig();
    expect(result!.spaceKeys).toEqual(["ENG", "PROD", "ARCH"]);
  });

  it("returns empty array when CONFLUENCE_SPACE_KEYS is empty string", () => {
    process.env.CONFLUENCE_SPACE_KEYS = "";
    const result = getConfluenceConfig();
    expect(result!.spaceKeys).toEqual([]);
  });

  it("returns a single space key when only one is provided", () => {
    process.env.CONFLUENCE_SPACE_KEYS = "ENG";
    const result = getConfluenceConfig();
    expect(result!.spaceKeys).toEqual(["ENG"]);
  });
});

// ── 7. CONFLUENCE_ENABLED=false → returns null ────────────────────────────────

describe("getConfluenceConfig — CONFLUENCE_ENABLED=false", () => {
  it("returns null when CONFLUENCE_ENABLED=false", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
    process.env.CONFLUENCE_ENABLED = "false";

    const result = getConfluenceConfig();
    expect(result).toBeNull();
  });

  it("returns null when CONFLUENCE_ENABLED=FALSE (case-insensitive)", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
    process.env.CONFLUENCE_ENABLED = "FALSE";

    const result = getConfluenceConfig();
    expect(result).toBeNull();
  });

  it("returns non-null when CONFLUENCE_ENABLED=true", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
    process.env.CONFLUENCE_ENABLED = "true";

    const result = getConfluenceConfig();
    expect(result).not.toBeNull();
  });

  it("returns non-null when CONFLUENCE_ENABLED=1", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
    process.env.CONFLUENCE_ENABLED = "1";

    const result = getConfluenceConfig();
    expect(result).not.toBeNull();
  });
});

// ── 8. Parses boolean fields ──────────────────────────────────────────────────

describe("getConfluenceConfig — boolean field parsing", () => {
  beforeEach(() => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
  });

  it("parses CONFLUENCE_INCLUDE_ARCHIVED=true → includeArchived: true", () => {
    process.env.CONFLUENCE_INCLUDE_ARCHIVED = "true";
    const result = getConfluenceConfig();
    expect(result!.includeArchived).toBe(true);
  });

  it("parses CONFLUENCE_INCLUDE_ARCHIVED=false → includeArchived: false", () => {
    process.env.CONFLUENCE_INCLUDE_ARCHIVED = "false";
    const result = getConfluenceConfig();
    expect(result!.includeArchived).toBe(false);
  });

  it("parses CONFLUENCE_REQUIRE_SPACE_ALLOWLIST=false → requireSpaceAllowlist: false", () => {
    process.env.CONFLUENCE_REQUIRE_SPACE_ALLOWLIST = "false";
    const result = getConfluenceConfig();
    expect(result!.requireSpaceAllowlist).toBe(false);
  });

  it("parses CONFLUENCE_REQUIRE_SPACE_ALLOWLIST=true → requireSpaceAllowlist: true", () => {
    process.env.CONFLUENCE_REQUIRE_SPACE_ALLOWLIST = "true";
    const result = getConfluenceConfig();
    expect(result!.requireSpaceAllowlist).toBe(true);
  });

  it("defaults CONFLUENCE_INCLUDE_ARCHIVED to false when not set", () => {
    const result = getConfluenceConfig();
    expect(result!.includeArchived).toBe(false);
  });

  it("defaults CONFLUENCE_REQUIRE_SPACE_ALLOWLIST to true when not set", () => {
    const result = getConfluenceConfig();
    expect(result!.requireSpaceAllowlist).toBe(true);
  });
});

// ── 9. Clamps CONFLUENCE_MAX_SEARCH_RESULTS to [1, 50] ────────────────────────

describe("getConfluenceConfig — CONFLUENCE_MAX_SEARCH_RESULTS clamping", () => {
  beforeEach(() => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
  });

  it("clamps to 1 when value is below minimum", () => {
    process.env.CONFLUENCE_MAX_SEARCH_RESULTS = "0";
    const result = getConfluenceConfig();
    expect(result!.maxSearchResults).toBe(1);
  });

  it("clamps to 50 when value exceeds maximum", () => {
    process.env.CONFLUENCE_MAX_SEARCH_RESULTS = "100";
    const result = getConfluenceConfig();
    expect(result!.maxSearchResults).toBe(50);
  });

  it("uses value when within [1, 50]", () => {
    process.env.CONFLUENCE_MAX_SEARCH_RESULTS = "25";
    const result = getConfluenceConfig();
    expect(result!.maxSearchResults).toBe(25);
  });

  it("uses boundary value 1", () => {
    process.env.CONFLUENCE_MAX_SEARCH_RESULTS = "1";
    const result = getConfluenceConfig();
    expect(result!.maxSearchResults).toBe(1);
  });

  it("uses boundary value 50", () => {
    process.env.CONFLUENCE_MAX_SEARCH_RESULTS = "50";
    const result = getConfluenceConfig();
    expect(result!.maxSearchResults).toBe(50);
  });

  it("falls back to default 10 when value is NaN", () => {
    process.env.CONFLUENCE_MAX_SEARCH_RESULTS = "not-a-number";
    const result = getConfluenceConfig();
    expect(result!.maxSearchResults).toBe(10);
  });
});

// ── 10. Clamps CONFLUENCE_MAX_PAGES_TO_READ to [1, 20] ────────────────────────

describe("getConfluenceConfig — CONFLUENCE_MAX_PAGES_TO_READ clamping", () => {
  beforeEach(() => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
  });

  it("clamps to 1 when value is below minimum", () => {
    process.env.CONFLUENCE_MAX_PAGES_TO_READ = "0";
    const result = getConfluenceConfig();
    expect(result!.maxPagesToRead).toBe(1);
  });

  it("clamps to 20 when value exceeds maximum", () => {
    process.env.CONFLUENCE_MAX_PAGES_TO_READ = "50";
    const result = getConfluenceConfig();
    expect(result!.maxPagesToRead).toBe(20);
  });

  it("uses value when within [1, 20]", () => {
    process.env.CONFLUENCE_MAX_PAGES_TO_READ = "10";
    const result = getConfluenceConfig();
    expect(result!.maxPagesToRead).toBe(10);
  });

  it("uses boundary value 1", () => {
    process.env.CONFLUENCE_MAX_PAGES_TO_READ = "1";
    const result = getConfluenceConfig();
    expect(result!.maxPagesToRead).toBe(1);
  });

  it("uses boundary value 20", () => {
    process.env.CONFLUENCE_MAX_PAGES_TO_READ = "20";
    const result = getConfluenceConfig();
    expect(result!.maxPagesToRead).toBe(20);
  });

  it("falls back to default 5 when value is NaN", () => {
    process.env.CONFLUENCE_MAX_PAGES_TO_READ = "not-a-number";
    const result = getConfluenceConfig();
    expect(result!.maxPagesToRead).toBe(5);
  });
});

// ── 11. isConfluenceEnabled() returns false when not configured ───────────────

describe("isConfluenceEnabled — not configured", () => {
  it("returns false when CONFLUENCE_BASE_URL is not set", () => {
    expect(isConfluenceEnabled()).toBe(false);
  });

  it("returns false when BASE_URL is set but credentials are missing", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    expect(isConfluenceEnabled()).toBe(false);
  });

  it("returns false when CONFLUENCE_ENABLED=false", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
    process.env.CONFLUENCE_ENABLED = "false";
    expect(isConfluenceEnabled()).toBe(false);
  });
});

// ── 12. isConfluenceEnabled() returns true when configured ───────────────────

describe("isConfluenceEnabled — configured", () => {
  it("returns true when all required vars are set", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
    expect(isConfluenceEnabled()).toBe(true);
  });

  it("returns true when explicitly set to enabled with all required vars", () => {
    process.env.CONFLUENCE_BASE_URL = "https://myorg.atlassian.net/wiki";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "my-api-token";
    process.env.CONFLUENCE_ENABLED = "true";
    expect(isConfluenceEnabled()).toBe(true);
  });
});

// ── Error class instantiation ─────────────────────────────────────────────────

describe("Confluence error classes", () => {
  it("ConfluenceNotConfiguredError has correct name and message", () => {
    const err = new ConfluenceNotConfiguredError("Not configured");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConfluenceNotConfiguredError");
    expect(err.message).toBe("Not configured");
  });

  it("ConfluenceAuthError has correct name and message", () => {
    const err = new ConfluenceAuthError("Auth failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConfluenceAuthError");
    expect(err.message).toBe("Auth failed");
  });

  it("ConfluenceNotFoundError has correct name and message", () => {
    const err = new ConfluenceNotFoundError("Not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConfluenceNotFoundError");
    expect(err.message).toBe("Not found");
  });

  it("ConfluenceRateLimitError has correct name and message", () => {
    const err = new ConfluenceRateLimitError("Rate limited");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConfluenceRateLimitError");
    expect(err.message).toBe("Rate limited");
  });

  it("ConfluenceServerError has correct name and message", () => {
    const err = new ConfluenceServerError("Server error");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConfluenceServerError");
    expect(err.message).toBe("Server error");
  });

  it("ConfluenceNetworkError has correct name and message", () => {
    const err = new ConfluenceNetworkError("Network error");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConfluenceNetworkError");
    expect(err.message).toBe("Network error");
  });

  it("error classes are instances of their respective types", () => {
    expect(new ConfluenceNotConfiguredError("x")).toBeInstanceOf(ConfluenceNotConfiguredError);
    expect(new ConfluenceAuthError("x")).toBeInstanceOf(ConfluenceAuthError);
    expect(new ConfluenceNotFoundError("x")).toBeInstanceOf(ConfluenceNotFoundError);
    expect(new ConfluenceRateLimitError("x")).toBeInstanceOf(ConfluenceRateLimitError);
    expect(new ConfluenceServerError("x")).toBeInstanceOf(ConfluenceServerError);
    expect(new ConfluenceNetworkError("x")).toBeInstanceOf(ConfluenceNetworkError);
  });
});
