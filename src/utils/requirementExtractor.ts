// ── Types ─────────────────────────────────────────────────────────────────────

export interface RequirementSignals {
  acceptanceCriteria: string[];  // extracted AC bullet points/lines
  technicalSignals: string[];    // file names, API endpoints, modules, components
  businessRules: string[];       // business logic/rule statements
  userRoles: string[];           // mentioned roles: admin, user, manager, etc.
  validationRules: string[];     // validation requirements
  ambiguities: string[];         // unclear/missing items detected
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_ITEMS = 20;

const USER_ROLE_KEYWORDS = [
  "admin",
  "administrator",
  "user",
  "manager",
  "supervisor",
  "viewer",
  "editor",
  "owner",
  "member",
  "guest",
  "operator",
  "developer",
];

const AMBIGUITY_MARKERS = [
  /\bTBD\b/,
  /\bTBC\b/,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bto be determined\b/i,
  /\bunclear\b/i,
  /\bnot sure\b/i,
  /\bneeds clarification\b/i,
  /\bpending\b/i,
  /\bundefined\b/i,
  /\bN\/A\b/,
];

const BUSINESS_RULE_KEYWORDS = /\b(must|should|shall|required|only|never|always|cannot)\b/i;
const CODE_PATTERN = /`[^`]+`|^\s{4,}|\t/;

const VALIDATION_KEYWORDS =
  /\b(required|must not be empty|minimum|maximum|max|min|valid|invalid|format|pattern|regex|length|characters)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deduplicate an array of strings, case-insensitively, preserving first occurrence.
 */
function dedup(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Trim and remove blank strings from an array, then deduplicate and cap at MAX_ITEMS.
 */
function finalize(items: string[]): string[] {
  return dedup(items.map((s) => s.trim()).filter(Boolean)).slice(0, MAX_ITEMS);
}

/**
 * Split text into individual lines.
 */
function toLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Split text into sentences (rough split on ". ", "? ", "! ").
 */
function toSentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/);
}

// ── AC extraction ─────────────────────────────────────────────────────────────

const AC_HEADING_PATTERN =
  /^#{1,6}\s*(?:acceptance criteria|ac|definition of done)\s*$/i;
const GIVEN_WHEN_THEN_PATTERN = /^\s*(?:given|when|then)\b/i;
const CHECKLIST_PATTERN = /^\s*-\s*\[[ x]\]/i;

function extractAcceptanceCriteria(text: string): string[] {
  const lines = toLines(text);
  const results: string[] = [];
  let inAcSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect AC heading
    if (AC_HEADING_PATTERN.test(trimmed) || /^(?:ac|acceptance criteria)\s*:/i.test(trimmed)) {
      inAcSection = true;
      continue;
    }

    // Stop at the next markdown heading
    if (inAcSection && /^#{1,6}\s/.test(trimmed) && !AC_HEADING_PATTERN.test(trimmed)) {
      inAcSection = false;
    }

    if (inAcSection) {
      if (trimmed) results.push(trimmed);
      continue;
    }

    // Given/When/Then lines anywhere
    if (GIVEN_WHEN_THEN_PATTERN.test(trimmed)) {
      results.push(trimmed);
      continue;
    }

    // Checklist items anywhere
    if (CHECKLIST_PATTERN.test(trimmed)) {
      results.push(trimmed);
    }
  }

  return finalize(results);
}

// ── Technical signals extraction ──────────────────────────────────────────────

const FILE_PATTERN =
  /\b[\w./\-]+\.(?:tsx?|jsx?|cs|py|go|rs|java|rb|php|sh|json|yaml|yml|env|sql|md)\b/g;
const API_PATH_PATTERN = /(?:\/api\/|\/rest\/)[\w/\-{}.:?=&%]*/g;
const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/g;
const PASCAL_CASE_PATTERN = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;

function extractTechnicalSignals(text: string): string[] {
  const results: string[] = [];

  for (const m of text.matchAll(FILE_PATTERN)) {
    results.push(m[0]);
  }
  for (const m of text.matchAll(API_PATH_PATTERN)) {
    results.push(m[0]);
  }
  for (const m of text.matchAll(URL_PATTERN)) {
    results.push(m[0]);
  }
  for (const m of text.matchAll(PASCAL_CASE_PATTERN)) {
    results.push(m[1]);
  }

  return finalize(results);
}

// ── Business rules extraction ──────────────────────────────────────────────────

function extractBusinessRules(text: string): string[] {
  const results: string[] = [];
  const candidates = [...toLines(text), ...toSentences(text)];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (CODE_PATTERN.test(trimmed)) continue;
    if (BUSINESS_RULE_KEYWORDS.test(trimmed)) {
      results.push(trimmed);
    }
  }

  return finalize(results);
}

// ── User roles extraction ──────────────────────────────────────────────────────

function extractUserRoles(text: string): string[] {
  const results: string[] = [];

  for (const role of USER_ROLE_KEYWORDS) {
    if (new RegExp(`\\b${role}\\b`, "i").test(text)) {
      results.push(role);
    }
  }

  return finalize(results);
}

// ── Validation rules extraction ───────────────────────────────────────────────

function extractValidationRules(text: string): string[] {
  const results: string[] = [];
  const candidates = [...toLines(text), ...toSentences(text)];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (CODE_PATTERN.test(trimmed)) continue;
    if (VALIDATION_KEYWORDS.test(trimmed)) {
      results.push(trimmed);
    }
  }

  return finalize(results);
}

// ── Ambiguities extraction ────────────────────────────────────────────────────

function extractAmbiguityItems(text: string): string[] {
  const results: string[] = [];
  const lines = toLines(text);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const marker of AMBIGUITY_MARKERS) {
      if (marker.test(trimmed)) {
        results.push(trimmed);
        break; // one hit per line is enough
      }
    }
  }

  return finalize(results);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract structured requirement signals from a Markdown/plain-text string.
 * Pure string analysis — no LLM calls.
 */
export function extractRequirements(text: string): RequirementSignals {
  return {
    acceptanceCriteria: extractAcceptanceCriteria(text),
    technicalSignals: extractTechnicalSignals(text),
    businessRules: extractBusinessRules(text),
    userRoles: extractUserRoles(text),
    validationRules: extractValidationRules(text),
    ambiguities: extractAmbiguityItems(text),
  };
}

/**
 * Convenience function: extract only ambiguity markers from a text string.
 * Equivalent to extractRequirements(text).ambiguities but skips other analysis.
 */
export function extractAmbiguities(text: string): string[] {
  return extractAmbiguityItems(text);
}
