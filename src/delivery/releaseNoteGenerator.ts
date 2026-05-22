// ── Delivery Intelligence Layer — Release Note Generator ──────────────────────
// Pure deterministic logic — no I/O. Given Jira + PR context, produces
// audience-aware release notes.

import type { ReleaseNote, ReleaseAudience, ImpactAnalysis } from './deliveryTypes.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface ReleaseNoteInput {
  issueKey: string;
  issueSummary: string;
  issueDescription: string;
  requirementSignals: RequirementSignals;
  classifiedFiles?: ClassifiedFiles | null;
  changedFilePaths: string[];
  impactAnalysis: ImpactAnalysis;
  audience: ReleaseAudience;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasLockFiles(
  classifiedFiles: ClassifiedFiles | null | undefined,
  changedFilePaths: string[],
): boolean {
  if (classifiedFiles) {
    return classifiedFiles.lockFiles.length > 0;
  }
  const LOCK_FILE_NAMES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Gemfile.lock',
    'Pipfile.lock',
    'poetry.lock',
    'composer.lock',
    'Cargo.lock',
    'go.sum',
    'bun.lockb',
  ]);
  return changedFilePaths.some((p) => {
    const name = p.split('/').pop() ?? p;
    return LOCK_FILE_NAMES.has(name);
  });
}

function hasMigrationFiles(
  classifiedFiles: ClassifiedFiles | null | undefined,
  changedFilePaths: string[],
): boolean {
  if (classifiedFiles) {
    return classifiedFiles.migrationFiles.length > 0;
  }
  return changedFilePaths.some((p) => {
    const lower = p.toLowerCase();
    return (
      lower.includes('/migrations/') ||
      lower.includes('/migration/') ||
      lower.includes('/db/migrate/') ||
      lower.endsWith('.sql')
    );
  });
}

function hasConfigFiles(
  classifiedFiles: ClassifiedFiles | null | undefined,
  changedFilePaths: string[],
): boolean {
  if (classifiedFiles) {
    return classifiedFiles.configFiles.length > 0;
  }
  const CONFIG_PATTERNS = [
    /\.env/i,
    /tsconfig\.json$/i,
    /package\.json$/i,
    /docker-compose/i,
    /dockerfile/i,
    /\.ya?ml$/i,
  ];
  return changedFilePaths.some((p) => CONFIG_PATTERNS.some((re) => re.test(p)));
}

function hasDiff(
  classifiedFiles: ClassifiedFiles | null | undefined,
  changedFilePaths: string[],
): boolean {
  if (classifiedFiles) {
    const total =
      classifiedFiles.sourceFiles.length +
      classifiedFiles.testFiles.length +
      classifiedFiles.configFiles.length +
      classifiedFiles.migrationFiles.length +
      classifiedFiles.lockFiles.length +
      classifiedFiles.generatedFiles.length +
      classifiedFiles.documentationFiles.length;
    return total > 0;
  }
  return changedFilePaths.length > 0;
}

function buildTechnicalImpactAreas(impactAnalysis: ImpactAnalysis): string[] {
  const areas: string[] = [];
  if (impactAnalysis.frontend.length > 0) areas.push('Frontend UI');
  if (impactAnalysis.backend.length > 0) areas.push('Backend Service');
  if (impactAnalysis.api.length > 0) areas.push('API Layer');
  if (impactAnalysis.database.length > 0) areas.push('Data / Database');
  if (impactAnalysis.auth.length > 0) areas.push('Auth / Permissions');
  if (impactAnalysis.validation.length > 0) areas.push('Validation / Error Handling');
  return areas;
}

