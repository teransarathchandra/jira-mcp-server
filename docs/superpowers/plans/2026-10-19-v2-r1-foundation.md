# jira-delivery-mcp v2 R1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `2.0.0-beta.1`: the same delivery capabilities on MCP SDK v2, consolidated from 28 tools to 10, each with an output schema, annotations and contract tests.

**Architecture:** `src/index.ts` shrinks to a CLI entry. A new `src/server/` layer builds an `McpServer` from injected deps, and each tool lives in its own module under `src/server/tools/` that calls the **existing** `src/tools/*` wrappers (which keep returning Markdown). Each wrapper result is put into a shared envelope (`structuredContent` + text). Business logic in `src/delivery`, `src/jira`, `src/confluence` and `src/utils` is not touched.

**Tech Stack:** TypeScript (ESM, Node16 modules, `.js` import suffixes), `@modelcontextprotocol/server` 2.x, `@modelcontextprotocol/client` 2.x (tests only), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-v2-delivery-mcp-design.md` (§3 tool surface, §4 envelope, §7 R1 row)

## Global Constraints

- `engines.node` = `>=20`; CI matrix Node 20 and 22.
- Dependencies: `@modelcontextprotocol/server` `^2.3.1`, `zod` `^4.2.0`; dev: `@modelcontextprotocol/client` `^2.3.1`. `@modelcontextprotocol/sdk` is removed by the end of Task 8.
- Exactly these 10 tool names: `jira_get_issue`, `jira_search_issues`, `jira_prepare_work_brief`, `confluence_search`, `confluence_get_page`, `delivery_check_changes`, `delivery_traceability_matrix`, `delivery_generate`, `delivery_generate_agent_pack`, `delivery_project_patterns`.
- Envelope `schemaVersion` is the literal `'2.0'`.
- No Jira writes, no telemetry, stdio transport only.
- Nothing may write to stdout except the MCP transport and the `setup` CLI command (stdout is the protocol channel).
- Every tool input schema is an object at the root: no top-level `oneOf`/union. Use flat optional fields.
- Default values for every merged tool equal the v1 Zod defaults in `src/index.ts:61-253` (pre-Task-8 version). Copy them; do not invent new ones.
- Server name `jira-delivery-mcp`; version always from `package.json`.

## Review Focus

1. **Zod 3→4 default drift:** omitted optional args must reach wrappers with the v1 defaults (e.g. `includeComments: true`, `maxResults: 10`). Pinned in Task 3 and Task 4.
2. **One failing check in `delivery_check_changes`:** a failure in `dod` (e.g. Confluence 401) must not hide `alignment` and `impact` results. Pinned in Task 6.
3. **Wrapper throws a known error** (auth, not-found, project not in allowlist): the client must get `isError: true` with the `formatError` text, not a protocol error. Pinned in Task 3.
4. **`reviewer_report` without `persona`:** must return a clear input error, not a crash inside the generator. Pinned in Task 7.
5. **`setup` with an unknown client name, or with no Jira env vars:** must print the valid client list and exit 1, and must not require Jira credentials. Pinned in Task 8.

---

### Task 1: Toolchain upgrade (Node 20, Zod 4, SDK v2 alongside v1)

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/index.ts` (only the `ZodError` branch of `formatError`)

