# Records docs/assets/start.gif. Run from the repo root after `npm run build`: vhs docs/demo/start.tape
Output docs/assets/start.gif
Set Shell "bash"
Set FontSize 15
Set Width 1200
Set Height 600
Set Padding 20
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set BorderRadius 10
Set Margin 16
Set MarginFill "#11111b"
Set TypingSpeed 30ms

Hide
Type "source docs/demo/setup.sh" Enter
Sleep 2.5s
Show

Type `# "What should I work on?"  ->  jira_search_issues` Enter
Sleep 300ms
Type "ask jira_search_issues" Enter
Sleep 3s
Type "clear" Enter
Type `# "I'm starting ABC-1, get me ready."  ->  jira_prepare_work_brief` Enter
Sleep 300ms
Type `ask jira_prepare_work_brief '{"issueKey":"ABC-1"}'` Enter
Sleep 9s
