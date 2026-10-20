# Tool-selection evals

Checks that a model, given this server's real tool list, picks the right tool and key arguments for 34 everyday developer requests (`cases.json`). The runner enables the write tools, so the write cases are always scored. Without `ANTHROPIC_API_KEY` the run fails rather than passing empty.

```bash
ANTHROPIC_API_KEY=... npm run eval                              # claude-haiku-5-5, must reach 90%
ANTHROPIC_API_KEY=... EVAL_MODEL=claude-sonnet-5-5 npm run eval # spot-check
```

The run never calls Jira (the tools are listed, not executed). Each run writes `results/<model>.json` with the pass rate per tool and every failure. Run it on demand and before each release, after any change to a tool's name, description or inputs, and put the pass rate in the README.

`npm test` covers the scoring and checks that every case names a tool and arguments the server really declares.