**Interfaces:**
- Produces: installed `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `zod@4`. v1 SDK stays installed until Task 8 so the build stays green.

- [ ] **Step 1: Update `package.json`**: `engines.node` → `>=20`; add `@modelcontextprotocol/server@^2.3.1`; set `zod@^4.2.0`; dev-add `@modelcontextprotocol/client@^2.3.1`; set `@types/node` to `^20`; bump `vitest` to the latest major that supports Node 20; bump `@modelcontextprotocol/sdk` to `^1.32.1` (the v1 line that accepts Zod 4) so it can coexist until Task 8. Run `npm install`. Expected: no peer-dependency errors.
- [ ] **Step 2: Fix the Zod 4 break.** In `formatError`, `err.errors` → `err.issues`.
- [ ] **Step 3: Confirm the SDK v2 export names** used by later tasks, from `node_modules/@modelcontextprotocol/server` and `node_modules/@modelcontextprotocol/client` type declarations: `McpServer`, `InMemoryTransport` (with `createLinkedPair`), `StdioServerTransport` at `@modelcontextprotocol/server/stdio`, `Client`, the `CallToolResult` type, and the `registerTool`/`registerPrompt`/`registerResource` config keys (`title`, `description`, `inputSchema`, `outputSchema`, `annotations`, `argsSchema`). If any name differs, record the real one at the top of this plan before continuing.
- [ ] **Step 4: Verify.** Run `npm run typecheck && npm test`. Expected: typecheck clean and all 58 test files pass (≈1,715 tests).
- [ ] **Step 5: Commit**: `chore: require Node 20, upgrade to Zod 4, add MCP SDK v2 packages`

---

### Task 2: Version, envelope, errors, annotations

**Files:**
- Create: `src/version.ts`, `src/server/envelope.ts`, `src/server/errors.ts`, `src/server/annotations.ts`
- Test: `tests/version.test.ts`, `tests/server/envelope.test.ts`, `tests/server/errors.test.ts`

**Interfaces:**
- Produces:
  - `getServerVersion(): string`: reads `version` from `new URL('../package.json', import.meta.url)` (works from both `src/` and `dist/`).
  - `EnvelopeSchema` (Zod object: `schemaVersion: z.literal('2.0')`, `tool: z.string()`, `issueKey: z.string().optional()`, `markdown: z.string()`, `warnings: z.array(z.string())`); `type Envelope`.
  - `toolResult(tool: string, markdown: string, opts?: { issueKey?: string; warnings?: string[] }): CallToolResult`: returns `content: [{ type: 'text', text: markdown }]` and `structuredContent` = an envelope with `warnings` defaulting to `[]`.
  - `formatError(err: unknown): string`: moved verbatim from `src/index.ts` (Task 8 deletes the old copy).
  - `errorResult(err: unknown): CallToolResult`: `{ content: [{ type: 'text', text: formatError(err) }], isError: true }`.
  - `READ_ONLY_REMOTE = { readOnlyHint: true, openWorldHint: true }`, `LOCAL_WRITE_DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }`.

- [ ] **Step 1: Write failing tests.**
  - `getServerVersion() === JSON.parse(readFileSync('package.json')).version`
  - `toolResult('jira_get_issue', '# Hi', { issueKey: 'ABC-1' })` → `structuredContent` deep-equals `{ schemaVersion: '2.0', tool: 'jira_get_issue', issueKey: 'ABC-1', markdown: '# Hi', warnings: [] }`, `content[0].text === '# Hi'`, and `EnvelopeSchema.parse(structuredContent)` does not throw
  - `errorResult(new JiraAuthError('bad token'))` → `isError === true` and text starts with `'Authentication error:'`
  - `errorResult(new ZodError([...]))` text starts with `'Invalid input:'`
- [ ] **Step 2: Run** `npx vitest run tests/version.test.ts tests/server`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the four modules per the Interfaces block.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(server): add v2 envelope, error mapping, annotations, version source`

---

### Task 3: Server factory, test harness, first tool (`jira_search_issues`)

**Files:**
- Create: `src/server/types.ts`, `src/server/createServer.ts`, `src/server/tools/jiraSearchIssues.ts`
- Create: `tests/server/harness.ts`
- Test: `tests/server/jiraSearchIssues.test.ts`

**Interfaces:**
- Consumes: Task 2 exports.
- Produces:
  - `interface ServerDeps { config: Config; jiraClient: JiraClient }`
  - `type ToolRegistrar = (server: McpServer, deps: ServerDeps) => void`
  - `createServer(deps: ServerDeps): McpServer`: `new McpServer({ name: 'jira-delivery-mcp', version: getServerVersion() })`, then calls every registrar from a `TOOL_REGISTRARS: ToolRegistrar[]` array (later tasks append to it), plus `registerPrompts` and `registerResources` once Task 8 adds them.
  - Tool-module convention, used by every later tool: each file exports `register<PascalName>: ToolRegistrar`, which calls `server.registerTool(name, { title, description, inputSchema, outputSchema: EnvelopeSchema, annotations }, handler)`. The handler wraps the wrapper call in `try { return toolResult(...) } catch (e) { return errorResult(e) }`.
  - Harness: `testDeps(overrides?: Partial<ServerDeps>): ServerDeps` (a minimal `Config` cast that includes `projectConfig.exampleIssueKey = 'ABC-123'`, plus `jiraClient = {} as JiraClient`), and `connect(deps?: ServerDeps): Promise<{ client: Client; close(): Promise<void> }>`, which links `createServer(deps)` and a `Client` through `InMemoryTransport.createLinkedPair()`.
  - `jira_search_issues` input: `projectKey?: string`, `maxResults: int 1–50 default 10`. It calls `searchMyIssues(input, deps.jiraClient, deps.config)`. Annotations `READ_ONLY_REMOTE`; no `issueKey` in the envelope.

