# Records docs/assets/verify.gif. Run from the repo root after `npm run build`: vhs docs/demo/verify.tape
Output docs/assets/verify.gif
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
Type "source docs/demo/setup.sh && cd $DEMO_REPO && clear" Enter
Sleep 2.5s
Show

Type "git log --oneline main.. && git diff --stat main" Enter
Sleep 2.5s
Type `# "Check my branch against ABC-1 before I open the PR."  ->  delivery_check_changes` Enter
Sleep 300ms
Type `ask delivery_check_changes '{"issueKey":"ABC-1","baseBranch":"main"}'` Enter
Sleep 9s
