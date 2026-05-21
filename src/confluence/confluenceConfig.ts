// ── Confluence config interface ────────────────────────────────────────────────

export interface ConfluenceConfig {
  baseUrl: string;                  // CONFLUENCE_BASE_URL (no trailing slash)
  email: string;                    // CONFLUENCE_EMAIL
  apiToken: string;                 // CONFLUENCE_API_TOKEN
  spaceKeys: string[];              // CONFLUENCE_SPACE_KEYS (comma-split, empty array if not set)
  maxSearchResults: number;         // CONFLUENCE_MAX_SEARCH_RESULTS (default 10, min 1 max 50)
  maxPagesToRead: number;           // CONFLUENCE_MAX_PAGES_TO_READ (default 5, min 1 max 20)
  maxPageChars: number;             // CONFLUENCE_MAX_PAGE_CHARS (default 12000, min 1000)
  enabled: boolean;                 // CONFLUENCE_ENABLED (default true)
  includeArchived: boolean;         // CONFLUENCE_INCLUDE_ARCHIVED (default false)
  requireSpaceAllowlist: boolean;   // CONFLUENCE_REQUIRE_SPACE_ALLOWLIST (default true)
  labelBoosts: string[];            // CONFLUENCE_LABEL_BOOSTS (default: requirements,prd,...)
  excludeLabels: string[];          // CONFLUENCE_EXCLUDE_LABELS (default: deprecated,archive,draft)
  titleBoostTerms: string[];        // CONFLUENCE_TITLE_BOOST_TERMS (default: requirement,prd,...)
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_LABEL_BOOSTS = [
  "requirements",
  "prd",
  "technical-design",
  "architecture",
  "user-guide",
  "release-notes",
];

const DEFAULT_EXCLUDE_LABELS = ["deprecated", "archive", "draft"];

const DEFAULT_TITLE_BOOST_TERMS = [
  "requirement",
  "prd",
  "design",
  "spec",
  "architecture",
  "flow",
];

// ── Parsing helpers ────────────────────────────────────────────────────────────

function parseCommaList(raw: string | undefined, defaults: string[]): string[] {
  if (!raw?.trim()) return defaults;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseClampedInt(
  raw: string | undefined,
  defaultVal: number,
  min: number,
  max: number
): number {
  if (!raw?.trim()) return defaultVal;
  const parsed = parseInt(raw.trim(), 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Parse a boolean env var.
 * "false" (case-insensitive) → false.
 * Anything else (including "true", "1", unset/empty) → defaultVal.
 */
function parseBool(raw: string | undefined, defaultVal: boolean): boolean {
  if (raw?.trim().toLowerCase() === "false") return false;
  if (raw?.trim().toLowerCase() === "true") return true;
  return defaultVal;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a ConfluenceConfig if Confluence is fully configured and enabled,
 * or null otherwise. NEVER throws — Confluence is optional.
 */
export function getConfluenceConfig(): ConfluenceConfig | null {
  const baseUrlRaw = process.env.CONFLUENCE_BASE_URL?.trim();

  // If BASE_URL is not set, Confluence is not configured at all.
  if (!baseUrlRaw) return null;

  // Check enabled flag before validating credentials.
  const enabledRaw = process.env.CONFLUENCE_ENABLED?.trim();
  const enabled = parseBool(enabledRaw, true);
  if (!enabled) return null;

  const email = process.env.CONFLUENCE_EMAIL?.trim();
  const apiToken = process.env.CONFLUENCE_API_TOKEN?.trim();

  // If BASE_URL is set but credentials are incomplete → incomplete config → null.
  if (!email || !apiToken) return null;

  // Strip trailing slash from baseUrl.
  const baseUrl = baseUrlRaw.replace(/\/$/, "");

  const spaceKeysRaw = process.env.CONFLUENCE_SPACE_KEYS?.trim();
  const spaceKeys = spaceKeysRaw
    ? spaceKeysRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const maxSearchResults = parseClampedInt(
    process.env.CONFLUENCE_MAX_SEARCH_RESULTS,
    10,
    1,
    50
  );

  const maxPagesToRead = parseClampedInt(
    process.env.CONFLUENCE_MAX_PAGES_TO_READ,
    5,
    1,
    20
  );

  const maxPageChars = parseClampedInt(
    process.env.CONFLUENCE_MAX_PAGE_CHARS,
    12000,
    1000,
    Infinity
  );

  const includeArchived = parseBool(
    process.env.CONFLUENCE_INCLUDE_ARCHIVED,
    false
  );

  const requireSpaceAllowlist = parseBool(
    process.env.CONFLUENCE_REQUIRE_SPACE_ALLOWLIST,
    true
  );

  const labelBoosts = parseCommaList(
    process.env.CONFLUENCE_LABEL_BOOSTS,
    DEFAULT_LABEL_BOOSTS
  );

  const excludeLabels = parseCommaList(
    process.env.CONFLUENCE_EXCLUDE_LABELS,
    DEFAULT_EXCLUDE_LABELS
  );

  const titleBoostTerms = parseCommaList(
    process.env.CONFLUENCE_TITLE_BOOST_TERMS,
    DEFAULT_TITLE_BOOST_TERMS
  );

  return {
    baseUrl,
    email,
    apiToken,
    spaceKeys,
    maxSearchResults,
    maxPagesToRead,
    maxPageChars,
    enabled,
    includeArchived,
    requireSpaceAllowlist,
    labelBoosts,
    excludeLabels,
    titleBoostTerms,
  };
}

/**
 * Returns true only if getConfluenceConfig() would return a non-null config.
 */
export function isConfluenceEnabled(): boolean {
  return getConfluenceConfig() !== null;
}

// ── Confluence error classes ───────────────────────────────────────────────────

/** Thrown when a Confluence tool is called but Confluence is not configured. */
export class ConfluenceNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfluenceNotConfiguredError";
  }
}

export class ConfluenceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfluenceAuthError";
  }
}

export class ConfluenceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfluenceNotFoundError";
  }
}

export class ConfluenceRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfluenceRateLimitError";
  }
}

export class ConfluenceServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfluenceServerError";
  }
}

export class ConfluenceNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfluenceNetworkError";
  }
}
