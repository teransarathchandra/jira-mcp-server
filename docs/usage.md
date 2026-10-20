# Using it day to day

You talk to your agent; it picks the tool. These are the requests the tools are built for (the [tool-selection evals](../evals/README.md) check that agents route them correctly).

## Pick and start a ticket

- *"What should I work on next?"* — your open issues
- *"Show me the open bugs in the current sprint, highest priority first."* — a JQL search
- *"I'm starting ABC-101, get me ready to implement it."* — readiness, blockers, next steps, questions and a branch name
- *"Get ABC-101 with its epic, linked issues and Confluence docs."* — full context

## While you build

- *"Which parts of the codebase will ABC-22 touch?"* — impact, before any code exists
- *"Plan the tests I should write for ABC-32."* — test strategy

## Before the PR

- *"Check my branch against ABC-20 before I open the PR."* — one verdict: `ready_for_pr`, `needs_work` or `insufficient_evidence`
- *"Have I met the Definition of Done for ABC-23?"*
- *"Map each requirement in ABC-41 to the code and tests that cover it."* — traceability matrix

## Hand off

- *"Write a QA handoff for ABC-30."*
- *"Release notes for ABC-31, customer-safe."*
- *"Review ABC-33 from a security reviewer's point of view."*
- *"Post the QA handoff to ABC-30 as a comment."* — with writes enabled, you see a preview and approve it
- *"Move ABC-30 to In Review, assign it to me and link PR #42."*

## Tips

- Use `depth: "full"` (or just ask for "full context") for tickets with a parent, epic or linked issues.
- Turn on Confluence when specs live there; set `CONFLUENCE_SPACE_KEYS` to keep results focused.
- Install the [`jira-delivery` skill](../plugin/skills/jira-delivery/SKILL.md) so the agent follows the start → verify → hand-off loop on its own.
