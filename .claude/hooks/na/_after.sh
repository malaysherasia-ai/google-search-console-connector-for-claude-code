#!/usr/bin/env bash
# never-again — runs after a tool call under Claude Code, or under Codex,
# Gemini CLI, Copilot or Antigravity with --agent NAME. Registered by
# `na _register` on the after-tool events (PostToolUse and
# PostToolUseFailure). Installed as .claude/hooks/na/_after.sh.
#
# Three things happen here, and nothing for any other call:
#   * a commit ran: a warn-mode hook cannot see what the person chose at the
#     prompt, but this can. If the tool call ran at all, the person went past
#     the warning; any fire still pending for this call is marked "proceeded".
#     A fire that never reaches here is settled as "declined" later.
#   * a call failed (PostToolUseFailure): one line in failures.log, the
#     command and the first line of what it said. The failed call is the
#     witness to a fix that no commit message can rewrite.
#   * a call passed while a failure was open: the same command passing after
#     the tree changed is a fix. One line in the log, one sentence back to
#     the agent while the error is still in front of it, and the commit-time
#     capture check asks about it whatever the message says.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/na-lib.sh"

NA_AGENT="${NA_AGENT:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) NA_AGENT="${2:-}"; shift ;;
    --agent=*) NA_AGENT="${1#--agent=}" ;;
  esac
  shift
done

NA_PAYLOAD="$(cat)"
# No `if` filter on the entry: leave before any interpreter starts unless
# there is something to do. A commit, a failed call, or a call that ran
# while a failure is open (one file test; the mark is kept by `na _passed`
# and removed once nothing is open, so the ordinary call costs nothing).
FAILED=0
case "$NA_PAYLOAD" in *PostToolUseFailure*) FAILED=1 ;; esac
case "$NA_PAYLOAD" in
  *commit*) ;;
  *) [ "$FAILED" -eq 1 ] || [ -f "${CLAUDE_PROJECT_DIR:-/nonexistent}/.claude/never-again/.failures-open" ] \
       || [ -f "${CLAUDE_PROJECT_DIR//\\//}/.claude/never-again/.failures-open" ] || exit 0 ;;   # Windows hands a backslash path
esac
NA_PY="$(na_python)" || exit 0
NA_CMD=""; NA_FILE=""; NA_TOOL_USE_ID=""; NA_CWD=""; NA_ERROR=""
eval "$(na_payload_vars "$NA_PAYLOAD")"
na_root_from "$NA_CWD"

NA_ROOT="$(na_native_path "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}")"
NA_CLI="$NA_ROOT/.claude/never-again/na"
[ -f "$NA_CLI" ] || exit 0

# Not a commit: the failure record. A failed call is written down; a call
# that passed is matched against the open failures. Only Claude Code has
# been seen sending the failure event; the other agents reach the record
# through the commit-time check, which reads the same file.
if [ -n "$NA_CMD" ] && ! na_is_commit "$NA_CMD"; then
  if [ "$FAILED" -eq 1 ]; then
    [ -n "${NA_DRY_RUN:-}" ] || "$NA_PY" "$NA_CLI" _failed --cmd "$NA_CMD" --error "$NA_ERROR" --tool-use-id "$NA_TOOL_USE_ID" >/dev/null 2>&1
    exit 0
  fi
  [ -f "$NA_ROOT/.claude/never-again/.failures-open" ] || exit 0   # nothing open: nothing to match
  # The answer comes back in the caller's dialect, or not at all.
  "$NA_PY" "$NA_CLI" _passed --cmd "$NA_CMD" --tool-use-id "$NA_TOOL_USE_ID" --agent "${NA_AGENT:-claude}" 2>/dev/null | tr -d '\r'
  exit 0
fi
# No command text and no commit in the payload: not a call this hook knows.
if [ -z "$NA_CMD" ]; then
  case "$NA_PAYLOAD" in *commit*) ;; *) exit 0 ;; esac
fi

if [ -n "$NA_TOOL_USE_ID" ]; then
  WENT="$("$NA_PY" "$NA_CLI" _proceeded --tool-use-id "$NA_TOOL_USE_ID" 2>/dev/null)"
else
  WENT="$("$NA_PY" "$NA_CLI" _proceeded 2>/dev/null)"
fi
WENT="${WENT//$'\r'/}"

# A warning that the commit went past counts for nothing until it is
# graded, and the agent that read the reason and made the diff is the one
# who can grade it, now, once. One line back; the skill says what to do
# with it. After a tool call only additionalContext reaches the model (a
# systemMessage goes to the person), so Claude Code and Codex get that;
# Gemini reads a systemMessage. Copilot has no channel after a tool, and
# Antigravity has never been seen running this. A commit that failed
# (this hook also runs on PostToolUseFailure) landed nothing to grade.
case "$NA_PAYLOAD" in *PostToolUseFailure*) WENT="" ;; esac
if [ -n "$WENT" ]; then
  IDS="$(printf '%s' "$WENT" | tr '\n' ' ')"; IDS="${IDS% }"
  MSG="never-again: $IDS warned and this commit went ahead. Grade it from the reason and the diff, once: .claude/never-again/na ok L### if the warning was right, na wrong L### if it was a false positive; leave it if unsure."
  case "${NA_AGENT:-claude}" in
    copilot|antigravity) ;;
    gemini) printf '{"systemMessage":"%s"}\n' "$MSG" ;;
    *) printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$MSG" ;;
  esac
fi

# The commit is done, so this is the one place a network request costs
# nobody a wait: at most once a day, ask GitHub for the newest release. The
# answer is cached; the next commit's dispatcher names it. Off with
# "updates": "off" in state.json.
[ -n "${NA_DRY_RUN:-}" ] || "$NA_PY" "$NA_CLI" _check-update >/dev/null 2>&1
exit 0