- [ ] **Step 1: Write failing tests** with `vi.mock('../../src/tools/searchMyIssues.js')`:
  - `listTools()` contains `jira_search_issues` with an `outputSchema` and `annotations.readOnlyHint === true`
  - `callTool({ name: 'jira_search_issues', arguments: {} })` → the mock was called with `{ maxResults: 10 }` (the projectKey is absent), and `structuredContent.markdown` equals the mock's return value (Review Focus 1)
  - the mock throws `new JiraAuthError('x')` → result `isError === true`, text starts with `'Authentication error:'` (Review Focus 3)
  - `arguments: { maxResults: 99 }` → `isError === true` and the mock is not called
- [ ] **Step 2: Run** `npx vitest run tests/server/jiraSearchIssues.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `types.ts`, `createServer.ts`, `jiraSearchIssues.ts` and `harness.ts`.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(server): McpServer factory, in-memory contract harness, jira_search_issues`

---

### Task 4: `jira_get_issue` and `jira_prepare_work_brief`

**Files:**
- Create: `src/server/tools/jiraGetIssue.ts`, `src/server/tools/jiraPrepareWorkBrief.ts`
- Modify: `src/server/createServer.ts` (append registrars)
- Test: `tests/server/jiraIssueTools.test.ts`

**Interfaces:**
- Consumes: the Task 3 convention and harness.
- Produces two tools, both `READ_ONLY_REMOTE` with `issueKey` in the envelope. Input: `issueKey: string`, `depth: 'basic'|'full'` default `'basic'`, `includeConfluence: boolean` default `false`.
  - `jira_get_issue` dispatch: `includeConfluence` → `jiraGetIssueWithConfluenceContext`; else `depth === 'full'` → `getIssueContext`; else `getIssue`. Each receives its v1 default options (from the old `JiraGetIssueWithConfluenceContextSchema`, `GetIssueContextSchema` and `GetIssueSchema`).
  - `jira_prepare_work_brief` dispatch: `includeConfluence` → `jiraPrepareConfluenceEnrichedWorkPrompt`; else `full` → `prepareContextualWorkPrompt`; else `prepareWorkPrompt`, with v1 defaults in the same way.

- [ ] **Step 1: Write failing tests** (all 6 wrappers mocked), one per dispatch branch, asserting which mock was called. Plus:
  - `jira_get_issue { issueKey: 'ABC-1' }` → `getIssue` called with `{ issueKey: 'ABC-1', includeComments: true, includeAttachments: true }` (Review Focus 1)
  - `jira_get_issue { issueKey: 'ABC-1', depth: 'full' }` → `getIssueContext` called with an object containing `maxLinkedIssues: 8, maxSubtasks: 10, maxCommentsPerIssue: 10, contextDepth: 1, includeEpicSiblings: false`
  - `structuredContent.issueKey === 'ABC-1'`
  - the wrapper throws `new Error('Issue key ZZZ-1 is not in the allowed project list')` → `isError === true` and the text contains `'ZZZ-1'` (Review Focus 3)
- [ ] **Step 2: Run** `npx vitest run tests/server/jiraIssueTools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules and register them.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(server): consolidated jira_get_issue and jira_prepare_work_brief`

---

### Task 5: `confluence_search` and `confluence_get_page`

**Files:**
- Create: `src/server/tools/confluenceSearch.ts`, `src/server/tools/confluenceGetPage.ts`
- Modify: `src/server/createServer.ts`
- Test: `tests/server/confluenceTools.test.ts`

