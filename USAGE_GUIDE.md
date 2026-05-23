# Jira MCP Server — Usage Guide

A developer-focused guide for using all 24 tools in this MCP server. Each scenario includes the exact prompt to type into Claude Code.

---

## Table of Contents

- [Overview](#overview)
- [Tool Reference](#tool-reference)
- [Learning Scenarios by Workflow Phase](#learning-scenarios-by-workflow-phase)
  - [Phase 1 — Understanding a Task](#phase-1--understanding-a-task)
  - [Phase 2 — Starting Implementation](#phase-2--starting-implementation)
  - [Phase 3 — Research](#phase-3--research)
  - [Phase 4 — Pre-Implementation Analysis](#phase-4--pre-implementation-analysis)
  - [Phase 5 — Post-Implementation Verification](#phase-5--post-implementation-verification)
  - [Phase 6 — Handoff & Documentation](#phase-6--handoff--documentation)
  - [Advanced — Automation](#advanced--automation)
- [Typical Developer Day Flow](#typical-developer-day-flow)
- [System Tools](#system-tools)

---

## Overview

This MCP server connects your AI coding assistant to Jira and Confluence, enabling AI-assisted delivery workflows — from understanding a ticket to generating release notes.

Configure it for your organization by setting the following environment variables:

```
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@your-org.com
JIRA_API_TOKEN=your-api-token
JIRA_DEFAULT_PROJECT_KEY=PROJ      # optional but recommended
```

See `.env.example` for the full list of supported variables.

---

## Tool Reference

### Jira — Basic Fetching

| Tool | What It Does |
|------|-------------|
| `jira_get_issue` | Fetch a Jira issue by key with description, AC, technical notes, and comments |
| `jira_search_my_open_issues` | List all open Jira issues assigned to you |

### Jira — Context & Enrichment

| Tool | What It Does |
|------|-------------|
| `jira_get_issue_context` | Fetch an issue with full surrounding context — parent, epic, linked issues, subtasks, comments |
| `jira_get_issue_with_confluence_context` | Fetch an issue enriched with relevant Confluence documentation |

### Jira — Prompt Generation

| Tool | What It Does |
|------|-------------|
| `jira_prepare_work_prompt` | Generate a clean implementation prompt ready for your AI coding assistant |
| `jira_prepare_contextual_work_prompt` | Generate a prompt with full Jira context (parent, epic, links, subtasks) |
| `jira_prepare_confluence_enriched_work_prompt` | Generate a prompt enriched with Confluence documentation insights |

### Jira — PR Review

| Tool | What It Does |
|------|-------------|
| `jira_prepare_pr_review_prompt` | Prepare a focused review prompt for a PR against a Jira requirement |
| `jira_review_pr_alignment` | Review a PR/branch against a Jira requirement and produce an alignment report with score |

### Confluence

| Tool | What It Does |
|------|-------------|
| `confluence_search_related_pages` | Search Confluence for pages related to a Jira issue, ranked by relevance |
| `confluence_get_page_summary` | Fetch a Confluence page summary with metadata, key sections, and extracted requirement signals |

### Delivery — Pre-Implementation

| Tool | What It Does |
|------|-------------|
| `delivery_analyze_implementation_impact` | Predict affected areas (frontend, backend, API, database, auth) before coding |
| `delivery_scan_project_patterns` | Scan a repository for tech patterns, module names, test locations, naming conventions |

### Delivery — Post-Implementation Verification

| Tool | What It Does |
|------|-------------|
| `delivery_verify_definition_of_done` | Run a 14-point DoD check and return a merge-readiness verdict with score |
| `delivery_get_traceability_matrix` | Map acceptance criteria to PR diff evidence |

### Delivery — Test & QA Strategy

| Tool | What It Does |
|------|-------------|
| `delivery_generate_test_strategy` | Generate unit, integration, E2E, manual QA, and negative test scenarios |
| `delivery_generate_qa_handoff` | Generate a QA handoff document with test data, happy path, negative cases, regression areas |

### Delivery — Reviews & Documentation

| Tool | What It Does |
|------|-------------|
| `delivery_generate_reviewer_report` | Generate a role-specific review report (product, frontend, backend, QA, security, release) |
| `delivery_generate_release_notes` | Generate release notes for multiple audiences (internal, qa, product, customer_safe) |

### Delivery — Orchestration

| Tool | What It Does |
|------|-------------|
| `delivery_export_task_report` | Export a comprehensive delivery report combining all analysis sections into one markdown doc |
| `delivery_generate_claude_workflow_pack` | Generate `.claude/skills/` and `.claude/commands/` workflow assets for a project |
| `delivery_get_project_patterns` | Retrieve previously saved project patterns from local pattern memory |
| `delivery_clear_project_patterns` | Clear local project pattern memory |

### System

| Tool | What It Does |
|------|-------------|
| `mcp_clear_cache` | Clear all in-memory caches (Jira issues, searches, Confluence pages) |

---

## Learning Scenarios by Workflow Phase

All examples use `PROJ-123` as a placeholder — replace it with an actual issue key from your Jira project.

---

### Phase 1 — Understanding a Task

#### Scenario 1: Quick task brief

> You just got assigned a ticket and want to understand it fast.

**Prompt:**
```
Get me the details for PROJ-123
```

**Tool:** `jira_get_issue`
**Returns:** Summary, description, acceptance criteria, comments, attachments, and an implementation prompt.

---

#### Scenario 2: Full context — parent epic, linked issues, subtasks

> You want to understand how this ticket fits into the bigger picture.

**Prompt:**
```
Get the full context for PROJ-123 including its parent epic, linked issues, and subtasks
```

**Tool:** `jira_get_issue_context`
**Returns:** Everything from Scenario 1 plus related tickets so you understand dependencies before touching code.

---

#### Scenario 3: Enrich the task with Confluence docs

> You suspect there is related architecture or design documentation in Confluence.

**Prompt:**
```
Get PROJ-123 with any related Confluence documentation
```

**Tool:** `jira_get_issue_with_confluence_context`
**Returns:** Jira brief + matched Confluence pages merged into one view.

---

### Phase 2 — Starting Implementation

These tools generate structured prompts you feed directly to your AI coding assistant to kick off implementation work.

---

#### Scenario 4: Simple implementation prompt

> You want your AI coding assistant to start coding from this ticket.

**Prompt:**
```
Prepare a work prompt for PROJ-123
```

**Tool:** `jira_prepare_work_prompt`
**Returns:** A clean, structured prompt — goal, acceptance criteria, codebase inspection steps, technical context. Copy-paste it into a new session to begin implementation.

---

#### Scenario 5: Contextual prompt (includes parent/epic/links)

> The ticket is part of a larger feature. You want your AI assistant to understand the full story.

**Prompt:**
```
Prepare a contextual work prompt for PROJ-123
```

**Tool:** `jira_prepare_contextual_work_prompt`
**Returns:** Same as Scenario 4 plus parent epic and linked issues so the AI has full requirement lineage.

---

#### Scenario 6: Confluence-enriched prompt (highest quality)

> You want your AI assistant to implement against your team's documented patterns and architecture decisions.

**Prompt:**
```
Prepare a Confluence-enriched work prompt for PROJ-123
```

**Tool:** `jira_prepare_confluence_enriched_work_prompt`
**Returns:** Implementation prompt + relevant Confluence documentation woven in. This produces the best-quality, most grounded prompt.

---

### Phase 3 — Research

#### Scenario 7: Find related Confluence pages

> You want to find all docs related to the topic of a ticket.

**Prompt:**
```
Search Confluence for pages related to PROJ-123
```

**Tool:** `confluence_search_related_pages`
**Returns:** Ranked list of Confluence pages relevant to the ticket's topic.

---

#### Scenario 8: Read a specific Confluence page

> Someone linked a Confluence page and you want a structured summary.

**Prompt:**
```
Summarize this Confluence page: https://your-domain.atlassian.net/wiki/spaces/PROJ/pages/12345
```

**Tool:** `confluence_get_page_summary`
**Returns:** Metadata, key sections, and requirement signals extracted from the page.

---

### Phase 4 — Pre-Implementation Analysis

#### Scenario 9: Impact analysis before writing any code

> You want to know which areas of the system will be affected before touching anything.

**Prompt:**
```
Analyze the implementation impact for PROJ-123
```

**Tool:** `delivery_analyze_implementation_impact`
**Returns:** Prediction of affected frontend/backend/API/database/auth areas so you can plan your approach and communicate scope to the team.

---

#### Scenario 10: Scan project for coding patterns

> You are new to a part of the codebase and want to understand conventions before coding.

**Prompt:**
```
Scan the project patterns for PROJ-123 in /path/to/your/repo
```

**Tool:** `delivery_scan_project_patterns`
**Returns:** Detected module names, test file locations, tech stack, naming conventions. Saved to local pattern memory so other delivery tools can use it automatically.

---

### Phase 5 — Post-Implementation Verification

#### Scenario 11: Generate a test strategy

> Implementation is done. What should you test and how?

**Prompt:**
```
Generate a test strategy for PROJ-123 with this diff:
<paste your git diff here>
```

**Tool:** `delivery_generate_test_strategy`
**Returns:** Unit, integration, E2E, manual QA, and negative test scenarios tailored to your changes.

---

#### Scenario 12: Verify Definition of Done

> Before raising a PR, run the 14-point DoD check.

**Prompt:**
```
Verify the definition of done for PROJ-123 with this diff:
<paste your git diff here>
```

**Tool:** `delivery_verify_definition_of_done`
**Returns:** 14-criteria checklist, merge-readiness verdict, and score. Catches missing tests, missing AC coverage, and documentation gaps.

---

#### Scenario 13: Traceability matrix

> Prove that every acceptance criterion has matching code evidence in the PR.

**Prompt:**
```
Get the traceability matrix for PROJ-123 with this PR diff:
<paste your git diff here>
```

**Tool:** `delivery_get_traceability_matrix`
**Returns:** Each AC line mapped to specific files and lines in your diff. Useful for formal reviews and audits.

---

### Phase 6 — Handoff & Documentation

#### Scenario 14: QA handoff document

> You are handing off to QA and need to give them a test plan.

**Prompt:**
```
Generate a QA handoff for PROJ-123 with this diff:
<paste your git diff here>
```

**Tool:** `delivery_generate_qa_handoff`
**Returns:** What to test, test data needed, happy path steps, negative cases, and regression areas. QA can begin immediately without back-and-forth.

---

#### Scenario 15: PR review prompt

> You want your AI assistant to review your PR against the Jira requirements.

**Prompt:**
```
Prepare a PR review prompt for PROJ-123 on branch fix/proj-123-short-description
```

**Tool:** `jira_prepare_pr_review_prompt`
**Returns:** A focused review prompt asking — does this PR actually fix what the ticket requires? Use this to start a review session.

---

#### Scenario 16: Automated PR alignment review

> Skip the manual step — let the tool score your PR alignment directly.

**Prompt:**
```
Review PR alignment for PROJ-123 on branch fix/proj-123-short-description
```

**Tool:** `jira_review_pr_alignment`
**Returns:** Alignment report with a score, identified gaps, and risk areas. Answers: does the PR cover all the requirements?

---

#### Scenario 17: Role-specific reviewer report

> Your product manager, QA lead, and security reviewer all need different things from this PR.

**Prompt:**
```
Generate a reviewer report for PROJ-123 for the "product" persona with this diff:
<paste your diff here>
```

**Tool:** `delivery_generate_reviewer_report`
**Persona options:** `product`, `frontend`, `backend`, `qa`, `security`, `release`
**Returns:** A report written for that specific reviewer's concerns. Run once per reviewer type.

---

#### Scenario 18: Release notes for different audiences

> The ticket is merged. Generate release notes for internal team and customer-safe communications.

**Prompt:**
```
Generate release notes for PROJ-123 for the "internal" audience
```

**Tool:** `delivery_generate_release_notes`
**Audience options:** `internal`, `qa`, `product`, `customer_safe`
**Returns:** Release notes at the right level of detail and tone for that audience.

---

#### Scenario 19: Full delivery report in one document

> You want one complete markdown document covering the entire delivery lifecycle.

**Prompt:**
```
Export a full delivery report for PROJ-123 with this diff:
<paste your diff here>
```

**Tool:** `delivery_export_task_report`
**Returns:** Impact analysis + test strategy + DoD check + traceability matrix + QA handoff combined into a single exportable document.

---

### Advanced — Automation

#### Scenario 20: Generate workflow files for a project repo

> You want to embed these delivery workflows as slash commands in another project so every developer on that team can use them.

**Prompt:**
```
Generate a Claude workflow pack for PROJ-123
```

**Tool:** `delivery_generate_claude_workflow_pack`
**Returns:** Creates `.claude/skills/` and `.claude/commands/` files inside the target project. Any developer on that team can then trigger these workflows as slash commands.

---

## Typical Developer Day Flow

```
Morning: "Get the full context for PROJ-123"
         → Understand the task, its parent epic, and linked issues

Before coding: "Analyze the implementation impact for PROJ-123"
               → Know which areas you will touch before writing a line

Coding: "Prepare a Confluence-enriched work prompt for PROJ-123"
        → Kick off a focused, well-grounded implementation session

After coding: "Verify the definition of done for PROJ-123 with this diff: ..."
              → Catch gaps before raising a PR

PR raised: "Review PR alignment for PROJ-123 on branch ..."
           → Score your PR against the requirements automatically

QA handoff: "Generate a QA handoff for PROJ-123 with this diff: ..."
            → QA gets their test plan without needing to ask you questions

Release: "Generate release notes for PROJ-123 for the 'internal' audience"
         → Communicate the change to each audience in the right tone
```

---

## System Tools

### Clear the cache

> The MCP server caches Jira and Confluence responses for performance. If you need fresh data after a ticket update, clear the cache.

**Prompt:**
```
Clear the MCP cache
```

**Tool:** `mcp_clear_cache`
**Returns:** Confirmation that all in-memory caches (issues, searches, Confluence pages) have been cleared.

---

### View your open tickets

**Prompt:**
```
Show me my open Jira issues
```

**Tool:** `jira_search_my_open_issues`
**Returns:** List of open issues assigned to you in your configured project(s), ordered by last updated.
