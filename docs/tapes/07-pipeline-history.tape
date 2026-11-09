Source theme.tape

Output ../public/image/pipeline-history.gif
Set Width 1200
Set Height 700
Set FontSize 15
Set TypingSpeed 90ms
Env CI "false"
Env FORCE_COLOR "1"

Hide
Type "source ./env-scrub.sh" Enter
Type "export TAPES_DIR=$PWD" Enter
Type "bash ./pipeline-sandbox.sh history" Enter
Wait+Screen@180s /pipeline sandbox ready \(history\)/
Type "export HOME=/tmp/noorm-demo-pipelines/home" Enter
Type "export PATH=/tmp/noorm-demo-pipelines/bin:$PATH" Enter
Type "cd /tmp/noorm-demo-pipelines/project" Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show
Sleep 1s
# Bootstrap executed close-period-step for November through the real CLI (exit 3).
# December has its own unpaid invoice: whole-pipeline rollback must leave no December cache.
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
Type "2026-12"
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
Wait+Screen@30s /Execution status: failed · Transaction outcome: rolled_back/
Sleep 3s
Down
Sleep 800ms
Enter
Wait+Screen@10s /Step 2: validate-paid/
Wait+Screen@10s /Transaction outcome: rolled_back/
Sleep 2s
Escape
Sleep 800ms
Enter
Wait+Screen@10s /Step 2: validate-paid/
Sleep 1s
Escape
Sleep 800ms
Type "h"
Wait+Screen@20s /#2 · failed · rolled_back/
Sleep 2s
Enter
Wait+Screen@20s /Pipeline run #2/
Wait+Screen@10s /1. refresh-cache · success · rolled_back/
Sleep 2s
Down
Sleep 500ms
Down
Sleep 800ms
Enter
Wait+Screen@10s /Step 3: publish-close/
Wait+Screen@10s /Transaction outcome: not_started/
Sleep 2s
Escape
Sleep 800ms
Type "r"
Wait+Screen@20s /3. publish-close · skipped · not_started/
Sleep 1s
Enter
Wait+Screen@10s /Step 3: publish-close/
Sleep 1s
Escape
Sleep 800ms
Type "i"
Wait+Screen@10s /Pipeline run ID lookup/
Sleep 1s
Escape
Sleep 800ms
Enter
Wait+Screen@10s /Step 3: publish-close/
Sleep 1s
Escape
Sleep 800ms
Type "i"
Wait+Screen@10s /Pipeline run ID lookup/
Sleep 800ms
Enter
Sleep 500ms
Backspace
Type "1"
Enter
Sleep 500ms
Down
Sleep 800ms
Enter
Wait+Screen@20s /Pipeline run #1/
Wait+Screen@10s /Execution status: partial · Transaction outcome: partial/
Wait+Screen@10s /1. refresh-cache · success · committed/
Sleep 3s
Enter
Wait+Screen@10s /Step 1: refresh-cache/
Wait+Screen@10s /Transaction outcome: committed/
Sleep 2s
Escape
Sleep 800ms
Type "d"
Wait+Screen@10s /Pipeline: close-period-step/
Wait+Screen@10s /Transaction: step/
Sleep 2s
Escape
Sleep 800ms
Escape
Sleep 800ms
Escape
Sleep 800ms
Escape
Sleep 800ms
Escape
Sleep 800ms
Type "q"
Sleep 2s
Type "bash $TAPES_DIR/pipeline-verify.sh history" Enter
Wait+Screen@20s /Verified history: history and business invariants/
Sleep 4s