**Interfaces:**
- `confluence_search`: input and defaults identical to v1 `ConfluenceSearchRelatedPagesSchema`; calls `confluenceSearchRelatedPages`; `issueKey` in the envelope.
- `confluence_get_page`: input identical to v1 `ConfluenceGetPageSummarySchema`; calls `confluenceGetPageSummary`; no `issueKey`.
- Both `READ_ONLY_REMOTE`.

- [ ] **Step 1: Write failing tests**: each tool forwards its defaults (`maxResults: 10, spaceKeys: [], includeLowRelevance: false`; `maxChars: 12000`), and a `ConfluenceNotConfiguredError` from the mock → text starts with `'Confluence not configured:'`.
- [ ] **Step 2: Run** `npx vitest run tests/server/confluenceTools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement and register.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(server): confluence_search and confluence_get_page`

---

### Task 6: `delivery_check_changes` and `delivery_traceability_matrix`

**Files:**
- Create: `src/server/gitRefs.ts`, `src/server/tools/deliveryCheckChanges.ts`, `src/server/tools/deliveryTraceabilityMatrix.ts`
- Modify: `src/server/createServer.ts`; `src/tools/reviewPrAlignment.ts` (delete the `github_pr` branch and the `prNumber` field; the `mode` field becomes `'local_diff'` only)
- Test: `tests/server/deliveryCheckTools.test.ts`

**Interfaces:**
- Produces `gitRefsShape = { baseBranch: z.string().default('origin/main'), compareRef: z.string().default('HEAD'), repoPath: z.string().default('.') }`, shared by Tasks 6 and 7.
- `delivery_check_changes` input: `issueKey`, `checks: z.array(z.enum(['alignment','dod','impact'])).min(1).default(['alignment','dod','impact'])`, the `gitRefsShape` fields, `includeConfluence` default `true`, `maxDiffChars` int 1000–200000 default `50000`. It runs the selected checks **in the fixed order alignment → dod → impact**, each in its own try/catch:
  - alignment → `reviewPrAlignment({ mode: 'local_diff', ... })`
  - dod → `deliveryVerifyDefinitionOfDone`
  - impact → `deliveryAnalyzeImplementationImpact`
  
  The Markdown is the successful sections joined with `\n\n---\n\n`. A failed check adds the section `## ⚠️ <check> check failed\n\n<formatError(e)>` plus the warning `"<check> check failed"`. `isError` is true only if every selected check failed. `prepare_pr_review_prompt` is not carried over (the `jira_pr_review_prompt` MCP prompt covers that use).
- `delivery_traceability_matrix`: input identical to v1 `DeliveryGetTraceabilityMatrixSchema`; calls `deliveryGetTraceabilityMatrix`.
- Both `READ_ONLY_REMOTE`.

- [ ] **Step 1: Write failing tests**:
  - default call runs all three mocks, in order; Markdown contains all three returns separated by `---`
  - `checks: ['dod']` → only the dod mock is called
  - dod mock throws `ConfluenceAuthError` → result is not `isError`; Markdown contains the alignment and impact outputs plus `'dod check failed'`; `warnings` contains `'dod check failed'` (Review Focus 2)
  - all three mocks throw → `isError === true`
  - `checks: []` → `isError === true`, no mocks called
  - traceability forwards `includePrDiff: true` by default
