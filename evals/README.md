# Tool-selection evals

Checks that a model, given this server's real tool list, picks the right tool and key arguments for 34 everyday developer requests (`cases.json`). Write tools are enabled, so the write cases are always scored.

```bash
npm run eval                                  # Claude Code (`claude -p`, your own login), claude-haiku-5-5, must reach 90%
EVAL_MODEL=claude-sonnet-5-5 npm run eval     # spot-check another model
ANTHROPIC_API_KEY=... npm run eval            # call the Anthropic API directly instead
EVAL_RUNNER=claude-code npm run eval          # force a runner (api | claude-code)
```

**Claude Code runner** (the default without an API key): each case is one `claude -p` turn with only this server loaded (`--strict-mcp-config`), no built-in tools and none of your settings, hooks or plugins (`--setting-sources ""`), from a temporary directory. The server runs from `dist/` (the script builds first) with `JIRA_BASE_URL` pointing at a closed local port, so a tool the model calls fails fast and no Jira is ever contacted. Runs count against your Claude plan.

**API runner:** sends the tool list to the Messages API and reads the response; nothing is executed.

**Scoring:** a case passes when the expected tool, with the expected key arguments, is among the calls of the model's first turn (agents often call `jira_get_issue` in parallel). The report also gives the stricter first-call-only rate. Each run writes `results/<runner>-<model>.json` with the pass rate per tool and every failure.

Run it before each release and after any change to a tool's name, description or inputs, and update the results in the README.

| Date | Runner | Model | Pass | First call only |
|---|---|---|---|---|
| 2026-10-20 | Claude Code | claude-haiku-5-5 | 34/34 | 34/34 |
| 2026-10-20 | Claude Code | claude-sonnet-5-5 | 33/34 | 33/34 |

`npm test` covers the scoring and checks that every case names a tool and arguments the server really declares.
