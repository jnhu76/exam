#!/usr/bin/env bash
# Read-only evidence-preservation validator for the ADR-023 upgrade gate
# (upgrade-and-uninstall.md §2.7, issue #739 final safety closeout).
#
# Usage:
#   verify-evidence-preservation.sh capture [--label S] [--database-source S]
#       [--dump-checksum S] [--expect-database NAME] --output FILE -- <psql-prefix...>
#   verify-evidence-preservation.sh compare <source-manifest> <restored-manifest>
#
# capture: queries current_database() and the five backup-evidence table counts
#   through the given psql invocation prefix (everything after `--` is the
#   command that runs one SQL statement appended as its last argument, e.g.
#   `docker exec C psql -U postgres -d exam_drill -v ON_ERROR_STOP=1 -tAc`)
#   and writes a normalized key=value manifest, atomically. Any query failure,
#   multi-line answer, missing table, non-integer count, or (--expect-database)
#   unexpected target database aborts with a nonzero exit and writes no
#   manifest.
# compare: structurally validates both manifests, then compares the five
#   counts table by table. Both manifests MUST record a dump checksum and it
#   must be the SAME artifact — an unrecorded or differing checksum fails
#   closed (the gate never decides on counts alone, so an operator adaptation
#   that drops --dump-checksum cannot silently weaken it). Any missing key,
#   malformed line, non-integer count, count mismatch, or checksum problem
#   prints the exact reason and exits 1; only a full match prints
#   PRESERVATION_COUNT_PARITY=PASS and exits 0.
#
# INVARIANT: this script is read-only. It never modifies a database, never
#   runs TRUNCATE/DELETE/DROP, and never removes files other than its own
#   temporary manifest file. Cleanup authorization stays with the human
#   operator per §2.7; this tool only decides whether the gate passes.
# INVARIANT: count parity is a NECESSARY condition, not a content-level
#   proof — equal counts do not prove the rows are identical, and the PASS
#   note says so. Its job is to prove the dump is current w.r.t. the five
#   tables (a valid but stale dump fails here), not that restore is lossless.

set -Eeuo pipefail

TABLES=(
  backup_runs
  backup_run_events
  restore_drill_runs
  retention_runs
  backup_operational_policy
)

usage() {
  sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# capture
# ---------------------------------------------------------------------------
do_capture() {
  local label="" database_source="" dump_checksum="" output="" expect_database=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --label) [ $# -ge 2 ] || usage; label="$2"; shift 2 ;;
      --database-source) [ $# -ge 2 ] || usage; database_source="$2"; shift 2 ;;
      --dump-checksum) [ $# -ge 2 ] || usage; dump_checksum="$2"; shift 2 ;;
      --expect-database) [ $# -ge 2 ] || usage; expect_database="$2"; shift 2 ;;
      --output) [ $# -ge 2 ] || usage; output="$2"; shift 2 ;;
      --) shift; break ;;
      *) usage ;;
    esac
  done
  [ -n "$output" ] || usage
  [ $# -gt 0 ] || die "capture: missing psql invocation prefix after --"
  local -a psql_prefix=("$@")

  [ -n "$dump_checksum" ] || dump_checksum="UNRECORDED"
  [ -n "$database_source" ] || database_source="UNRECORDED"
  [ -n "$label" ] || label="UNRECORDED"

  # One statement per invocation; psql prints the single result value.
  # single_value also rejects multi-line answers (a prefix printing more
  # than one result line must fail, not concatenate the lines into one
  # plausible-looking integer).
  single_value() {
    local raw
    raw="$("${psql_prefix[@]}" "$1")" || return 1
    case "$raw" in *$'\n'*) return 1 ;; esac
    printf '%s' "$raw" | tr -d '[:space:]'
  }

  local current_db
  current_db="$(single_value 'SELECT current_database()')" \
    || die "capture: current_database() query failed or returned more than one line"
  [ -n "$current_db" ] || die "capture: current_database() returned nothing"
  # A multi-word answer means psql printed more than the one value expected.
  case "$current_db" in
    *[!A-Za-z0-9_]*) die "capture: unexpected current_database() result: $current_db" ;;
  esac
  # Fail closed on a wrong target: the §2.7 flow records which database each
  # manifest is captured from, so a misrouted capture aborts here instead of
  # producing a manifest that compares equal against itself.
  if [ -n "$expect_database" ] && [ "$current_db" != "$expect_database" ]; then
    die "capture: target database is '$current_db', expected '$expect_database' — capture is aimed at the wrong database"
  fi

  local manifest
  manifest="$(mktemp "${TMPDIR:-/tmp}/evidence-manifest.XXXXXX")"
  # ${manifest:-} — this trap also fires from die() inside the write block,
  # where the local may already be unwound; never let cleanup mask the error.
  trap 'rm -f "${manifest:-}"' EXIT
  {
    echo "manifest_version=1"
    echo "kind=evidence-preservation"
    echo "label=$label"
    echo "database_source=$database_source"
    echo "current_database=$current_db"
    echo "capture_time_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "dump_checksum=$dump_checksum"
    local t count
    for t in "${TABLES[@]}"; do
      count="$(single_value "SELECT count(*) FROM $t")" \
        || die "capture: count query for $t failed or returned more than one line"
      case "$count" in
        '' | *[!0-9]*)
          die "capture: count for $t is not a non-negative integer (got: '${count:-<empty>}')" \
        ;;
      esac
      echo "$t=$count"
    done
  } > "$manifest"

  # Atomic publish: a failed capture must leave no manifest behind.
  mv -f "$manifest" "$output"
  trap - EXIT
  echo "capture: wrote $output (database=$current_db)"
}

