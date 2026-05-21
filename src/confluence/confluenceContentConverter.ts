// ── Types ──────────────────────────────────────────────────────────────────────

export interface Section {
  heading: string;
  level: number; // 1-6 for h1-h6
  content: string;
}

export interface ConfluenceSignals {
  businessRules: string[];
  userRoles: string[];
  apiEndpoints: string[];
  uiScreens: string[];
  tableNames: string[];
  validationRules: string[];
  featureFlags: string[];
  permissions: string[];
  releaseNotes: string[];
  knownLimitations: string[];
  dependencies: string[];
  testingNotes: string[];
  diagramsMentioned: string[];
  relatedPageLinks: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
 * Split text into individual lines.
 */
function toLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Extract all lines matching a regex, trim them, deduplicate and cap at max.
 */
function extractMatchingLines(text: string, pattern: RegExp, max: number): string[] {
  const results: string[] = [];
  for (const line of toLines(text)) {
    const trimmed = line.trim();
    if (trimmed && pattern.test(trimmed)) {
      results.push(trimmed);
    }
  }
  return dedup(results).slice(0, max);
}

/**
 * Extract all regex matches from text, deduplicate and cap at max.
 */
function extractAllMatches(text: string, pattern: RegExp, groupIndex: number, max: number): string[] {
  const matches = Array.from(text.matchAll(pattern));
  const results = matches.map((m) => m[groupIndex] ?? "").filter(Boolean);
  return dedup(results).slice(0, max);
}

// ── confluenceHtmlToMarkdown ───────────────────────────────────────────────────

/**
 * Convert Confluence HTML/storage format to readable Markdown.
 * Pure function — no I/O, no side effects.
 */
export function confluenceHtmlToMarkdown(html: string): string {
  if (!html) return "";

  let text = html;

  // 1. Strip script and style tags completely
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // 2. Handle Confluence structured macros
  // Code macros: extract inner text, wrap in ``` block
  text = text.replace(
    /<ac:structured-macro[^>]*ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (_match, inner) => {
      // Extract plain text content from inner XML/HTML
      const content = inner
        .replace(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/gi, "$1")
        .replace(/<[^>]+>/g, "")
        .trim();
      return `\`\`\`\n${content}\n\`\`\``;
    }
  );

  // Info/note/warning/panel macros: prepend "> " (blockquote)
  text = text.replace(
    /<ac:structured-macro[^>]*ac:name="(?:info|note|warning|panel)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (_match, inner) => {
      const content = inner.replace(/<[^>]+>/g, "").trim();
      return `> ${content}`;
    }
  );

