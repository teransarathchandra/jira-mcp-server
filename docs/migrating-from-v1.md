# Migrating from 1.x

v2 consolidates the 28 v1 tools into 10, plus two opt-in write tools. Every v1 tool except `jira_get_issue` was renamed or merged:

| v1 tool | v2 equivalent |
|---|---|
| `jira_get_issue` | `jira_get_issue` |
| `jira_get_issue_context` | `jira_get_issue` with `depth: "full"` |
| `jira_get_issue_with_confluence_context` | `jira_get_issue` with `includeConfluence: true` |
| `jira_search_my_open_issues` | `jira_search_issues` |
| `jira_prepare_work_prompt` | `jira_prepare_work_brief` |
| `jira_prepare_contextual_work_prompt` | `jira_prepare_work_brief` with `depth: "full"` |
| `jira_prepare_confluence_enriched_work_prompt` | `jira_prepare_work_brief` with `includeConfluence: true` |
| `confluence_search_related_pages` | `confluence_search` |
| `confluence_get_page_summary` | `confluence_get_page` |
| `jira_review_pr_alignment` | `delivery_check_changes` with `checks: ["alignment"]` |
| `jira_prepare_pr_review_prompt` | `delivery_check_changes` (or the `jira_pr_review_prompt` prompt) |
| `delivery_verify_definition_of_done` | `delivery_check_changes` with `checks: ["dod"]` |
| `delivery_analyze_implementation_impact` | `delivery_check_changes` with `checks: ["impact"]` |
| `delivery_get_traceability_matrix` | `delivery_traceability_matrix` |
| `delivery_generate_test_strategy` | `delivery_generate` with `type: "test_strategy"` |
| `delivery_generate_reviewer_report` | `delivery_generate` with `type: "reviewer_report"` and `persona` |
| `delivery_generate_qa_handoff` | `delivery_generate` with `type: "qa_handoff"` |
| `delivery_generate_release_notes` | `delivery_generate` with `type: "release_notes"` and `audience` |
| `delivery_export_task_report` | `delivery_generate` with `type: "task_report"` (returns Markdown, writes no file) |
| `delivery_generate_claude_workflow_pack` | `delivery_generate_agent_pack` with `client: "claude"` |
| `delivery_generate_codex_prompt_pack` | `delivery_generate_agent_pack` with `client: "codex"` |
| `delivery_generate_generic_prompt_pack` | `delivery_generate_agent_pack` with `client: "generic"` |
| `delivery_scan_project_patterns` | `delivery_project_patterns` with `action: "scan"` |
| `delivery_get_project_patterns` | `delivery_project_patterns` with `action: "get"` |
| `delivery_clear_project_patterns` | `delivery_project_patterns` with `action: "clear"` |
| `jira_list_configured_projects` | resource `jira-delivery://config/projects` |
| `mcp_get_client_setup_instructions` | CLI `npx jira-delivery-mcp setup <client>` |
| `mcp_clear_cache` | removed (restart the server) |

v2 tools ignore unknown arguments, so v1-only parameters are silently dropped; they are listed in the [CHANGELOG](../CHANGELOG.md#removed-parameters). Node.js 20 or newer is required.
