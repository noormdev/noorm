Source theme.tape

Output ../public/image/pipeline-run.gif
Set Width 1200
Set Height 700
Set FontSize 15
Set TypingSpeed 90ms
Env CI "false"
Env FORCE_COLOR "1"

Hide
Type "source ./env-scrub.sh" Enter
Type "export TAPES_DIR=$PWD" Enter
Type "bash ./pipeline-sandbox.sh run" Enter
Wait+Screen@180s /pipeline sandbox ready \(run\)/
Type "export HOME=/tmp/noorm-demo-pipelines/home" Enter
Type "export PATH=/tmp/noorm-demo-pipelines/bin:$PATH" Enter
Type "cd /tmp/noorm-demo-pipelines/project" Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show
Sleep 1s
# October invoices are paid; the period is a required typed string saved explicitly.
Type "noorm ui" Enter
Wait+Screen@30s /Pipelines/
Sleep 1s
Type "p"
Wait+Screen@20s /close-period · 3 steps · graph/
Sleep 2s
Enter
Wait+Screen@20s /Next invocation: execute/
Sleep 2s
Enter
Wait+Screen@10s /Pipeline input: period/
Sleep 1s
Enter
Sleep 500ms
Type "2026-10"
Enter
Sleep 500ms
Down
Sleep 1s
Enter
Wait+Screen@10s /period · string · Supplied/
Sleep 2s
Type "s"
Wait+Screen@10s /3. publish-close · needs: 2/
Sleep 1s
Down
Sleep 500ms
Down
Sleep 800ms
Enter
Wait+Screen@10s /Step 3: publish-close/
Sleep 2s
Escape
Sleep 800ms
# No arrow keys here: reopening the same third row proves retained selection.
Enter
Wait+Screen@10s /Step 3: publish-close/
Sleep 1s
Escape
Sleep 800ms
Type "D"
Wait+Screen@10s /Next invocation: dry run/
Sleep 1s
Type "r"
Wait+Screen@10s /Dry run close-period on dev/
Sleep 1s
Type "y"
Wait+Screen@30s /Dry run — no workflow SQL or run history written/
Wait+Screen@10s /Run ID: none \(dry run\)/
Sleep 3s
Escape
Sleep 800ms
Escape
Sleep 800ms
Type "q"
Sleep 2s
Type "bash $TAPES_DIR/pipeline-verify.sh dry" Enter
Wait+Screen@20s /Verified dry: history and business invariants/
Sleep 3s
Type "clear" Enter
# Reopen the real UI after independently checking that dry run had no effects.
Type "noorm ui" Enter
Wait+Screen@30s /Pipelines/
Sleep 1s
Type "p"
Wait+Screen@20s /close-period · 3 steps · graph/
Sleep 2s
Enter
Wait+Screen@20s /Next invocation: execute/
Sleep 2s
Enter
Wait+Screen@10s /Pipeline input: period/
Sleep 1s
Enter
Sleep 500ms
Type "2026-10"
Enter
Sleep 500ms
Down
Sleep 1s
Enter
Wait+Screen@10s /period · string · Supplied/
Sleep 2s
Type "r"
Wait+Screen@10s /Run close-period on dev/
Sleep 1s
Type "y"
Wait+Screen@30s /Execution status: success · Transaction outcome: committed/
Sleep 3s
Type "d"
Wait+Screen@10s /Execution status: success/
Wait+Screen@10s /Run ID: 1/
Sleep 2s
Escape
Sleep 800ms
Escape
Sleep 800ms
Escape
Sleep 800ms
Type "q"
Sleep 2s
Type "bash $TAPES_DIR/pipeline-verify.sh run" Enter
Wait+Screen@20s /Verified run: history and business invariants/
Sleep 4s