function getRiskyReasonLabels(classifiedFiles: ClassifiedFiles | null | undefined): string[] {
  if (!classifiedFiles) return [];

  const reasons = new Set<string>();
  for (const riskyFile of classifiedFiles.riskyFiles) {
    for (const reason of riskyFile.reasons) {
      reasons.add(reason);
    }
  }

  const labels: string[] = [];
  if (reasons.has('database_migration')) labels.push('Data migration risk');
  if (reasons.has('auth_or_permissions')) labels.push('Auth flow risk');
  if (reasons.has('payment_or_financial')) labels.push('Payment processing risk');
  if (reasons.has('config_or_environment')) labels.push('Configuration/environment change risk');
  if (reasons.has('dependency_update')) labels.push('Dependency update risk');
  if (reasons.has('lock_file')) labels.push('Lock file changed — dependency tree modified');
  if (reasons.has('deleted_file')) labels.push('File deleted — verify no downstream consumers');
  return labels;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateReleaseNote(input: ReleaseNoteInput): ReleaseNote {
  const {
    issueKey,
    issueSummary,
    issueDescription,
    requirementSignals,
    classifiedFiles,
    changedFilePaths,
    impactAnalysis,
    audience,
  } = input;

  const firstAc = requirementSignals.acceptanceCriteria[0] ?? null;

  // ── summary ───────────────────────────────────────────────────────────────
  let summary: string;
  if (audience === 'customer_safe') {
    summary = issueSummary.slice(0, 150);
  } else if (audience === 'product' || audience === 'qa') {
    summary = firstAc
      ? `${issueSummary} — ${firstAc.slice(0, 120)}`
      : issueSummary;
  } else {
    // internal
    const descSnippet = issueDescription ? issueDescription.trim().slice(0, 200) : '';
    summary = descSnippet ? `${issueSummary} — ${descSnippet}` : issueSummary;
  }

  // ── userImpact ────────────────────────────────────────────────────────────
  let userImpact: string;
  if (audience === 'customer_safe') {
    userImpact = `Users will notice: ${issueSummary}`;
  } else {
    const frontendDesc =
      impactAnalysis.frontend.length > 0
        ? ` Affects frontend: ${impactAnalysis.frontend[0].area}.`
        : '';
    const acDesc = firstAc ? ` Key acceptance criteria: ${firstAc.slice(0, 120)}.` : '';
    userImpact = `${issueSummary}.${acDesc}${frontendDesc}`.trim();
  }

  // ── technicalImpact ───────────────────────────────────────────────────────
  let technicalImpact: string;
  if (audience === 'customer_safe') {
    technicalImpact = '';
  } else {
    const areas = buildTechnicalImpactAreas(impactAnalysis);
    technicalImpact = areas.length > 0 ? areas.join(', ') : 'No specific technical impact detected';
  }

  // ── configMigrationNotes ──────────────────────────────────────────────────
  const configMigrationNotes: string[] = [];

  const migrationPresent = hasMigrationFiles(classifiedFiles, changedFilePaths);
  const configPresent = hasConfigFiles(classifiedFiles, changedFilePaths);

  if (migrationPresent && audience !== 'customer_safe') {
    configMigrationNotes.push('Database migration required — review migration scripts');
  }
  if (configPresent && audience !== 'customer_safe') {
    configMigrationNotes.push('Configuration changes — update environment variables');
  }

  // ── riskNotes ─────────────────────────────────────────────────────────────
  const riskNotes: string[] = [];

  if (audience === 'customer_safe') {
    // never show risk to customers
  } else {
    const riskyLabels = getRiskyReasonLabels(classifiedFiles);
    riskNotes.push(...riskyLabels);

    const diffPresent = hasDiff(classifiedFiles, changedFilePaths);
    if (!diffPresent) {
      riskNotes.push('Impact assessment incomplete — review before release');
    }
  }

  // ── rollbackNotes ─────────────────────────────────────────────────────────
  const rollbackNotes: string[] = [];

  if (audience === 'customer_safe') {
    // never show rollback to customers
  } else {
    const lockPresent = hasLockFiles(classifiedFiles, changedFilePaths);

    if (migrationPresent) {
      rollbackNotes.push('Review database rollback procedure before deploying');
    }
    if (lockPresent) {
      rollbackNotes.push('Restore package-lock.json if rollback needed');
    }

    if (riskNotes.length === 0 && !migrationPresent && !lockPresent) {
      rollbackNotes.push('Standard rollback applies');
    }
  }

  // ── qaNotes ───────────────────────────────────────────────────────────────
  const qaNotes: string[] = [];

  if (audience !== 'customer_safe') {
    const acsForQa = requirementSignals.acceptanceCriteria.slice(0, 5);
    for (let i = 0; i < acsForQa.length; i++) {
      qaNotes.push(`AC ${i + 1}: ${acsForQa[i]}`);
    }
  }

  return {
    issueKey,
    issueSummary,
    audience,
    summary,
    userImpact,
    technicalImpact,
    configMigrationNotes,
    riskNotes,
    rollbackNotes,
    qaNotes,
  };
}
