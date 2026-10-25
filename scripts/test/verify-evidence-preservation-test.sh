#!/usr/bin/env bash
# Self-test for scripts/verify-evidence-preservation.sh (P1 closeout, #739).
#
# Pure-file tests: no Docker, no database. compare-mode contract cases run
# against fixture manifests; capture-mode happy/failure paths run against a
# stub psql prefix. The Docker-level negative controls (valid-but-stale
# dump, missing evidence table in a restored database, drill abort paths,
# container name collision) are executed on disposable one-off
# PostgreSQL/Docker resources during the #739 final closeout campaign and
# recorded as evidence in that campaign's closeout thread — they are
# deliberately not re-implemented here (they need real pg_restore/Docker
# semantics, not stubs).
#
# Run: bash scripts/test/verify-evidence-preservation-test.sh   (exit 0 = all PASS)

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VEP="$ROOT/scripts/verify-evidence-preservation.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vep-selftest.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

# run_case <outfile> <cmd...> — run cmd, capture exit code without letting
# set -e abort the harness (the failure-path cases are the whole point).
run_case() {
  local out="$1"
  shift
  set +e
  "$@" >"$out" 2>&1
  RUN_RC=$?
  set -e
}

record() { # record <case> <expected-exit>
  if [ "$2" = "$RUN_RC" ]; then
    echo "CASE $1: PASS (exit $RUN_RC)"
    PASS=$((PASS + 1))
  else
    echo "CASE $1: FAIL (expected exit $2, got $RUN_RC)"
    FAIL=$((FAIL + 1))
  fi
}

expect_output() { # expect_output <case> <pattern> <file>
  if grep -q -- "$2" "$3"; then
    echo "CASE $1 (output): PASS"
    PASS=$((PASS + 1))
  else
    echo "CASE $1 (output): FAIL — pattern '$2' not found in output:"
    sed 's/^/    /' "$3"
    FAIL=$((FAIL + 1))
  fi
}

# --- fixtures ---------------------------------------------------------------

src_manifest() { # src_manifest <b_runs> <b_events> <drills> <retention> <policy> [checksum]
  cat <<EOF
manifest_version=1
kind=evidence-preservation
label=source:fixture
database_source=fixture
current_database=fixture_db
capture_time_utc=2026-10-25T00:00:00Z
dump_checksum=${6:-sha256:aaaa}
backup_runs=$1
backup_run_events=$2
restore_drill_runs=$3
retention_runs=$4
backup_operational_policy=$5
EOF
}

GOOD="$WORK/good.manifest"
src_manifest 3 10 5 8 1 > "$GOOD"

# --- compare cases ----------------------------------------------------------

# T1 P1-A: matching manifests -> PASS
run_case "$WORK/t1.out" "$VEP" compare "$GOOD" "$GOOD"
record "T1-compare-pass (P1-A)" 0
expect_output "T1" "PRESERVATION_COUNT_PARITY=PASS" "$WORK/t1.out"

# T2 P1-B: valid but stale (one evidence row fewer) -> FAIL, exact table named
STALE="$WORK/stale.manifest"
src_manifest 3 9 5 8 1 > "$STALE"
run_case "$WORK/t2.out" "$VEP" compare "$GOOD" "$STALE"
record "T2-compare-stale-fewer (P1-B)" 1
expect_output "T2" "backup_run_events expected=10 restored=9" "$WORK/t2.out"
expect_output "T2" "CLEANUP=BLOCKED" "$WORK/t2.out"

# T3 P1-C: one extra row -> FAIL
EXTRA="$WORK/extra.manifest"
src_manifest 4 10 5 8 1 > "$EXTRA"
run_case "$WORK/t3.out" "$VEP" compare "$GOOD" "$EXTRA"
record "T3-compare-extra-row (P1-C)" 1
expect_output "T3" "backup_runs expected=3 restored=4" "$WORK/t3.out"

# T4 P1-D: one table key missing -> FAIL
MISSING="$WORK/missing.manifest"
grep -v '^retention_runs=' "$GOOD" > "$MISSING"
run_case "$WORK/t4.out" "$VEP" compare "$GOOD" "$MISSING"
record "T4-compare-missing-table (P1-D)" 1

