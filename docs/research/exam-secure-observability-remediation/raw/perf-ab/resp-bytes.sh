#!/usr/bin/env bash
# Post-hoc: exact response-byte delta A/B on identical endpoints.
# (The phase recorder tracked response bytes only in aggregate; this
#  measures byte-exact downloads for the deterministic header delta.)
set -uo pipefail
OUT=/tmp/perf-ab/out
CK1=$(curl -sS -c - -H 'content-type: application/json' -d '{"username":"candidate1","password":"candidate123"}' http://127.0.0.1:3311/api/auth/login | awk '/auth-token/{print "auth-token="$NF}')
CK2=$(curl -sS -c - -H 'content-type: application/json' -d '{"username":"candidate1","password":"candidate123"}' http://127.0.0.1:3312/api/auth/login | awk '/auth-token/{print "auth-token="$NF}')
{
for ep in "GET /api/health" "GET /api/candidate/exams" "GET /api/perf/no-such-route"; do
  m=${ep%% *}; p=${ep#* }
  for v in 3311 3312; do
    if [ "$v" = 3311 ]; then CK="$CK1"; else CK="$CK2"; fi
    sz=$(curl -sS -b "$CK" -o /dev/null -w '%{size_download}' -X "$m" "http://127.0.0.1:$v$p")
    echo "$ep variant=$v bytes=$sz"
  done
done
} | tee "$OUT/resp-bytes.txt"
# SaveAnswer accepted response byte comparison (same body both sides)
AID1=$(curl -sS -b "$CK1" http://127.0.0.1:3311/api/candidate/exams | python3 -c "import sys,json; e=[x for x in json.load(sys.stdin) if x['primaryAction'] in ('resume','start')][0]; print(e['latestAttemptId'] or e['examId'])")
AID2=$(curl -sS -b "$CK2" http://127.0.0.1:3312/api/candidate/exams | python3 -c "import sys,json; e=[x for x in json.load(sys.stdin) if x['primaryAction'] in ('resume','start')][0]; print(e['latestAttemptId'] or e['examId'])")
python3 - "$AID1" "$AID2" "$CK1" "$CK2" <<'EOF' | tee -a "$OUT/resp-bytes.txt"
import json,subprocess,sys
aid1,aid2,ck1,ck2=sys.argv[1:5]
for label,base,ck,aid in [("base","http://127.0.0.1:3311",ck1,aid1),("int","http://127.0.0.1:3312",ck2,aid2)]:
    snap=json.loads(subprocess.run(['curl','-sS','-b',ck,f'{base}/api/candidate/attempts/{aid}/take'],capture_output=True,text=True).stdout)
    q=snap['questions'][0]
    body=json.dumps({'attemptId':aid,'questionId':q['id'],'answer':'A' if q['type']=='single_choice' else True,'clientSeq':999001,'clientSavedAt':'2026-11-08T16:00:00.000Z','baseVersion':q.get('currentVersion') or 0})
    r=subprocess.run(['curl','-sS','-b',ck,'-H','content-type: application/json','-X','POST','-w','\n%{size_download}','-d',body,f'{base}/api/attempts/{aid}/answers/{q["id"]}'],capture_output=True,text=True).stdout
    body_bytes=r.strip().split('\n')[-1]
    print(f'SaveAnswer accepted variant={label} bytes={body_bytes}')
EOF
echo RESP_BYTES_DONE
