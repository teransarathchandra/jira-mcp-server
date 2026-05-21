// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthorityLevel = 'very_high' | 'high' | 'medium' | 'low' | 'noise';

export interface AuthoritySource {
  label: string;
  authorityLevel: AuthorityLevel;
  reason: string;
  issuedBy?: string;
  date?: string;
}

export interface AuthorityRanking {
  primarySources: AuthoritySource[];          // very_high + high
  supportingSources: AuthoritySource[];       // medium
  lowerConfidenceSources: AuthoritySource[];  // low
  noiseSources: AuthoritySource[];            // noise
  notes: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isHighAuthorityEmail(
  email: string | undefined,
  highAuthorityEmails: string[],
): boolean {
  if (!email) return false;
  return highAuthorityEmails.some(
    (e) => e.toLowerCase() === email.toLowerCase(),
  );
}

function hasRequirementChangeOrAcSignal(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('acceptance criteria') ||
    lower.includes('ac:') ||
    lower.includes('definition of done') ||
    lower.includes('change') ||
    lower.includes('update the requirement') ||
    lower.includes('instead') ||
    lower.includes('actually')
  );
}

// ── Main function ─────────────────────────────────────────────────────────────

export function rankAuthority(params: {
  mainDescription: string | null;
  hasExplicitAC: boolean;
  comments: Array<{
    author: string;
    body: string;
    created: string;
    isUseful: boolean;
    hasRequirementSignals: boolean;
  }>;
  parentDescription: string | null;
  epicDescription: string | null;
  linkedIssueRelationships: string[];
  highAuthorityEmails: string[];
  highAuthorityAccountIds: string[];
  reporterEmail?: string;
  assigneeEmail?: string;
}): AuthorityRanking {
  const {
    mainDescription,
    hasExplicitAC,
    comments,
    parentDescription,
    epicDescription,
    linkedIssueRelationships,
    highAuthorityEmails,
    reporterEmail,
    assigneeEmail,
  } = params;

  const primarySources: AuthoritySource[] = [];
  const supportingSources: AuthoritySource[] = [];
  const lowerConfidenceSources: AuthoritySource[] = [];
  const noiseSources: AuthoritySource[] = [];
  const notes: string[] = [];

  // ── Main description ──────────────────────────────────────────────────────

  if (!mainDescription || mainDescription.trim().length === 0) {
    noiseSources.push({
      label: 'Main description',
      authorityLevel: 'noise',
      reason: 'Description is empty',
    });
  } else if (hasExplicitAC) {
    primarySources.push({
      label: 'Main description (with explicit AC)',
      authorityLevel: 'very_high',
      reason: 'Contains an explicit acceptance criteria section',
    });
  } else {
    primarySources.push({
      label: 'Main description',
      authorityLevel: 'high',
      reason: 'Primary issue description is present',
    });
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  // Sort comments by date, most recent first
  const sortedComments = [...comments].sort((a, b) => {
    return new Date(b.created).getTime() - new Date(a.created).getTime();
  });

  let latestUsefulWithSignalHandled = false;

  for (const comment of sortedComments) {
    const dateStr = new Date(comment.created).toISOString().slice(0, 10);
    const label = `Comment by ${comment.author} (${dateStr})`;

    if (!comment.isUseful) {
      noiseSources.push({
        label,
        authorityLevel: 'noise',
        reason: 'Comment does not contain useful content',
        issuedBy: comment.author,
        date: dateStr,
      });
      continue;
    }

    const isReporter = reporterEmail
      ? comment.author.toLowerCase().includes(reporterEmail.toLowerCase()) ||
        reporterEmail.toLowerCase().includes(comment.author.toLowerCase())
      : false;
    const isAssignee = assigneeEmail
      ? comment.author.toLowerCase().includes(assigneeEmail.toLowerCase()) ||
        assigneeEmail.toLowerCase().includes(comment.author.toLowerCase())
      : false;
    const isHighAuthority = isHighAuthorityEmail(
      comment.author,
      highAuthorityEmails,
    );

    const hasAcOrRequirementChangeSignal = hasRequirementChangeOrAcSignal(
      comment.body,
    );

    // very_high: latest useful comment with requirement_change/AC signal from
    // reporter, assignee, or high-authority author
    if (
      !latestUsefulWithSignalHandled &&
      hasAcOrRequirementChangeSignal &&
      comment.hasRequirementSignals &&
      (isReporter || isAssignee || isHighAuthority)
    ) {
      primarySources.push({
        label: `Latest comment by ${comment.author} (${dateStr})`,
        authorityLevel: 'very_high',
        reason:
          'Latest useful comment with requirement/AC change signal from reporter, assignee, or high-authority author',
        issuedBy: comment.author,
        date: dateStr,
      });
      latestUsefulWithSignalHandled = true;

      // Check for conflict with main description
      if (mainDescription && mainDescription.trim().length > 0) {
        notes.push(
          `Latest comment by ${comment.author} may conflict with or update the main description — verify alignment.`,
        );
      }
      continue;
    }

    // high: high-authority email
    if (isHighAuthority) {
      primarySources.push({
        label: `Comment by high-authority author ${comment.author} (${dateStr})`,
        authorityLevel: 'high',
        reason: 'Comment is from a high-authority email',
        issuedBy: comment.author,
        date: dateStr,
      });
      continue;
    }

    // high: latest useful comment with requirement signals (not already very_high)
    if (!latestUsefulWithSignalHandled && comment.hasRequirementSignals) {
      primarySources.push({
        label: `Latest useful comment by ${comment.author} (${dateStr})`,
        authorityLevel: 'high',
        reason: 'Latest useful comment with requirement signals',
        issuedBy: comment.author,
        date: dateStr,
      });
      latestUsefulWithSignalHandled = true;
      continue;
    }

    // medium: older comments with requirement signals or just useful
    if (comment.hasRequirementSignals) {
      supportingSources.push({
        label,
        authorityLevel: 'medium',
        reason: 'Older comment with requirement signals',
        issuedBy: comment.author,
        date: dateStr,
      });
      continue;
    }

    // low: useful but no requirement signals and length > 100
    if (comment.body.trim().length > 100) {
      lowerConfidenceSources.push({
        label,
        authorityLevel: 'low',
        reason: 'Useful comment without requirement signals (length > 100)',
        issuedBy: comment.author,
        date: dateStr,
      });
      continue;
    }

    // medium: useful comments not matching higher criteria
    supportingSources.push({
      label,
      authorityLevel: 'medium',
      reason: 'Useful comment without strong requirement signals',
      issuedBy: comment.author,
      date: dateStr,
    });
  }

  // ── Parent issue description ───────────────────────────────────────────────

  if (parentDescription && parentDescription.trim().length > 0) {
    supportingSources.push({
      label: 'Parent issue description',
      authorityLevel: 'medium',
      reason: 'Provides business context from parent issue',
    });
  }

  // ── Epic description ──────────────────────────────────────────────────────

  if (epicDescription && epicDescription.trim().length > 0) {
    supportingSources.push({
      label: 'Epic description',
      authorityLevel: 'medium',
      reason: 'Provides epic-level business context',
    });
  }

  // ── Linked issue relationships ────────────────────────────────────────────

  const blockingRelationships = ['blocks', 'is blocked by', 'depends on'];
  const relatesRelationships = ['relates to'];

  for (const rel of linkedIssueRelationships) {
    const relLower = rel.toLowerCase();
    if (blockingRelationships.some((r) => relLower.includes(r))) {
      supportingSources.push({
        label: `Linked issue (${rel})`,
        authorityLevel: 'medium',
        reason: `Blocking relationship (${rel}) carries dependency context`,
      });
    } else if (relatesRelationships.some((r) => relLower.includes(r))) {
      lowerConfidenceSources.push({
        label: `Linked issue (${rel})`,
        authorityLevel: 'low',
        reason: 'Relates-to relationships have weak authority signals',
      });
    }
  }

  return {
    primarySources,
    supportingSources,
    lowerConfidenceSources,
    noiseSources,
    notes,
  };
}

// ── Format function ───────────────────────────────────────────────────────────

export function formatAuthoritySection(ranking: AuthorityRanking): string {
  const primaryLabels =
    ranking.primarySources.length > 0
      ? ranking.primarySources.map((s) => s.label).join(', ')
      : 'None';

  const supportingLabels =
    ranking.supportingSources.length > 0
      ? ranking.supportingSources.map((s) => s.label).join(', ')
      : 'None';

  const lowerLabels =
    ranking.lowerConfidenceSources.length > 0
      ? ranking.lowerConfidenceSources.map((s) => s.label).join(', ')
      : 'None';

  const notesText =
    ranking.notes.length > 0
      ? ranking.notes.join(' ')
      : 'No special notes.';

  return [
    '## Requirement Authority',
    `- **Primary sources:** ${primaryLabels}`,
    `- **Supporting sources:** ${supportingLabels}`,
    `- **Lower-confidence sources:** ${lowerLabels}`,
    `- **Notes:** ${notesText}`,
  ].join('\n');
}
