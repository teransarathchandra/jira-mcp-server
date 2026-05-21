import type { IssueContext } from '../jira/issueContextService.js';
import type { ConfluenceContext, ConfluencePageSummary } from './confluenceContextService.js';
import type { ConflictResult } from '../utils/conflictDetector.js';
import { formatJiraConfluenceConflicts } from '../utils/conflictDetector.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractAcceptanceCriteria(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const results: string[] = [];
  let inAcBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect AC section headings
    if (/^#+\s*(acceptance criteria|ac:|acceptance tests?)/i.test(trimmed)) {
      inAcBlock = true;
      continue;
    }
    // Stop at next heading
    if (inAcBlock && /^#+\s+/.test(trimmed)) {
      inAcBlock = false;
    }
    if (inAcBlock && trimmed.length > 0) {
      results.push(trimmed);
    }
    // Also pick up lines starting with "AC:" pattern anywhere
    if (!inAcBlock && /^ac:/i.test(trimmed)) {
      results.push(trimmed);
    }
  }

  return results;
}

function extractOpenQuestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.includes('?') && l.length > 10)
    .slice(0, 10);
}

// ── Main formatter ─────────────────────────────────────────────────────────────

/**
 * Format a combined Jira + Confluence context brief as structured Markdown.
 * Pure function — no I/O, no side effects.
 */