- [ ] **Step 2: Run** `npx vitest run tests/server/deliveryCheckTools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, remove `github_pr` from `reviewPrAlignment.ts`, and register.
- [ ] **Step 4: Run** this file plus `npm run typecheck`. Expected: PASS, clean.
- [ ] **Step 5: Commit**: `feat(server): delivery_check_changes with per-check isolation; traceability tool; drop github_pr stub`

---

### Task 7: `delivery_generate`, `delivery_generate_agent_pack`, `delivery_project_patterns`

**Files:**
- Create: `src/server/tools/deliveryGenerate.ts`, `src/server/tools/deliveryGenerateAgentPack.ts`, `src/server/tools/deliveryProjectPatterns.ts`
- Modify: `src/server/createServer.ts`
- Test: `tests/server/deliveryGenerateTools.test.ts`

**Interfaces:**
- `delivery_generate` input: `issueKey`, `type: enum['test_strategy','reviewer_report','qa_handoff','release_notes','task_report']`, `persona?: enum[<6 v1 personas>]`, `audience: enum['internal','qa','product','customer_safe'] default 'internal'`, `sections?: string[]` (default = the v1 export default list), `includePrDiff: boolean default false` (test_strategy only), `gitRefsShape`, `includeConfluence default true`.
  - Dispatch: test_strategy → `deliveryGenerateTestStrategy`; reviewer_report → `deliveryGenerateReviewerReport`; qa_handoff → `deliveryGenerateQaHandoff`; release_notes → `deliveryGenerateReleaseNotes`; task_report → `deliveryExportTaskReport` **without `outputPath`** (returns Markdown, writes no file).
  - `reviewer_report` without `persona` → `isError` with text `"Invalid input: persona is required when type is reviewer_report"`, checked in the handler before dispatch.
  - Annotations `READ_ONLY_REMOTE`.
- `delivery_generate_agent_pack` input: `client: enum['claude','codex','generic']`, `repoPath default '.'`, `overwrite default false`. Dispatches to `deliveryGenerateClaudeWorkflowPack` / `deliveryGenerateCodexPromptPack` / `deliveryGenerateGenericPromptPack`. Annotations `LOCAL_WRITE_DESTRUCTIVE`.
- `delivery_project_patterns` input: `action: enum['scan','get','clear']`, `repoPath default '.'`. Dispatches to `deliveryScanProjectPatterns` / `deliveryGetProjectPatterns` / `deliveryClearProjectPatterns`. Annotations `LOCAL_WRITE_DESTRUCTIVE`.

- [ ] **Step 1: Write failing tests**: one dispatch test per `type`, `client` and `action` value (11 total). Plus:
  - `task_report` → the export mock's input has no `outputPath` key
  - `{ type: 'reviewer_report' }` without persona → `isError`, text equals the string above, reviewer mock not called (Review Focus 4)
  - `listTools()` shows `delivery_generate_agent_pack.annotations.destructiveHint === true`
- [ ] **Step 2: Run** `npx vitest run tests/server/deliveryGenerateTools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement and register.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(server): delivery_generate, agent pack and project patterns tools`

---

### Task 8: Prompts, config resource, CLI entry, remove SDK v1

**Files:**
- Create: `src/server/prompts.ts`, `src/server/resources.ts`, `src/cli.ts`
- Rewrite: `src/index.ts`
- Modify: `src/server/createServer.ts`, `package.json` (remove `@modelcontextprotocol/sdk`)
- Test: `tests/server/surface.test.ts`, `tests/cli.test.ts`

**Interfaces:**
- `registerPrompts(server: McpServer): void`: the same 5 prompt names, each with `argsSchema: z.object({ issueKey: z.string() })`. New texts:
  - `jira_implementation_prompt` → "Use jira_prepare_work_brief with issueKey {K}, depth full and includeConfluence true."
  - `jira_pr_review_prompt` → "Use delivery_check_changes for {K} on the current branch and summarise gaps."
  - `jira_qa_handoff_prompt` → "Use delivery_generate with type qa_handoff for {K}."
  - `jira_definition_of_done_prompt` → "Use delivery_check_changes with checks [\"dod\"] for {K} and return the verdict and score."
  - `jira_release_note_prompt` → "Use delivery_generate with type release_notes and audience internal for {K}."
- `registerResources(server: McpServer, deps: ServerDeps): void`: one static resource, `jira-delivery://config/projects`, mime `text/markdown`, content `listConfiguredProjects(deps.config.projectConfig)`.
- `src/cli.ts`:
  - `type Command = { kind: 'serve' } | { kind: 'setup'; client: string } | { kind: 'help' }`
  - `parseCommand(argv: string[]): Command`: no args → serve; `setup <client>`; `--help`/`-h` → help.
  - `SETUP_CLIENTS = ['generic','claude-code','claude-desktop','codex-cli','cursor','windsurf','vscode'] as const`
  - `runSetup(client: string, out: (s: string) => void, err: (s: string) => void): number`: returns 0 after printing `mcpGetClientSetupInstructions({ client, serverName: 'jira-delivery-mcp', serverCommand: 'npx', serverArgs: ['-y', 'jira-delivery-mcp'] })`. For an unknown client it writes `Unknown client "<c>". Valid: <comma list>` to `err` and returns 1.