# T5 P1-E: non-integer count -> FAIL
NONINT="$WORK/nonint.manifest"
sed 's/^backup_runs=3$/backup_runs=three/' "$GOOD" > "$NONINT"
run_case "$WORK/t5.out" "$VEP" compare "$GOOD" "$NONINT"
record "T5-compare-non-integer (P1-E)" 1

# T6 P1-E: malformed line -> FAIL
GARBAGE="$WORK/garbage.manifest"
{ cat "$GOOD"; echo "not a key value line"; } > "$GARBAGE"
run_case "$WORK/t6.out" "$VEP" compare "$GOOD" "$GARBAGE"
record "T6-compare-garbage-line (P1-E)" 1

# T7 P1-E: duplicate key -> FAIL
DUP="$WORK/dup.manifest"
{ cat "$GOOD"; echo "backup_runs=99"; } > "$DUP"
run_case "$WORK/t7.out" "$VEP" compare "$GOOD" "$DUP"
record "T7-compare-duplicate-key (P1-E)" 1

# T8 P1-E: manifest file missing -> FAIL
run_case "$WORK/t8.out" "$VEP" compare "$GOOD" "$WORK/nonexistent.manifest"
record "T8-compare-missing-file (P1-E)" 1

# T9 source manifest incomplete (no capture_time_utc) -> FAIL
NOTIME="$WORK/notime.manifest"
grep -v '^capture_time_utc=' "$GOOD" > "$NOTIME"
run_case "$WORK/t9.out" "$VEP" compare "$NOTIME" "$GOOD"
record "T9-compare-incomplete-source" 1

# T10 wrong kind -> FAIL
WRONGKIND="$WORK/wrongkind.manifest"
sed 's/^kind=.*/kind=other/' "$GOOD" > "$WRONGKIND"
run_case "$WORK/t10.out" "$VEP" compare "$GOOD" "$WRONGKIND"
record "T10-compare-wrong-kind" 1

# T11 dump checksum mismatch -> FAIL even though all counts match (stale-dump
# mixup whose evidence tables were untouched between the two dumps)
OTHERSUM="$WORK/othersum.manifest"
src_manifest 3 10 5 8 1 sha256:bbbb > "$OTHERSUM"
run_case "$WORK/t11.out" "$VEP" compare "$GOOD" "$OTHERSUM"
record "T11-compare-checksum-mismatch" 1
expect_output "T11" "dump checksum mismatch" "$WORK/t11.out"

# --- capture cases (stub psql prefix) ---------------------------------------

stub_psql() {
  # Emits the one value the SQL asks for from $STUB_COUNTS (k=v pairs).
  local sql="$1" t kv
  case "$sql" in
    *current_database*) echo "stub_db" ;;
    "SELECT count(*) FROM "*)
      t="${sql##*FROM }"
      for kv in $STUB_COUNTS; do
        if [ "${kv%%=*}" = "$t" ]; then echo "${kv#*=}"; return 0; fi
      done
      echo "ERROR: relation \"public.$t\" does not exist" >&2
      return 1
      ;;
    *) echo "unexpected SQL: $sql" >&2; return 1 ;;
  esac
}
export -f stub_psql
STUB_COUNTS="backup_runs=3 backup_run_events=10 restore_drill_runs=5 retention_runs=8 backup_operational_policy=1"
export STUB_COUNTS

# T12 capture happy path -> manifest written, compares equal to fixture
CAP="$WORK/captured.manifest"
# shellcheck disable=SC2016
run_case "$WORK/t12.out" "$VEP" capture --label captured:stub \
  --database-source "stub" --dump-checksum sha256:aaaa --output "$CAP" \
  -- bash -c 'stub_psql "$1"' _
record "T12-capture-pass" 0
run_case "$WORK/t12b.out" "$VEP" compare "$GOOD" "$CAP"
record "T12b-captured-matches-fixture" 0
expect_output "T12b" "PRESERVATION_COUNT_PARITY=PASS" "$WORK/t12b.out"

# T13 capture with failing command prefix (connection failure analog, P1-F)
OUT13="$WORK/t13.manifest"
rm -f "$OUT13"
run_case "$WORK/t13.out" "$VEP" capture --output "$OUT13" -- /bin/false
record "T13-capture-command-fails (P1-F)" 1
if [ ! -e "$OUT13" ]; then
  echo "CASE T13 (no manifest written): PASS"; PASS=$((PASS + 1))
else
  echo "CASE T13 (no manifest written): FAIL — $OUT13 exists"; FAIL=$((FAIL + 1))