# ---------------------------------------------------------------------------
# compare
# ---------------------------------------------------------------------------
# Parses a manifest into the caller-visible associative array MANIFEST.
# Fails (exits 1) on unreadable file, malformed line, or duplicate key.
parse_manifest() {
  local file="$1" line key value
  [ -f "$file" ] || die "compare: manifest not found: $file"
  declare -gA MANIFEST=()
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || die "compare: $file: empty line (malformed manifest)"
    key="${line%%=*}"
    value="${line#*=}"
    [ "$key" != "$line" ] || die "compare: $file: line is not key=value: $line"
    case "$key" in
      [A-Za-z_][A-Za-z0-9_]*) ;;
      *) die "compare: $file: invalid key: $key" ;;
    esac
    [ -n "$value" ] || die "compare: $file: empty value for key: $key"
    [ -z "${MANIFEST[$key]+set}" ] || die "compare: $file: duplicate key: $key"
    MANIFEST["$key"]="$value"
  done < "$file"
}

# Fails unless every required key is present with a valid value.
require_manifest_fields() {
  local file="$1" role="$2" k v
  for k in manifest_version kind label current_database capture_time_utc \
           dump_checksum; do
    [ -n "${MANIFEST[$k]+set}" ] || die "compare: $file: missing key: $k"
  done
  [ "${MANIFEST[manifest_version]}" = "1" ] \
    || die "compare: $file: unsupported manifest_version: ${MANIFEST[manifest_version]}"
  [ "${MANIFEST[kind]}" = "evidence-preservation" ] \
    || die "compare: $file: wrong kind: ${MANIFEST[kind]}"
  local -a missing=()
  for k in "${TABLES[@]}"; do
    v="${MANIFEST[$k]-}"
    case "$v" in
      '' | *[!0-9]*) missing+=("$k (value: '${v:-<missing>}')") ;;
    esac
  done
  [ ${#missing[@]} -eq 0 ] \
    || die "compare: $file ($role): invalid/missing evidence-table counts: ${missing[*]}"
}

do_compare() {
  [ $# -eq 2 ] || usage
  local source_file="$1" restored_file="$2"

  parse_manifest "$source_file"
  require_manifest_fields "$source_file" "source"
  local -A SOURCE_MANIFEST=()
  local k
  for k in "${!MANIFEST[@]}"; do SOURCE_MANIFEST["$k"]="${MANIFEST[$k]}"; done

  parse_manifest "$restored_file"
  require_manifest_fields "$restored_file" "restored"

  echo "source_manifest=${SOURCE_MANIFEST[label]} ($source_file)"
  echo "restored_manifest=${MANIFEST[label]} ($restored_file)"

  # INVARIANT: this gate never verifies unbound records. Both manifests
  # must record a dump checksum and it must be the SAME artifact: an
  # unrecorded checksum means the manifest was captured outside the §2.7
  # flow (or an operator adaptation dropped --dump-checksum) and the gate
  # fails closed instead of deciding on counts alone.
  if [ "${SOURCE_MANIFEST[dump_checksum]}" = "UNRECORDED" ] \
     || [ "${MANIFEST[dump_checksum]}" = "UNRECORDED" ]; then
    echo "PRESERVATION_COUNT_PARITY=FAIL"
    echo "REASON=dump checksum not recorded on both manifests (source=${SOURCE_MANIFEST[dump_checksum]} restored=${MANIFEST[dump_checksum]}) — evidence identity unbound, refusing to decide on counts alone"
    exit 1
  fi
  # A differing checksum is a stale-dump mixup; it must fail even when the
  # five counts happen to coincide.
  if [ "${SOURCE_MANIFEST[dump_checksum]}" != "${MANIFEST[dump_checksum]}" ]; then
    echo "PRESERVATION_COUNT_PARITY=FAIL"
    echo "REASON=dump checksum mismatch: source=${SOURCE_MANIFEST[dump_checksum]} restored=${MANIFEST[dump_checksum]}"
    exit 1
  fi

  local t mismatched=() fail_reason=""
  for t in "${TABLES[@]}"; do
    if [ "${SOURCE_MANIFEST[$t]}" = "${MANIFEST[$t]}" ]; then
      echo "table $t: ${SOURCE_MANIFEST[$t]} == ${MANIFEST[$t]} OK"
    else
      echo "table $t: expected ${SOURCE_MANIFEST[$t]} restored ${MANIFEST[$t]} MISMATCH"
      mismatched+=("$t")
      fail_reason="count mismatch: $t expected=${SOURCE_MANIFEST[$t]} restored=${MANIFEST[$t]}"
    fi
  done

  if [ ${#mismatched[@]} -gt 0 ]; then
    echo "PRESERVATION_COUNT_PARITY=FAIL"
    echo "MISMATCHED_TABLES=${mismatched[*]}"
    echo "REASON=$fail_reason"
    echo "CLEANUP=BLOCKED (keep the source database untouched; re-run §2.7 from a fresh quiesced backup)"
    exit 1
  fi

  echo "PRESERVATION_COUNT_PARITY=PASS"
  echo "NOTE: count parity is necessary, not sufficient — it proves the dump is current w.r.t. the five evidence tables; it does not prove row-content equality."
}

case "${1:-}" in
  capture) shift; do_capture "$@" ;;
  compare) shift; do_compare "$@" ;;
  *) usage ;;
esac