- `src/index.ts`: shebang, `parseCommand(process.argv.slice(2))`. `setup`/`help` run **before** `getConfig()` and exit. `serve` → `getConfig()`, `new JiraClient(config)`, `createServer(...).connect(new StdioServerTransport())`. Keep the existing fatal-error handler, which writes to stderr.

- [ ] **Step 1: Write failing tests.**
  - `surface.test.ts`: `listTools()` names, sorted, deep-equal the 10 Global Constraints names. Every tool has `outputSchema` and `annotations`, its `inputSchema.type === 'object'`, and it has no top-level `oneOf`/`anyOf`. `listPrompts()` returns the 5 names. `getPrompt('jira_pr_review_prompt', { issueKey: 'ABC-1' })` text contains `delivery_check_changes` and `ABC-1`. `listResources()` contains `jira-delivery://config/projects`. `getServerVersion()` equals the version the server reports (`client.getServerVersion().version`).
  - `cli.test.ts`: `parseCommand([])` → serve; `parseCommand(['setup','cursor'])` → `{ kind: 'setup', client: 'cursor' }`; `runSetup('nope', ...)` returns 1 and `err` received text containing `claude-code`; `runSetup('cursor', ...)` returns 0 with non-empty `out` while `JIRA_BASE_URL`/`JIRA_API_TOKEN` are unset (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run tests/server/surface.test.ts tests/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** prompts, resources and the CLI; rewrite `index.ts`; delete the old schemas, `buildTools` and the handlers; `npm uninstall @modelcontextprotocol/sdk`.
- [ ] **Step 4: Verify**:
  - `npm run typecheck && npm test && npm run build`: all green.
  - `grep -rn "console.log\|process.stdout.write" src | grep -v src/cli.ts`: no output.
  - `grep -rn "@modelcontextprotocol/sdk" src package.json`: no output.
  - `node dist/index.js setup claude-code` prints instructions without a `.env`.
  - Smoke test: `npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list` with a real `.env` lists the 10 tools.
- [ ] **Step 5: Commit**: `feat!: MCP SDK v2 server with 10 consolidated tools; setup CLI; remove SDK v1`

---

### Task 9: CI, changelog, docs, version

**Files:**
- Create: `.github/workflows/ci.yml`, `CHANGELOG.md`
- Modify: `package.json` (version `2.0.0-beta.1`; add `CHANGELOG.md` to `files`), `README.md`, `USAGE_GUIDE.md`

**Interfaces:** none.

- [ ] **Step 1: Write `ci.yml`**: on push to `main` and pull requests; matrix Node `20.x` and `22.x`; steps `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
- [ ] **Step 2: Write `CHANGELOG.md`** with a `2.0.0-beta.1` entry covering: breaking changes (Node 20, tool consolidation, `github_pr` mode removed, `task_report` no longer writes files, `mcp_clear_cache` removed, placeholder resources removed); the full old→new table for all 28 v1 tools from spec §3, including "removed" rows; and new features (structured output, annotations, `setup` CLI, config resource).
- [ ] **Step 3: Update docs.** README: add a "Tools (v2)" section with the spec §3 table, plus a "Migrating from 1.x" link to the CHANGELOG. Replace every v1 tool name in README and USAGE_GUIDE with its v2 equivalent; the full README rewrite is R4. Then run `grep -nE "jira_search_my_open_issues|jira_get_issue_context|jira_review_pr_alignment|delivery_verify_definition_of_done|mcp_clear_cache|delivery_get_traceability_matrix" README.md USAGE_GUIDE.md`. Expected: matches only inside the migration table.
- [ ] **Step 4: Bump version and verify.** Set `version` to `2.0.0-beta.1`, then run `npm run typecheck && npm test && npm run build && npm pack --dry-run`. Expected: green, and the tarball contains `dist/`, README, LICENSE, CHANGELOG. Then run `graphify update .`.
- [ ] **Step 5: Commit**: `chore(release): 2.0.0-beta.1 — CI, changelog, v2 docs`

Publishing (`npm publish --tag beta`), the GitHub repo rename, and the spec's R1 exit criterion "one week of personal use logged" are manual steps the owner does after reviewing the branch. They are not part of this plan's execution.
