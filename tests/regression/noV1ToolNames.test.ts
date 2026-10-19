/**
 * Regression: anything that tells an agent which tool to call must use the
 * v2 tool names. A v1 name in a generated pack or hint sends the agent to a
 * tool that no longer exists.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateWorkflowPack } from '../../src/claudeWorkflow/workflowPackGenerator.js';
import { generateCodexPromptPack } from '../../src/codexPrompts/codexPromptPackGenerator.js';
import { generateGenericPromptPack } from '../../src/genericPrompts/genericPromptPackGenerator.js';
import { getClientExampleCommands } from '../../src/clientProfiles/clientProfileConfig.js';
import { deliveryGetProjectPatterns } from '../../src/tools/deliveryScanProjectPatterns.js';
import type { McpClientProfile } from '../../src/clientProfiles/clientProfile.js';

const V1_ONLY_TOOL_NAMES = [
  'jira_search_my_open_issues',
  'jira_prepare_work_prompt',
  'jira_get_issue_context',
  'jira_prepare_contextual_work_prompt',
  'jira_review_pr_alignment',
  'jira_prepare_pr_review_prompt',
  'confluence_search_related_pages',
  'confluence_get_page_summary',
  'jira_get_issue_with_confluence_context',
  'jira_prepare_confluence_enriched_work_prompt',
  'delivery_get_traceability_matrix',
  'delivery_verify_definition_of_done',
  'delivery_analyze_implementation_impact',
  'delivery_generate_test_strategy',
  'delivery_generate_reviewer_report',
  'delivery_generate_qa_handoff',
  'delivery_generate_release_notes',
  'delivery_generate_claude_workflow_pack',
  'delivery_generate_generic_prompt_pack',
  'delivery_generate_codex_prompt_pack',
  'delivery_scan_project_patterns',
  'delivery_get_project_patterns',
  'delivery_clear_project_patterns',
  'delivery_export_task_report',
  'jira_list_configured_projects',
  'mcp_clear_cache',
  'mcp_get_client_setup_instructions',
];

function expectNoV1Names(text: string) {
  const found = V1_ONLY_TOOL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
  expect(found).toEqual([]);
}

describe('no v1 tool names in agent-facing output', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'v1-names-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['claude', generateWorkflowPack],
    ['codex', generateCodexPromptPack],
    ['generic', generateGenericPromptPack],
  ] as const)('%s agent pack', (_label, generate) => {
    const result = generate({ repoPath: dir, overwrite: true });
    expect(result.generated.length).toBeGreaterThan(0);
    const text = result.generated.map((p) => readFileSync(p, 'utf8')).join('\n') + result.usageExamples.join('\n');
    expectNoV1Names(text);
  });

  it.each(['generic', 'claude-code', 'claude-desktop', 'codex-cli', 'cursor', 'windsurf', 'vscode'] as McpClientProfile[])(
    'client example commands for %s',
    (profile) => {
      expectNoV1Names(getClientExampleCommands(profile, 'ABC-1').join('\n'));
    },
  );

  it('project pattern hints', async () => {
    expectNoV1Names(await deliveryGetProjectPatterns({ repoPath: dir }));
  });
});