export function formatJiraConfluenceContextBrief(
  jiraContext: IssueContext,
  confluenceContext: ConfluenceContext | null,
  conflicts: ConflictResult
): string {
  const { mainIssue, mainIssueDescription } = jiraContext;
  const { key, fields } = mainIssue;

  const issueKey = key;
  const summary = fields.summary;
  const issueType = fields.issuetype.name;
  const status = fields.status.name;
  const labels = fields.labels?.length > 0 ? fields.labels.join(', ') : 'none';
  const components =
    fields.components?.length > 0
      ? fields.components.map((c: { name: string }) => c.name).join(', ')
      : 'none';

  const lines: string[] = [];

  // ── Title ─────────────────────────────────────────────────────────────────────
  lines.push(`# Jira + Confluence Context Brief: ${issueKey} — ${summary}`);
  lines.push('');

  // ── Main Jira Task ────────────────────────────────────────────────────────────
  lines.push('## Main Jira Task');
  lines.push(`- **Issue**: ${issueKey}`);
  lines.push(`- **Type**: ${issueType}`);
  lines.push(`- **Status**: ${status}`);
  lines.push(`- **Summary**: ${summary}`);
  lines.push(`- **Labels**: ${labels}`);
  lines.push(`- **Components**: ${components}`);
  lines.push('');

  // ── Jira Requirement Summary ──────────────────────────────────────────────────
  lines.push('## Jira Requirement Summary');
  const descTruncated =
    mainIssueDescription.length > 2000
      ? mainIssueDescription.slice(0, 2000) + '\n\n[... truncated ...]'
      : mainIssueDescription;
  lines.push(descTruncated || '_No description provided._');
  lines.push('');

  // ── Jira Authority / Readiness / Quality ──────────────────────────────────────
  lines.push('## Jira Authority / Readiness / Quality');
  if (jiraContext.parentIssue) {
    const parentDesc = jiraContext.parentDescription
      ? jiraContext.parentDescription.slice(0, 400)
      : jiraContext.parentIssue.fields.summary;
    lines.push(`**Parent (${jiraContext.parentIssue.key}):** ${parentDesc}`);
    lines.push('');
  }
  if (jiraContext.epicIssue) {
    const epicDesc = jiraContext.epicDescription
      ? jiraContext.epicDescription.slice(0, 400)
      : jiraContext.epicIssue.fields.summary;
    lines.push(`**Epic (${jiraContext.epicIssue.key}):** ${epicDesc}`);
    lines.push('');
  }
  if (!jiraContext.parentIssue && !jiraContext.epicIssue) {
    lines.push('_No parent or epic context available._');
    lines.push('');
  }

  // ── Related Confluence Pages ──────────────────────────────────────────────────
  lines.push('## Related Confluence Pages');
  if (confluenceContext === null) {
    lines.push('Confluence integration not enabled.');
  } else {
    const allRelevant = [
      ...confluenceContext.highRelevancePages,
      ...confluenceContext.mediumRelevancePages,
    ];
    if (allRelevant.length === 0) {
      lines.push('_No relevant Confluence pages found._');
    } else {
      for (const page of confluenceContext.highRelevancePages) {
        lines.push(`- **[HIGH]** [${page.title}](${page.url})`);
      }
      for (const page of confluenceContext.mediumRelevancePages) {
        lines.push(`- **[MEDIUM]** [${page.title}](${page.url})`);
      }
    }
  }
  lines.push('');

  // ── Confluence Requirement Insights ──────────────────────────────────────────
  lines.push('## Confluence Requirement Insights');
  if (confluenceContext !== null && confluenceContext.highRelevancePages.length > 0) {
    let hasInsights = false;
    for (const page of confluenceContext.highRelevancePages) {
      const allSignals = [
        ...page.signals.businessRules,
        ...page.signals.validationRules,
      ];
      if (allSignals.length > 0) {
        hasInsights = true;
        lines.push(`**${page.title}:**`);
        for (const signal of allSignals.slice(0, 5)) {
          lines.push(`- ${signal}`);
        }
      }
    }
    if (!hasInsights) {
      lines.push('_No requirement insights extracted from high-relevance pages._');
    }
  } else {
    lines.push('_No high-relevance Confluence pages to extract insights from._');
  }
  lines.push('');

  // ── Confluence Business Rules ─────────────────────────────────────────────────
  lines.push('## Confluence Business Rules');
  if (confluenceContext !== null && confluenceContext.highRelevancePages.length > 0) {
    let hasRules = false;
    for (const page of confluenceContext.highRelevancePages) {
      if (page.signals.businessRules.length > 0) {
        hasRules = true;
        lines.push(`**${page.title}:**`);
        for (const rule of page.signals.businessRules) {
          lines.push(`- ${rule}`);
        }
      }
    }
    if (!hasRules) {
      lines.push('_No business rules extracted._');
    }
  } else {
    lines.push('_No high-relevance Confluence pages to extract business rules from._');
  }
  lines.push('');

  // ── Confluence Technical Signals ──────────────────────────────────────────────
  lines.push('## Confluence Technical Signals');
  if (confluenceContext !== null && confluenceContext.highRelevancePages.length > 0) {
    let hasSignals = false;
    for (const page of confluenceContext.highRelevancePages) {
      const techSignals = [
        ...page.signals.apiEndpoints,
        ...page.signals.tableNames,
      ];
      if (techSignals.length > 0) {
        hasSignals = true;
        lines.push(`**${page.title}:**`);
        if (page.signals.apiEndpoints.length > 0) {
          lines.push(`- API Endpoints: ${page.signals.apiEndpoints.join(', ')}`);
        }
        if (page.signals.tableNames.length > 0) {
          lines.push(`- Tables: ${page.signals.tableNames.join(', ')}`);
        }
      }
    }
    if (!hasSignals) {
      lines.push('_No technical signals extracted._');
    }
  } else {
    lines.push('_No high-relevance Confluence pages to extract technical signals from._');
  }
  lines.push('');

  // ── Jira vs Confluence Conflicts ──────────────────────────────────────────────
  lines.push('## Jira vs Confluence Conflicts');
  const conflictText = formatJiraConfluenceConflicts(conflicts);
  lines.push(conflictText || 'No conflicts detected.');
  lines.push('');

  // ── Combined Acceptance Criteria ──────────────────────────────────────────────
  lines.push('## Combined Acceptance Criteria');
  const jiraAC = extractAcceptanceCriteria(mainIssueDescription);

  const confluenceAC: string[] = [];
  if (confluenceContext !== null) {
    for (const page of confluenceContext.highRelevancePages) {
      for (const section of page.sections) {
        if (/acceptance criteria/i.test(section.heading)) {
          const sectionLines = section.content
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .slice(0, 5);
          confluenceAC.push(...sectionLines);
        }
      }
    }
  }

  const allAC = [...jiraAC, ...confluenceAC];
  if (allAC.length > 0) {
    for (const ac of allAC) {
      lines.push(`- ${ac}`);
    }
  } else {
    lines.push('_No explicit acceptance criteria found. Derive from requirement summary._');
  }
  lines.push('');

  // ── Suggested Repo Inspection Targets ────────────────────────────────────────
  lines.push('## Suggested Repo Inspection Targets');
  if (confluenceContext !== null && confluenceContext.highRelevancePages.length > 0) {
    const allEndpoints: string[] = [];
    const allTables: string[] = [];
    for (const page of confluenceContext.highRelevancePages) {
      allEndpoints.push(...page.signals.apiEndpoints);
      allTables.push(...page.signals.tableNames);
    }
    const dedupEndpoints = [...new Set(allEndpoints)].slice(0, 8);
    const dedupTables = [...new Set(allTables)].slice(0, 8);

    if (dedupEndpoints.length > 0) {
      lines.push(`- API Endpoints: ${dedupEndpoints.join(', ')}`);
    }
    if (dedupTables.length > 0) {
      lines.push(`- Tables: ${dedupTables.join(', ')}`);
    }
    if (dedupEndpoints.length === 0 && dedupTables.length === 0) {
      lines.push('_No specific targets identified from Confluence pages._');
    }
  } else {
    lines.push('_No Confluence technical signals available for repo inspection hints._');
  }
  lines.push('');

  // ── Risks / Ambiguity ─────────────────────────────────────────────────────────
  lines.push('## Risks / Ambiguity');
  const risks: string[] = [];

  if (jiraContext.truncationWarnings.length > 0) {
    for (const warn of jiraContext.truncationWarnings) {
      risks.push(`- [Jira] ${warn}`);
    }
  }

  if (confluenceContext !== null && confluenceContext.budgetWarnings.length > 0) {
    for (const warn of confluenceContext.budgetWarnings) {
      risks.push(`- [Confluence] ${warn}`);
    }
  }

  if (conflicts.hasConflicts) {
    risks.push(`- ${conflicts.conflicts.length} Jira vs Confluence conflict(s) detected. See conflicts section above.`);
  }

  lines.push(risks.length > 0 ? risks.join('\n') : 'No specific risks identified.');
  lines.push('');

  // ── Clarification Needed ──────────────────────────────────────────────────────
  lines.push('## Clarification Needed');
  const openQuestions = extractOpenQuestions(mainIssueDescription);
  if (openQuestions.length > 0) {
    for (const q of openQuestions) {
      lines.push(`- ${q}`);
    }
  } else {
    lines.push('_No open questions detected in Jira description._');
  }
  lines.push('');

  // ── Final Implementation Prompt ───────────────────────────────────────────────
  lines.push('## Final Implementation Prompt for Claude Code');
  lines.push('');
  lines.push(`You are implementing ${issueKey}: ${summary}`);
  lines.push('');

  lines.push('### Requirement (Primary — Jira)');
  const descForPrompt =
    mainIssueDescription.length > 1500
      ? mainIssueDescription.slice(0, 1500) + '\n\n[... truncated ...]'
      : mainIssueDescription;
  lines.push(descForPrompt || '_No description provided._');
  lines.push('');

  lines.push('### Supporting Confluence Documentation');
  if (confluenceContext !== null) {
    const allSupportingPages: ConfluencePageSummary[] = [
      ...confluenceContext.highRelevancePages,
      ...confluenceContext.mediumRelevancePages,
    ];
    if (allSupportingPages.length > 0) {
      for (const page of allSupportingPages) {
        lines.push(`- ${page.title}: ${page.url}`);
      }
    } else {
      lines.push('_No relevant Confluence pages found._');
    }
  } else {
    lines.push('_Confluence integration not enabled._');
  }
  lines.push('');

  lines.push('### Combined Acceptance Criteria');
  if (allAC.length > 0) {
    for (const ac of allAC) {
      lines.push(`- ${ac}`);
    }
  } else {
    lines.push('_Derive from requirement summary above._');
  }
  lines.push('');

  lines.push('### Rules');
  lines.push('- Inspect the repo before editing. Read relevant files before making changes.');
  lines.push('- Implement only confirmed requirements from the Jira task.');
  lines.push('- Do not implement broad Confluence background content unless it directly supports this Jira task.');
  lines.push('- Treat Jira acceptance criteria and latest Jira comments as primary authority.');
  lines.push('- Treat directly-linked Confluence pages as supporting/authoritative documentation.');
  lines.push('- Treat keyword-matched Confluence pages as background only unless strongly relevant.');
  lines.push('- Flag conflicts instead of guessing. If Jira and Confluence disagree, note it and follow Jira.');
  lines.push('- Follow existing project conventions (code style, testing patterns, file structure).');
  lines.push('- Add or update tests when behavior changes.');

  if (conflicts.hasConflicts) {
    lines.push('- WARNING: Jira vs Confluence conflicts detected. See conflicts section above.');
  }

  return lines.join('\n');
}