  // Other macros: strip the macro tags, keep inner content
  text = text.replace(/<ac:structured-macro[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi, "$1");
  // Strip remaining ac: tags
  text = text.replace(/<\/?ac:[^>]*>/gi, "");
  text = text.replace(/<\/?ri:[^>]*>/gi, "");

  // 3. Convert headings
  text = text.replace(/<h1[^>]*>/gi, "# ");
  text = text.replace(/<\/h1>/gi, "\n");
  text = text.replace(/<h2[^>]*>/gi, "## ");
  text = text.replace(/<\/h2>/gi, "\n");
  text = text.replace(/<h3[^>]*>/gi, "### ");
  text = text.replace(/<\/h3>/gi, "\n");
  text = text.replace(/<h4[^>]*>/gi, "#### ");
  text = text.replace(/<\/h4>/gi, "\n");
  text = text.replace(/<h5[^>]*>/gi, "##### ");
  text = text.replace(/<\/h5>/gi, "\n");
  text = text.replace(/<h6[^>]*>/gi, "###### ");
  text = text.replace(/<\/h6>/gi, "\n");

  // 4. Convert formatting
  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");

  // 5. Convert lists
  // Handle ordered lists: track index
  text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner) => {
    let index = 0;
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, content: string) => {
      index++;
      return `${index}. ${content.replace(/<[^>]+>/g, "").trim()}\n`;
    });
  });

  // Handle unordered lists
  text = text.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_match, inner) => {
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, content: string) => {
      return `- ${content.replace(/<[^>]+>/g, "").trim()}\n`;
    });
  });

  // Catch any remaining <li> tags not inside ol/ul
  text = text.replace(/<li[^>]*>/gi, "- ");
  text = text.replace(/<\/li>/gi, "\n");

  // 6. Convert links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // 7. Convert code
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```");
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // 8. Convert table rows
  text = text.replace(/<tr[^>]*>/gi, "\n| ");
  text = text.replace(/<\/tr>/gi, "");
  text = text.replace(/<td[^>]*>/gi, "");
  text = text.replace(/<\/td>/gi, " | ");
  text = text.replace(/<th[^>]*>/gi, "");
  text = text.replace(/<\/th>/gi, " | ");
  // Strip table wrapper tags
  text = text.replace(/<\/?(table|thead|tbody|tfoot)[^>]*>/gi, "\n");

  // 9. Convert <br> and <br/>
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // 10. Convert <p> close </p>
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<p[^>]*>/gi, "");

  // 11. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // 12. Decode HTML entities
  text = text.replace(/&amp;/gi, "&");
  text = text.replace(/&lt;/gi, "<");
  text = text.replace(/&gt;/gi, ">");
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&nbsp;/gi, " ");

  // 13. Collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, "\n\n");

  // 14. Trim
  return text.trim();
}

// ── extractConfluenceSections ─────────────────────────────────────────────────

/**
 * Parse markdown headings and group content under them.
 * Pure function — no I/O, no side effects.
 */
export function extractConfluenceSections(markdown: string): Section[] {
  if (!markdown) return [];

  const lines = toLines(markdown);
  const sections: Section[] = [];
  const headingPattern = /^(#{1,6})\s+(.+)$/;

  let currentSection: Section | null = null;
  const contentLines: string[] = [];

  for (const line of lines) {
    const match = headingPattern.exec(line);
    if (match) {
      // Save previous section if any
      if (currentSection !== null) {
        currentSection.content = contentLines.join("\n").trim();
        sections.push(currentSection);
        contentLines.length = 0;
      }
      currentSection = {
        heading: match[2].trim(),
        level: match[1].length,
        content: "",
      };
    } else if (currentSection !== null) {
      contentLines.push(line);
    }
  }

  // Push last section
  if (currentSection !== null) {
    currentSection.content = contentLines.join("\n").trim();
    sections.push(currentSection);
  }

  return sections;
}

// ── extractConfluenceSignals ──────────────────────────────────────────────────

/**
 * Extract signals from page markdown using regex patterns.
 * Pure function — no I/O, no side effects.
 */
export function extractConfluenceSignals(markdown: string): ConfluenceSignals {
  const empty: ConfluenceSignals = {
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

  if (!markdown) return empty;

  // businessRules: lines matching must/shall/required to/business rule
  const businessRules = extractMatchingLines(
    markdown,
    /must\b|shall\b|required to\b|business rule/i,
    10
  );

  // userRoles: extract matches from role keywords, deduplicate
  const userRoles = extractAllMatches(
    markdown,
    /\b(admin|administrator|manager|editor|viewer|owner|guest|member|user|customer|operator)\b/gi,
    1,
    10
  ).map((r) => r.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).slice(0, 10);

  // apiEndpoints: lines matching API path patterns — extract the matched portion
  const apiEndpoints: string[] = [];
  const apiLinePattern = /GET\s+\/[^\s"'<>]*|POST\s+\/[^\s"'<>]*|PUT\s+\/[^\s"'<>]*|DELETE\s+\/[^\s"'<>]*|PATCH\s+\/[^\s"'<>]*|\/(api|v\d+)\/[^\s"'<>]+/i;
  for (const line of toLines(markdown)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(apiLinePattern);
    if (m) {
      apiEndpoints.push(m[0]);
    }
  }
  const apiEndpointsFinal = dedup(apiEndpoints).slice(0, 10);

  // uiScreens: lines matching screen/page/modal/etc
  const uiScreens = extractMatchingLines(
    markdown,
    /\b(screen|page|modal|dialog|form|panel|dashboard|view|tab|drawer)\b/i,
    8
  );

  // tableNames: extract table name from patterns
  const tableNameMatches: string[] = [];
  const tableMatches = Array.from(
    markdown.matchAll(/\b([a-z_][a-z0-9_]*)\s+table\b|\btable\s+([a-z_][a-z0-9_]*)/gi)
  );
  for (const m of tableMatches) {
    const name = m[1] || m[2];
    if (name) tableNameMatches.push(name);
  }
  const tableNames = dedup(tableNameMatches).slice(0, 8);

  // validationRules: lines matching validation keywords
  const validationRules = extractMatchingLines(
    markdown,
    /\bvalidat(e|ion|or)\b|\berror message\b|\binvalid\b|\brequired field\b/i,
    8
  );

  // featureFlags: lines matching feature flag patterns
  const featureFlags = extractMatchingLines(
    markdown,
    /\bfeature flag\b|\bfeature toggle\b|\bFF_[A-Z_]+\b|\benable[d]?\b.*\bfeature\b/i,
    5
  );

  // permissions: lines matching permission/role/access control/authorization
  const permissions = extractMatchingLines(
    markdown,
    /\bpermission\b|\brole\b|\baccess control\b|\bauthoriz(e|ation)\b/i,
    8
  );

  // releaseNotes: lines matching version/release/changelog patterns
  const releaseNotes = extractMatchingLines(
    markdown,
    /\bv\d+\.\d+|\brelease \d|\bversion \d|\bchangelog\b/i,
    8
  );

  // knownLimitations: lines matching limitation/not support/caveat/constraint
  const knownLimitations = extractMatchingLines(
    markdown,
    /\blimitation\b|\bnot support\b|\bdoes not support\b|\bcaveat\b|\bconstraint\b/i,
    5
  );

  // dependencies: lines matching dependency/requires service/integration
  const dependencies = extractMatchingLines(
    markdown,
    /\bdepend(s on|ency|encies)\b|\brequires?\b.*\bservice\b|\bintegrat(e|ion)\b/i,
    8
  );

  // testingNotes: lines matching testing keywords
  const testingNotes = extractMatchingLines(
    markdown,
    /\btest(ing)?\b|\bunit test\b|\bintegration test\b|\be2e\b|\bqa\b/i,
    5
  );

  // diagramsMentioned: lines matching diagram keywords
  const diagramsMentioned = extractMatchingLines(
    markdown,
    /\bdiagram\b|\bflowchart\b|\bsequence diagram\b|\bER diagram\b|\barchitecture diagram\b/i,
    5
  );

  // relatedPageLinks: extract [text](url) markdown links where url contains atlassian.net or confluence
  const relatedPageLinks: string[] = [];
  const linkMatches = Array.from(
    markdown.matchAll(/\[([^\]]*)\]\(([^)]*(?:atlassian\.net|confluence)[^)]*)\)/gi)
  );
  for (const m of linkMatches) {
    relatedPageLinks.push(m[0]);
  }
  const relatedPageLinksFinal = dedup(relatedPageLinks).slice(0, 10);

  return {
    businessRules,
    userRoles,
    apiEndpoints: apiEndpointsFinal,
    uiScreens,
    tableNames,
    validationRules,
    featureFlags,
    permissions,
    releaseNotes,
    knownLimitations,
    dependencies,
    testingNotes,
    diagramsMentioned,
    relatedPageLinks: relatedPageLinksFinal,
  };
}

// ── isStaleOrDeprecated ───────────────────────────────────────────────────────

/**
 * Returns true if the page appears to be stale, deprecated, or archived.
 * Pure function — no I/O, no side effects.
 */
export function isStaleOrDeprecated(
  title: string,
  labels: string[],
  bodySnippet: string
): boolean {
  // Check title
  if (/deprecated|archive|archived|draft|legacy|old |obsolete|do not use|outdated/.test(
    title.toLowerCase()
  )) {
    return true;
  }

  // Check labels
  const staleLabels = ["deprecated", "archive", "draft", "legacy", "obsolete"];
  for (const label of labels) {
    if (staleLabels.includes(label.toLowerCase())) {
      return true;
    }
  }

  // Check body snippet start
  const staleBodyPrefixes = [
    "this page is deprecated",
    "this page is outdated",
    "this page is no longer",
    "do not use",
    "deprecated",
    "archived",
    "this content is deprecated",
  ];
  const bodyStart = bodySnippet.toLowerCase().trimStart();
  for (const prefix of staleBodyPrefixes) {
    if (bodyStart.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}
