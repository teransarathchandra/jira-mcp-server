// ── Delivery Intelligence Layer — Analyze Implementation Impact Tool ──────────
// MCP tool handler: predict likely affected areas before implementation begins,
// using Jira context and optional Confluence signals.

import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { fetchIssueContext, type ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { analyzeImpact } from '../delivery/impactAnalyzer.js';
import type { ImpactArea, ImpactAnalysis } from '../delivery/deliveryTypes.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';

// Confluence imports (conditional — Confluence may not be configured)
import { isConfluenceEnabled, getConfluenceConfig } from '../confluence/confluenceConfig.js';
import { ConfluenceClient } from '../confluence/confluenceClient.js';
import {
  fetchConfluenceContext,
  type ConfluenceContextOptions,
} from '../confluence/confluenceContextService.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface DeliveryAnalyzeImpactInput {
  issueKey: string;
  includeConfluence: boolean;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatImpactAreaSection(title: string, areas: ImpactArea[]): string {
  if (areas.length === 0) {
    return `## ${title}\n\n*(none detected)*\n`;
  }

  const lines: string[] = [`## ${title}`, ''];

  for (const area of areas) {
    lines.push(`- **${area.area}** (${area.confidence} confidence)`);
    lines.push(`  ${area.description}`);
    for (const hint of area.searchHints) {
      lines.push(`  - ${hint}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function formatImpactAnalysis(analysis: ImpactAnalysis): string {
  const lines: string[] = [];

  lines.push(`# Implementation Impact Analysis: ${analysis.issueKey}`);
  lines.push('');
  lines.push(`> Issue: ${analysis.issueSummary}`);
  lines.push('');

  // Likely affected areas summary
  lines.push('## Likely Affected Areas');
  if (analysis.likelyAffectedAreas.length > 0) {
    for (const area of analysis.likelyAffectedAreas) {
      lines.push(`- ${area}`);
    }
  } else {
    lines.push('*(no areas detected from signals)*');
  }
  lines.push('');

  // Individual area sections
  lines.push(formatImpactAreaSection('Frontend Impact', analysis.frontend));
  lines.push(formatImpactAreaSection('Backend Impact', analysis.backend));
  lines.push(formatImpactAreaSection('API Impact', analysis.api));
  lines.push(formatImpactAreaSection('Data/Database Impact', analysis.database));
  lines.push(formatImpactAreaSection('Auth/Permission Impact', analysis.auth));
  lines.push(formatImpactAreaSection('Validation/Error Handling Impact', analysis.validation));
  lines.push(formatImpactAreaSection('Test Impact', analysis.testImpact));

  // Risky downstream flows
  lines.push('## Risky Downstream Flows');
  if (analysis.riskyDownstreamFlows.length > 0) {
    for (const flow of analysis.riskyDownstreamFlows) {
      lines.push(`- ${flow}`);
    }
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // Unknowns
  lines.push('## Unknowns');
  if (analysis.unknowns.length > 0) {
    for (const unknown of analysis.unknowns) {
      lines.push(`- ${unknown}`);
    }
  } else {
    lines.push('*(none)*');
  }
  lines.push('');

  // Repo inspection plan
  lines.push('## Suggested Repo Inspection Plan');
  if (analysis.repoInspectionPlan.length > 0) {
    for (let i = 0; i < analysis.repoInspectionPlan.length; i++) {
      lines.push(`${i + 1}. ${analysis.repoInspectionPlan[i]}`);
    }
  } else {
    lines.push('*(no specific inspection hints — explore the codebase manually)*');
  }

  return lines.join('\n');
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function deliveryAnalyzeImplementationImpact(
  input: DeliveryAnalyzeImpactInput,
  client: JiraClient,
  config: Config,
): Promise<string> {
  // ── Step 1: Validate issue key ──────────────────────────────────────────────
  validateIssueKey(input.issueKey);

  // ── Step 2: Fetch Jira context ──────────────────────────────────────────────
  const fetchOptions: ContextFetchOptions = {
    includeComments: false,
    includeParent: false,
    includeEpic: false,
    includeLinkedIssues: true,
    includeSubtasks: false,
    includeEpicSiblings: false,
    maxLinkedIssues: 10,
    maxSubtasks: 0,
    maxCommentsPerIssue: 0,
    contextDepth: 1,
  };

  const jiraContext = await fetchIssueContext(input.issueKey, fetchOptions, client, config);
  const { key, fields } = jiraContext.mainIssue;
  const issueSummary = fields.summary;
  const mainIssueDescription = jiraContext.mainIssueDescription;

  // ── Step 3: Extract Jira requirement signals ────────────────────────────────
  const requirementSignals = extractRequirements(mainIssueDescription);

  // ── Step 4: Optionally fetch Confluence context ─────────────────────────────
  let confluenceSignals: RequirementSignals | null = null;

  if (input.includeConfluence && isConfluenceEnabled()) {
    try {
      const confluenceConfig = getConfluenceConfig()!;

      const confluenceLinkRegex = /https?:\/\/[^\s]+atlassian\.net\/wiki\/[^\s]+/g;
      const confluenceLinks = mainIssueDescription.match(confluenceLinkRegex) ?? [];

      const technicalTerms = Array.from(
        new Set(
          mainIssueDescription
            .split(/\s+/)
            .map((w) => w.replace(/[^a-zA-Z0-9_-]/g, ''))
            .filter((w) => w.length >= 6),
        ),
      ).slice(0, 20);

      const contextOptions: ConfluenceContextOptions = {
        jiraIssueKey: input.issueKey,
        jiraSummary: issueSummary,
        jiraLabels: fields.labels ?? [],
        jiraComponents: (fields.components ?? []).map((c: { name: string }) => c.name),
        jiraTechnicalTerms: technicalTerms,
        jiraBusinessTerms: [],
        jiraLinkedIssueSummaries: jiraContext.linkedIssues.map((li) => li.summary),
        confluenceLinksFromJira: confluenceLinks,
        maxSearchResults: confluenceConfig.maxSearchResults,
        maxPagesToRead: confluenceConfig.maxPagesToRead,
        maxPageChars: confluenceConfig.maxPageChars,
      };

      const confluenceClient = new ConfluenceClient(confluenceConfig);
      const confluenceContext = await fetchConfluenceContext(
        contextOptions,
        confluenceClient,
        confluenceConfig,
      );

      const allConfluenceText = [
        ...confluenceContext.highRelevancePages,
        ...confluenceContext.mediumRelevancePages,
      ]
        .map((p) => p.bodyMarkdown)
        .join('\n\n');

      if (allConfluenceText.trim()) {
        confluenceSignals = extractRequirements(allConfluenceText);
      }
    } catch {
      // Confluence fetch failed — proceed without Confluence signals
    }
  }

  // ── Step 5: Analyze impact ──────────────────────────────────────────────────
  const components = (fields.components ?? []).map((c: { name: string }) => c.name);
  const labels: string[] = fields.labels ?? [];
  const linkedIssueSummaries = jiraContext.linkedIssues.map((li) => li.summary);

  const analysis = analyzeImpact({
    issueKey: key,
    issueSummary,
    issueDescription: mainIssueDescription,
    requirementSignals,
    confluenceSignals,
    components,
    labels,
    linkedIssueSummaries,
  });

  // ── Step 6: Format and return ──────────────────────────────────────────────
  return formatImpactAnalysis(analysis);
}
