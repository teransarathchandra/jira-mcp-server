# Contributing

Thanks for helping improve jira-delivery-mcp. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Node.js 20 or later is required. `npm run dev` starts the built server with your local `.env`.

## Project layout

| Path | What's there |
|---|---|
| `src/server/` | MCP server: tool registration, envelopes, prompts |
| `src/delivery/`, `src/tools/` | The workflow logic behind each tool |
| `src/writes/` | Guarded writes: confirm tokens, elicitation, audit log |
| `plugin/` | Claude Code plugin and the `jira-delivery` skill |
| `evals/` | Tool-selection evals (`npm run eval`) |
| `tests/` | Vitest suite; Jira is replaced by recorded fixtures |
| `docs/` | User docs, GIFs (`docs/assets/`) and the scripts that record them (`docs/demo/`) |

## How changes are made

- **Tests first.** Every behaviour change comes with a test that fails before the change and passes after it. Tests never call a real Jira: use the recorded fixtures in `tests/fixtures/jira/` with `installJiraFixture()` from `tests/helpers/jiraFixtures.ts`.
- **Keep tools few and sharp.** New behaviour usually belongs in an existing tool's inputs rather than a new tool. Every tool declares an `outputSchema` and annotations.
- **Jira content is untrusted.** Never copy ticket text into instructions, actions or questions; never derive a write from ticket text.
- **Writes are guarded.** Anything that changes Jira goes through `runGuardedWrite` (preview → confirm token or form → audit) and is sent without retries.
- **stdout is the protocol channel.** Only `src/cli.ts` may write to stdout.

## Pull requests

- One topic per PR, with a short description of what changed and why.
- CI (typecheck, tests, build on Node 20 and 22) must pass.
- Update `CHANGELOG.md` under `## Unreleased`.
- If a tool's name, description or inputs change, run `npm run eval` (it uses your Claude Code login, or `ANTHROPIC_API_KEY`).

## Re-recording the GIFs

The GIFs in `docs/assets/` are recorded with [VHS](https://github.com/charmbracelet/vhs) and [glow](https://github.com/charmbracelet/glow) against a local fake Jira (`docs/demo/fake-jira.mjs`), so no real data appears in them:

```bash
npm run build
vhs docs/demo/start.tape && vhs docs/demo/verify.tape && vhs docs/demo/handoff.tape
```

## Releasing (maintainer)

1. If tool names, descriptions or inputs changed, or the skill did, run `npm run eval` (and `EVAL_SKILL=1 npm run eval`) and update the results table in `evals/README.md` and the line in the README.
2. In a PR, set the same version in `package.json`, `plugin/.claude-plugin/plugin.json` (its `version` and the `jira-delivery-mcp@<version>` it runs) and `server.json` (a test checks they match), and move the `## Unreleased` notes under that version.
3. After merge: `git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`.
4. The Release workflow checks the tag against the manifests, runs the tests, publishes to npm with provenance (`beta` dist-tag for prereleases, `latest` otherwise), lists the version in the MCP Registry and creates the GitHub release with the skill zip (`npm run skill:pack`) attached.

npm trusted publishing must be set up once, on npmjs.com (package settings → Trusted publisher → GitHub Actions, workflow `release.yml`) or with `npm trust github jira-delivery-mcp --file release.yml --repo teransarathchandra/jira-mcp-server --allow-publish` (needs 2FA). Until then the npm step fails and `npm publish` by hand still works (`--tag beta` for a prerelease); the workflow skips a version that is already on npm.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — please don't open a public issue for vulnerabilities.
