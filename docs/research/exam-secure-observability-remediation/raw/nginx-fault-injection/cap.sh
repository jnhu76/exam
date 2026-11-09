#!/usr/bin/env bash
# FIJ harness: capture the edge logs of run <runid> into runs/<runid>/.
# usage: cap.sh <runid>
set -u
F=/tmp/exam-fij
RID="$1"
sleep 0.4  # let nginx flush the last access/error line
docker logs fij-web >"$F/runs/$RID/docker.log" 2>&1 || true
for f in access.log error.log; do
  if [ -s "$F/runs/$RID/nglog/$f" ]; then
    cp "$F/runs/$RID/nglog/$f" "$F/runs/$RID/$f"
  else
    : >"$F/runs/$RID/$f"   # empty file = log produced zero lines (a result)
  fi
done
