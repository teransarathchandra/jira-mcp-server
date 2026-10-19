import { z } from 'zod';
import { appendAudit, type AuditAction } from './auditLog.js';
import type { ConfirmTokenStore } from './confirmTokens.js';
import { JiraNetworkError, JiraServerError } from '../jiraClient.js';

// The one path every Jira write goes through (R3 design §5): a write happens
// only with a valid single-use token or a confirmed elicitation form; anything
// else returns a preview and a fresh token. Every attempted step is audited.

export const INVALID_TOKEN_MESSAGE =
  'Confirmation token is invalid or expired — call again without confirmToken to get a fresh preview.';

const ELICITATION_TIMEOUT_MS = 60_000;

export type ElicitFn = (
  params: { message: string; requestedSchema: Record<string, unknown> },
  options?: { timeout?: number },
) => Promise<{ action: string; content?: Record<string, unknown> }>;

export interface WriteStep {
  action: AuditAction;
  /** Runs the Jira request; returns the audit detail (an id, status name or URL). */
  run: () => Promise<string>;
}

export interface WritePlan {
  tool: string;
  issueKey: string;
  args: Record<string, unknown>;
  preview: string;
  steps: WriteStep[];
}

export const WriteResultSchema = z.object({
  applied: z.boolean(),
  /** The user answered no in the confirmation form; no token was issued. */
  declined: z.boolean().optional(),
  preview: z.string(),
  confirmToken: z.string().optional(),
  results: z.array(
    z.object({
      action: z.enum(['comment', 'assign', 'transition', 'link']),
      outcome: z.enum(['applied', 'failed', 'skipped']),
      detail: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
});

export type WriteResult = z.infer<typeof WriteResultSchema>;

export interface WriteOutcome extends WriteResult {
  refused: boolean;
  warnings: string[];
}

/** 'no' only for an explicit refusal; cancel, timeout and errors are 'unavailable'. */
async function askByForm(plan: WritePlan, elicit: ElicitFn): Promise<'yes' | 'no' | 'unavailable'> {
  try {
    const answer = await elicit(
      {
        message: plan.preview,
        requestedSchema: {
          type: 'object',
          properties: { confirm: { type: 'boolean', title: `Apply these changes to ${plan.issueKey}?` } },
          required: ['confirm'],
        },
      },
      { timeout: ELICITATION_TIMEOUT_MS },
    );
    if (answer.action === 'accept') return answer.content?.confirm === true ? 'yes' : 'no';
    return answer.action === 'decline' ? 'no' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function apply(plan: WritePlan, auditLogPath: string): Promise<WriteOutcome> {
  const results: WriteResult['results'] = [];
  const warnings: string[] = [];
  const audit = (entry: Parameters<typeof appendAudit>[1]) => {
    const warning = appendAudit(auditLogPath, entry);
    if (warning) warnings.push(warning);
  };

  let failed = false;
  for (const step of plan.steps) {
    if (failed) {
      results.push({ action: step.action, outcome: 'skipped' });
      continue;
    }
    try {
      const detail = await step.run();
      results.push({ action: step.action, outcome: 'applied', detail });
      audit({ tool: plan.tool, issueKey: plan.issueKey, action: step.action, outcome: 'applied', detail });
    } catch (err) {
      failed = true;
      const errorClass = err instanceof Error ? err.name : 'Error';
      const raw = err instanceof Error ? err.message : String(err);
      // A timeout or 5xx may still have been applied by Jira: never invite a blind retry.
      const unknown = err instanceof JiraServerError || err instanceof JiraNetworkError;
      const message = unknown ? `${raw} The outcome is unknown: check ${plan.issueKey} in Jira before confirming again.` : raw;
      results.push({ action: step.action, outcome: 'failed', detail: errorClass, error: message });
      audit({ tool: plan.tool, issueKey: plan.issueKey, action: step.action, outcome: 'failed', detail: errorClass });
    }
  }
  return { applied: results.some((r) => r.outcome === 'applied'), refused: false, preview: plan.preview, results, warnings };
}

export async function runGuardedWrite(
  plan: WritePlan,
  ctx: { confirmToken?: string; tokens: ConfirmTokenStore; auditLogPath: string; elicit?: ElicitFn },
): Promise<WriteOutcome> {
  if (ctx.confirmToken !== undefined) {
    if (ctx.tokens.consume(ctx.confirmToken, plan.tool, plan.issueKey, plan.args)) return apply(plan, ctx.auditLogPath);
    const warning = appendAudit(ctx.auditLogPath, {
      tool: plan.tool,
      issueKey: plan.issueKey,
      action: plan.steps[0]?.action ?? 'comment',
      outcome: 'refused',
      detail: 'invalid_token',
    });
    return { applied: false, refused: true, preview: plan.preview, results: [], warnings: warning ? [warning] : [] };
  }
  if (ctx.elicit) {
    const answer = await askByForm(plan, ctx.elicit);
    if (answer === 'yes') return apply(plan, ctx.auditLogPath);
    if (answer === 'no') return { applied: false, declined: true, refused: false, preview: plan.preview, results: [], warnings: [] };
  }
  const confirmToken = ctx.tokens.issue(plan.tool, plan.issueKey, plan.args);
  return { applied: false, refused: false, preview: plan.preview, confirmToken, results: [], warnings: [] };
}
