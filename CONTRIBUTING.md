# Contributing

Thanks for helping improve jira-delivery-mcp.

## Setup

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Node.js 20 or later is required.

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

## Releasing (maintainer)

1. In a PR, set the same version in `package.json`, `plugin/.claude-plugin/plugin.json` (its `version` and the `jira-delivery-mcp@<version>` it runs) and `server.json` (a test checks they match), and move the `## Unreleased` notes under that version.
2. After merge: `git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`.
3. The Release workflow checks the tag against the manifests, runs the tests, publishes to npm with provenance (`beta` dist-tag for prereleases, `latest` otherwise), lists the version in the MCP Registry and creates the GitHub release.

npm trusted publishing must be set up once on npmjs.com (package settings → Trusted publisher → GitHub Actions, workflow `release.yml`). Until then the npm step fails and `npm publish --tag beta` by hand still works; the workflow skips a version that is already on npm.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — please don't open a public issue for vulnerabilities.
