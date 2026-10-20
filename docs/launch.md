# Launch checklist and listing copy

Drafts for after **2.0.0** (spec decision Q21: free listings first, paid add-ons only once there is adoption). Nothing here is submitted automatically.

## Publish day (2.0.0)

1. Merge the release PR (all manifests at 2.0.0, install lines without `@beta`).
2. One-time, if not done yet: `npm trust github jira-delivery-mcp --file release.yml --repo teransarathchandra/jira-mcp-server --allow-publish` (needs an authenticator code). Without it, run `npm publish` by hand before step 3; the workflow then skips npm.
3. `git tag -a v2.0.0 -m v2.0.0 && git push origin v2.0.0`. The Release workflow publishes to npm as `latest` with provenance, lists 2.0.0 in the MCP Registry, and creates the GitHub release with `jira-delivery-skill-2.0.0.zip` attached.
4. Move the `beta` dist-tag forward so anyone on `@beta` gets 2.0.0: `npm dist-tag add jira-delivery-mcp@2.0.0 beta`.
5. Check: `npx jira-delivery-mcp@latest --version` prints 2.0.0, and `/plugin install jira-delivery@jira-delivery` starts the server.

## Before listing

- [ ] 2.0.0 published to npm as `latest`; README and skill install lines use plain `jira-delivery-mcp` (the release-line tests enforce this once the version has no prerelease suffix).
- [ ] `v2.0.0` tag pushed: the release workflow lists it in the MCP Registry and attaches `jira-delivery-skill-2.0.0.zip` to the GitHub release.
- [ ] `npm run eval` and `EVAL_SKILL=1 npm run eval` re-run; results table in `evals/README.md` current.
- [ ] Demo GIF current (`vhs demo/demo.tape`).

## Agensi (agensi.io/sell)

Upload `jira-delivery-skill-<version>.zip` from the GitHub release.

- **Name:** Jira Delivery
- **Price:** Free
- **Category:** Developer tools / project management
- **Works with:** Claude Code, Cursor, GitHub Copilot (VS Code), Codex CLI, Windsurf, Claude Desktop, any agent with MCP and Agent Skills
- **Tagline:** From Jira ticket to merged PR without leaving your coding agent.
- **Description:**

  Turns your coding agent into a Jira-aware delivery partner. Ask "I'm starting ABC-101" and get a ready-to-build brief: readiness, blockers, acceptance criteria, next steps and a branch name. Before the PR, ask it to check your branch: it compares your local diff with the acceptance criteria and Definition of Done and gives one verdict, ready, needs work, or not enough evidence. Then it writes the QA handoff, release notes or review report, and, if you allow it, posts it to Jira.

  The skill drives the free, open-source jira-delivery-mcp server (MIT), which runs locally with npx and connects only to your own Jira Cloud site (and Confluence, if you configure it) with your API token. No telemetry. It reads by default; writes are opt-in and every write is previewed and needs your confirmation. The skill contains no scripts.

- **Security notes for review:** no executable files; network access only through the user-installed MCP server to the user's own Atlassian site; no credentials requested in chat (setup tells the agent never to ask for the token in the conversation).

## Directories

| Where | How | Entry |
|---|---|---|
| MCP Registry | automatic on tag push (`server.json`) | `io.github.teransarathchandra/jira-delivery-mcp` |
| awesome-mcp-servers (punkpeye) | PR adding one line under *Project management* | `- [teransarathchandra/jira-mcp-server](https://github.com/teransarathchandra/jira-mcp-server) 📇 🏠 - Jira Cloud delivery workflows for coding agents: ready-to-build briefs, branch checks against acceptance criteria, QA handoffs and opt-in safe write-back.` |
| Cursor directory | submit the repo; the README's *Add to Cursor* link is the install | same tagline |
| Claude Code plugin marketplaces | the repo is already a marketplace (`/plugin marketplace add teransarathchandra/jira-mcp-server`) | — |

Short description (≤100 characters, also used by the MCP Registry): see `server.json`.
