# Records docs/assets/handoff.gif. Run from the repo root after `npm run build`: vhs docs/demo/handoff.tape
Output docs/assets/handoff.gif
Set Shell "bash"
Set FontSize 15
Set Width 1200
Set Height 470
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

Type "export JIRA_ENABLE_WRITES=true   # write-back is opt-in" Enter
Sleep 800ms
Type `# "Post the QA handoff to ABC-1."  ->  jira_add_comment (first call: preview only)` Enter
Sleep 300ms
Type `ask jira_add_comment '{"issueKey":"ABC-1","markdown":"## QA handoff\n\nReady for testing on **staging**: the account locks for 15 minutes after 5 failed logins."}'` Enter
Sleep 10s
