# Records docs/demo.gif against a local demo Jira (demo/fake-jira.mjs): no real data.
# Run from the repo root after `npm run build`:  vhs demo/demo.tape
Output docs/demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 520
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 35ms

Hide
Type "export PS1='$ ' JIRA_BASE_URL=http://127.0.0.1:4545 JIRA_EMAIL=demo@example.com JIRA_API_TOKEN=demo-token JIRA_DEFAULT_PROJECT_KEY=ABC MCP_CACHE_ENABLED=false" Enter
Type `node demo/fake-jira.mjs 4545 & sleep 1; ask() { node demo/ask.mjs "$@"; }; clear` Enter
Sleep 1.5s
Show

Type "# You: what should I work on?   Agent calls:" Enter
Sleep 400ms
Type "ask jira_search_issues" Enter
Sleep 3.5s

Type "clear" Enter
Type "# You: I'm starting ABC-1, get me ready.   Agent calls:" Enter
Sleep 400ms
Type `ask jira_prepare_work_brief '{"issueKey":"ABC-1"}'` Enter
Sleep 8s

Hide
Type "kill %1" Enter
