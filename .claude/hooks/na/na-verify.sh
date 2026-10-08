#!/usr/bin/env bash
# never-again verify engine. Installed as .claude/hooks/na/na-verify.sh and
# sourced by every verify-shaped hook, which is a five-line stub:
#
#   ID="L017"
#   RULE="the test suite must pass before committing"
#   TRIGGER="commit"
#   source "$(dirname "${BASH_SOURCE[0]}")/na-verify.sh"
#
# The command, the watched files and the skipped directories live in the
# lesson's record in state.json:
#
#   "verify": { "run": "npm test --silent", "watch": [".ts", ".tsx"], "skip": ["dist"] }
#
# Behaviour:
#   fresh    nothing watched has changed since the check last passed -> silent
#   stale    something changed -> the command runs now; a pass is recorded
#            silently, a failure fires with the last lines of output
#   --run    run the command by hand and record a pass (bash L017.sh --run)
#
# It never asks "did you run it?": PreToolUse sees the tree from before the
# tool call, so a stamp written by another command would always look stale.
# Give the settings entry a "timeout" longer than the command takes.
#
# Files are listed by git (tracked plus untracked-not-ignored), so anything in
# .gitignore never counts. A pass is recorded in .claude/never-again/verified/,
# which is local to the machine. Under NA_DRY_RUN=1 the command still runs,
# because there is no other way to decide, but nothing is recorded or logged.

source "$(dirname "${BASH_SOURCE[0]}")/na-lib.sh"

: "${ID:?na-verify.sh: set ID before sourcing}"
: "${RULE:?na-verify.sh: set RULE before sourcing}"
TRIGGER="${TRIGGER:-commit}"

MANUAL=0
[ "${1:-}" = "--run" ] && MANUAL=1

if [ "$MANUAL" -eq 1 ]; then
  na_env || { echo "never-again $ID: no working python found" >&2; exit 1; }
  NA_ID="$ID"; NA_SOURCE="manual"
else
  na_begin "$ID" "$TRIGGER"
fi

HELPER="$NA_ROOT/.claude/hooks/na/na-manifest.py"

# One spawn reads the config and compares the tree.
RES="$("$NA_PY" "$HELPER" check "$NA_ROOT" "$NA_STATE" "$ID" 2>&1)"; RC=$?
RES="${RES//$'\r'/}"
V_RUN="$(printf '%s\n' "$RES" | sed -n 's/^RUN=//p' | head -1)"
NA_MODE="$(printf '%s\n' "$RES" | sed -n 's/^MODE=//p' | head -1)"

if [ "$RC" -ge 2 ]; then
  # Unconfigured, misconfigured, or the helper itself broke. A hook that
  # silently does nothing is the failure this project exists to prevent.
  ERR="$(printf '%s\n' "$RES" | sed -n 's/^ERROR=//p' | head -1)"
  na_notice "never-again $ID: ${ERR:-check failed (exit $RC)}. Fix the \"verify\" block in state.json."
fi

# Retired or unknown mode: nothing to enforce, and nothing to run.
case "$NA_MODE" in warn|block) ;; *) [ "$MANUAL" -eq 1 ] || exit 0 ;; esac

# Fresh, and not asked to run by hand: nothing to do.
[ "$RC" -eq 0 ] && [ "$MANUAL" -eq 0 ] && exit 0

# Under git, when Claude Code's PreToolUse hook already ran this check on this
# exact tree and asked, the person has answered: do not run it again. A
# different tree (they fixed something) never matches, so it is verified.
if [ "$MANUAL" -eq 0 ] && na_pending; then
  exit 0
fi

# Run the command. Output goes to a file so a chatty suite is never copied
# through a shell variable; the manual path streams it to the terminal.
TMP="$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/na-verify.$$")"
trap 'rm -f "$TMP"' EXIT
if [ "$MANUAL" -eq 1 ]; then
  (cd "$NA_ROOT" && bash -c "$V_RUN") 2>&1 | tee "$TMP"; PASS=${PIPESTATUS[0]}
else
  (cd "$NA_ROOT" && bash -c "$V_RUN") >"$TMP" 2>&1; PASS=$?
fi

if [ "$PASS" -eq 0 ]; then
  if [ -n "${NA_DRY_RUN:-}" ]; then
    [ "$MANUAL" -eq 1 ] && echo "never-again $ID: check passed (dry run, nothing recorded)."
    exit 0
  fi
  REC="$("$NA_PY" "$HELPER" commit "$NA_ROOT" "$NA_STATE" "$ID" 2>&1)"; RRC=$?
  REC="${REC//$'\r'/}"
  if [ "$RRC" -eq 0 ]; then
    [ "$MANUAL" -eq 1 ] && echo "never-again $ID: check passed, ${REC%%$'\n'*}."
    exit 0
  fi
  na_notice "never-again $ID: the check passed but the result could not be recorded (${REC#ERROR=}). It will run again next commit."
fi

if [ "$MANUAL" -eq 1 ]; then
  echo "never-again $ID: check failed, nothing recorded." >&2
  exit 1
fi
DETAIL="$(grep -v '^$' "$TMP" | tail -4 | tr '\n' ';' | cut -c1-300)"
na_fire "$RULE  [$V_RUN failed: $DETAIL]"