fi

# T14 capture with a table missing in the target (P1-D analog)
OUT14="$WORK/t14.manifest"
rm -f "$OUT14"
# shellcheck disable=SC2016
STUB_COUNTS="backup_runs=3 backup_run_events=10 restore_drill_runs=5 retention_runs=8" \
  run_case "$WORK/t14.out" "$VEP" capture --output "$OUT14" -- bash -c 'stub_psql "$1"' _
record "T14-capture-missing-table (P1-D)" 1
if [ ! -e "$OUT14" ]; then
  echo "CASE T14 (no manifest written): PASS"; PASS=$((PASS + 1))
else
  echo "CASE T14 (no manifest written): FAIL — $OUT14 exists"; FAIL=$((FAIL + 1))
fi

# T15 capture with a non-integer answer (corrupt analog, P1-E)
OUT15="$WORK/t15.manifest"
rm -f "$OUT15"
# shellcheck disable=SC2016
STUB_COUNTS="backup_runs=three backup_run_events=10 restore_drill_runs=5 retention_runs=8 backup_operational_policy=1" \
  run_case "$WORK/t15.out" "$VEP" capture --output "$OUT15" -- bash -c 'stub_psql "$1"' _
record "T15-capture-non-integer (P1-E)" 1
if [ ! -e "$OUT15" ]; then
  echo "CASE T15 (no manifest written): PASS"; PASS=$((PASS + 1))
else
  echo "CASE T15 (no manifest written): FAIL — $OUT15 exists"; FAIL=$((FAIL + 1))
fi

# T16 capture without --output -> usage error, nonzero
# shellcheck disable=SC2016
run_case "$WORK/t16.out" "$VEP" capture -- bash -c 'stub_psql "$1"' _
record "T16-capture-usage" 2

# T17 compare with an unrecorded dump checksum (one side) -> FAIL closed;
# the gate never decides on counts alone
NOCSUM="$WORK/nocsum.manifest"
sed 's/^dump_checksum=.*/dump_checksum=UNRECORDED/' "$GOOD" > "$NOCSUM"
run_case "$WORK/t17.out" "$VEP" compare "$GOOD" "$NOCSUM"
record "T17-compare-checksum-unrecorded" 1
expect_output "T17" "checksum not recorded" "$WORK/t17.out"

# T18 both sides unrecorded -> still FAIL closed (counts alone never pass)
run_case "$WORK/t18.out" "$VEP" compare "$NOCSUM" "$NOCSUM"
record "T18-compare-both-unrecorded" 1

# T19 capture --expect-database happy path (matches stub_db)
# shellcheck disable=SC2016
run_case "$WORK/t19.out" "$VEP" capture --expect-database stub_db --output "$WORK/t19.manifest"   -- bash -c 'stub_psql "$1"' _
record "T19-expect-database-pass" 0

# T20 capture --expect-database mismatch -> FAIL, no manifest
rm -f "$WORK/t20.manifest"
# shellcheck disable=SC2016
run_case "$WORK/t20.out" "$VEP" capture --expect-database exam_drill --output "$WORK/t20.manifest"   -- bash -c 'stub_psql "$1"' _
record "T20-expect-database-mismatch" 1
if [ ! -e "$WORK/t20.manifest" ]; then
  echo "CASE T20 (no manifest written): PASS"; PASS=$((PASS + 1))
else
  echo "CASE T20 (no manifest written): FAIL — $WORK/t20.manifest exists"; FAIL=$((FAIL + 1))
fi

# T21 capture with a multi-line answer (prefix printing more than one
# result line must fail, not concatenate lines into one integer)
stub_multiline() {
  printf '3\n10\n'
}
export -f stub_multiline
rm -f "$WORK/t21.manifest"
run_case "$WORK/t21.out" "$VEP" capture --output "$WORK/t21.manifest"   -- bash -c 'stub_multiline' _
record "T21-multi-line-answer" 1
if [ ! -e "$WORK/t21.manifest" ]; then
  echo "CASE T21 (no manifest written): PASS"; PASS=$((PASS + 1))
else
  echo "CASE T21 (no manifest written): FAIL — $WORK/t21.manifest exists"; FAIL=$((FAIL + 1))
fi

# --- summary ----------------------------------------------------------------

echo
echo "SELFTEST RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
