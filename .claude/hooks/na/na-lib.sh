#!/usr/bin/env bash
# never-again shared hook library. Installed at .claude/hooks/na/na-lib.sh and
# sourced by every hook, so the parts that are easy to get wrong live once.
#
#   source "$(dirname "$0")/na-lib.sh"
#   na_begin "L017" "commit"        # id, trigger
#   ... set VIOLATION=1 and a reason ...
#   na_fire "$REASON"               # or: exit 0
#
# Two ways a hook gets run, one code path:
#   Claude Code   PreToolUse, JSON payload on stdin, JSON decision on stdout.
#   git           pre-commit via .claude/hooks/na/pre-commit, NA_EVENT=git,
#                 no stdin; warn prints to stderr and allows, block exits 1.
#
# Environment:
#   NA_PYTHON     interpreter to use instead of probing python3/python/py
#   NA_EVENT      "git" when run from the git pre-commit runner
#   NA_DRY_RUN=1  decide, but write nothing to fires.log (for self-tests)

# Every Python this library spawns prints through a pipe. On Windows that
# pipe is cp1252 by default, and a commit message with an emoji in it made the
# command extractor crash, so the hook saw an empty command and went blind.
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1

# Resolve a Python that actually runs. On Windows `command -v python3` finds
# the Microsoft Store stub, which exists, is on PATH, and exits 49 having run
# nothing. Existence is never the test; running a statement is.
na_python() {
  local c
  for c in "${NA_PYTHON:-}" python3 python py; do
    [ -n "$c" ] || continue
    if "$c" -c 'import sys' >/dev/null 2>&1; then
      command -v "$c"
      return 0
    fi
  done
  return 1
}

# na_native_path PATH — Git Bash reports /c/Users/...; Python and Node on
# Windows cannot open that. Return a path every runtime here understands.
na_native_path() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) command -v cygpath >/dev/null 2>&1 && cygpath -m "$1" && return 0 ;;
  esac
  printf '%s\n' "$1"
}

# na_env — the environment every hook needs: NA_ROOT, NA_STATE, NA_CLI,
# NA_SOURCE and NA_PY. Returns 1 when no interpreter runs. na_begin calls
# this; a hook that runs without a payload (a manual --run) calls it directly.
# na_payload_vars PAYLOAD — the fields every runner's payload carries, as
# shell assignments to eval: NA_CMD, NA_FILE, NA_TOOL_USE_ID, NA_CWD,
# NA_AGENT and NA_ERROR (what a failed call said; empty otherwise). Claude
# Code, Codex, Gemini CLI, Copilot and Antigravity all hand a hook one JSON
# object on stdin; only the field names differ. This is the one place that
# knows them. NA_AGENT is kept when already set (the registered
# entry passes --agent) and guessed from the shape otherwise.
na_payload_vars() {
  printf '%s' "$1" | "${NA_PY:-python3}" -c '
import json, sys, shlex
agent = sys.argv[1]
try:
    # PowerShell 5.1 puts a byte-order mark in front of what it pipes.
    d = json.loads(sys.stdin.read().lstrip("\ufeff"))
except Exception:
    d = {}
if not isinstance(d, dict):
    d = {}
ti = d.get("tool_input")
if not isinstance(ti, dict):
    ti = d.get("toolArgs")
if not isinstance(ti, dict):
    tc = d.get("toolCall")
    ti = tc.get("args") if isinstance(tc, dict) else None
if not isinstance(ti, dict):
    ti = {}
def first(m, keys):
    for k in keys:
        v = m.get(k)
        if isinstance(v, str) and v:
            return v
    return ""
if not agent:
    if "toolCall" in d:
        agent = "antigravity"
    elif "toolName" in d or "toolArgs" in d:
        agent = "copilot"
    elif d.get("tool_name") == "run_shell_command":
        agent = "gemini"
    elif "turn_id" in d and "tool_use_id" not in d:
        agent = "codex"
    else:
        agent = "claude"
print("NA_CMD=%s" % shlex.quote(first(ti, ("command", "CommandLine", "cmd"))))
print("NA_FILE=%s" % shlex.quote(first(ti, ("file_path", "path", "filePath", "AbsolutePath", "TargetFile"))))
print("NA_TOOL_USE_ID=%s" % shlex.quote(first(d, ("tool_use_id", "toolCallId", "turn_id"))))
# Antigravity puts the working directory inside the tool arguments.
print("NA_CWD=%s" % shlex.quote(first(d, ("cwd",)) or first(ti, ("Cwd",))))
print("NA_AGENT=%s" % shlex.quote(agent))
# After a failed call (PostToolUseFailure) the error is a string at the top;
# after one that ran, the response may carry stderr. Bounded: it becomes one
# argument on a command line, and a stack trace can run to a megabyte.
tr = d.get("tool_response")
err = first(d, ("error",)) or (tr if isinstance(tr, str) else "") \
      or (first(tr, ("error", "stderr")) if isinstance(tr, dict) else "")
print("NA_ERROR=%s" % shlex.quote(err[:2000]))
' "${NA_AGENT:-}" 2>/dev/null || printf 'NA_CMD=""; NA_FILE=""; NA_TOOL_USE_ID=""; NA_CWD=""; NA_AGENT=%s; NA_ERROR=""\n' "${NA_AGENT:-claude}"
}

# na_root_from CWD — only Claude Code sets CLAUDE_PROJECT_DIR. Every other
# runner says where it is in the payload; the repo is that directory's git
# top level. Sets the variable the rest of the code already reads.
na_root_from() {
  [ -n "${CLAUDE_PROJECT_DIR:-}" ] && return 0
  [ -n "$1" ] && [ -d "$1" ] || return 0
  CLAUDE_PROJECT_DIR="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$1")"
  export CLAUDE_PROJECT_DIR
}

na_env() {
  NA_ROOT="$(na_native_path "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}")"
  NA_STATE="$NA_ROOT/.claude/never-again/state.json"
  NA_CLI="$NA_ROOT/.claude/never-again/na"
  NA_SOURCE="claude"
  [ "${NA_EVENT:-}" = "git" ] && NA_SOURCE="git"
  # A runner that already resolved the interpreter (pre-commit exports NA_PY)
  # goes through the same probe as NA_PYTHON, so there is one definition of
  # "works".
  NA_PY="$(NA_PYTHON="${NA_PY:-${NA_PYTHON:-}}" na_python)"
}

# na_begin ID TRIGGER
# Sets NA_ID plus everything na_env sets, then NA_CMD, NA_FILE, NA_TOOL_USE_ID.
# Exits 0 (silently, never blocking) when this hook has nothing to do: the
# command is not the trigger, or no interpreter is available.
na_begin() {
  NA_ID="$1"
  NA_TRIGGER="${2:-commit}"
  if ! na_env; then
    if [ "$NA_SOURCE" = "git" ]; then
      echo "never-again: no working python found; hook $NA_ID did not run. Install Python 3.7+ or set NA_PYTHON." >&2
    else
      # No interpreter to build JSON with, so hand-write it. The call proceeds,
      # but a silently dead hook is the failure this project exists to prevent.
      printf '{"systemMessage":"never-again: no working python found; hook %s did not run. Install Python 3.7+ or set NA_PYTHON."}\n' "$NA_ID"
    fi
    exit 0
  fi

  # A sweep (`na sweep L017`, or NA_ALL=1 by hand): the check runs over every
  # file in the tree instead of a commit's files, prints what it finds, and
  # records nothing. A hook only ever looks at what a commit changes, so
  # whatever was in the tree before the hook existed stays there until it
  # is swept once.
  if [ -n "${NA_ALL:-}" ]; then
    NA_SOURCE="manual"; NA_DRY_RUN=1; export NA_DRY_RUN
    NA_CMD=""; NA_FILE=""; NA_TOOL_USE_ID=""
    return 0
  fi

  # Under the dispatcher the payload was parsed once and exported; there is
  # no stdin to read and nothing to decide.
  if [ -n "${NA_DISPATCHED:-}" ]; then
    NA_CMD="${NA_CMD:-}"; NA_FILE="${NA_FILE:-}"; NA_TOOL_USE_ID="${NA_TOOL_USE_ID:-}"
    return 0
  fi
  NA_CMD=""; NA_FILE=""; NA_TOOL_USE_ID=""
  if [ "$NA_SOURCE" = "claude" ]; then
    NA_PAYLOAD="$(cat)"
    eval "$(na_payload_vars "$NA_PAYLOAD")"
    # No `if` filter on the entry: the command text is the gate. Decide
    # properly: a commit is a `git ... commit` segment, not the substring.
    if [ "$NA_TRIGGER" = "commit" ] && ! na_is_commit "$NA_CMD"; then
      exit 0
    fi
  fi
}

# na_is_commit CMD — true when CMD contains a git commit as a command segment.
# Accepts global options between git and commit (-C dir, -c k=v, --no-pager),
# extra whitespace, and chaining (&&, ;, |). Text inside quotes is ignored:
# an echo of a payload that mentions "git commit" is not a commit. A commit
# genuinely hidden inside quotes (sh -c "git commit") still meets the git
# pre-commit runner, which sees every real commit.
na_is_commit() {
  local cmd="$1" re
  cmd="$(printf '%s' "$cmd" | sed -e 's/\\["'"'"']//g' -e "s/'[^']*'/''/g" -e 's/"[^"]*"/""/g')"
  re='(^|[;&|(]|then |do |exec |sudo )[[:space:]]*git([[:space:]]+(-[cC][[:space:]]+[^[:space:]]+|--?[A-Za-z-]+(=[^[:space:]]+)?))*[[:space:]]+commit([[:space:]]|$)'
  [[ "$cmd" =~ $re ]]
}

# na_is_chain CMD — true when CMD runs more than one command (&&, ||, ;, |).
# PreToolUse sees the repository before any of them run, so a check about
# repository state (the current branch, what is staged) can be wrong for a
# chain such as `git checkout -b fix && git commit`. Such a check should
# return 0 under Claude Code for a chain and let the git runner, which sees
# the state at commit time, decide.
na_is_chain() {
  local cmd
  cmd="$(printf '%s' "$1" | sed -e 's/\\["'"'"']//g' -e "s/'[^']*'/''/g" -e 's/"[^"]*"/""/g')"
  [[ "$cmd" =~ (\&\&|\|\||;|\|) ]]
}

# na_changed_files [ext ...] — the files a commit could carry, one per line.
# From git: what is staged. From Claude Code: everything different from HEAD,
# staged or not, because `git add -A && git commit` is one tool call and at
# PreToolUse time nothing is staged yet. Never the whole tree, except under
# a sweep (NA_ALL), which is the one time the whole tree is the question.
na_changed_files() {
  local list
  if [ -n "${NA_ALL:-}" ]; then
    list="$(git -C "$NA_ROOT" ls-files -co --exclude-standard 2>/dev/null)"
  elif [ -n "${NA_CHANGED_ALL+x}" ]; then
    list="$NA_CHANGED_ALL"              # the dispatcher listed them once
  elif [ "$NA_SOURCE" = "git" ]; then
    list="$(git -C "$NA_ROOT" diff --cached --name-only --diff-filter=ACMR 2>/dev/null)"
  else
    list="$(git -C "$NA_ROOT" status --porcelain=v1 -uall 2>/dev/null \
      | awk '$1 !~ /D/ { sub(/^.. /, ""); sub(/.* -> /, ""); print }')"
  fi
  [ -z "$list" ] && return 0
  if [ $# -eq 0 ]; then printf '%s\n' "$list"; return 0; fi
  local ext pat=""
  for ext in "$@"; do pat="${pat:+$pat|}${ext//./\\.}"; done
  printf '%s\n' "$list" | grep -E "($pat)\$" || true
}

# na_lesson_field FIELD [DEFAULT] — one top-level field of this lesson's
# record in state.json, or DEFAULT when the file, the lesson or the field is
# missing. The one place hooks read their own record from.
na_lesson_field() {
  local v
  v="$("$NA_PY" -c 'import json,sys
try:
    x = json.load(open(sys.argv[1], encoding="utf-8"))["lessons"][sys.argv[2]][sys.argv[3]]
    print(x if isinstance(x, str) else json.dumps(x))
except Exception:
    print(sys.argv[4])' "$NA_STATE" "$NA_ID" "$1" "${2:-}" 2>/dev/null)" || v="${2:-}"
  printf '%s' "$v"
}

# na_mode — the hook's mode from state.json: warn, block, or retired. Under
# the dispatcher every mode arrived in NA_MODES ("L001=warn;L002=block;").
na_mode() {
  if [ -n "${NA_MODES:-}" ]; then
    local all=";$NA_MODES" m
    case "$all" in
      *";$NA_ID="*) m="${all#*;$NA_ID=}"; m="${m%%;*}"; printf '%s' "$m"; return 0 ;;
    esac
  fi
  na_lesson_field mode warn
}

# na_notice MSG — something the person must see that is not a fire: the hook
# is misconfigured, or a pass could not be recorded. Never blocks a commit.
# By hand: stderr and exit 1. From git: stderr and exit 0. From Claude Code:
# a systemMessage and exit 0.
na_notice() {
  case "${NA_SOURCE:-claude}" in
    manual) echo "$1" >&2; exit 1 ;;
    git)    echo "$1" >&2; exit 0 ;;
    *)      "$NA_PY" -c 'import json,sys; print(json.dumps({"systemMessage": sys.argv[1]}))' "$1"; exit 0 ;;
  esac
}

# na_pending — under git, after Claude Code's PreToolUse hook already asked
# about this same commit of this same tree: the person has answered. Records
# that they went ahead and returns 0, so the caller can stay quiet instead of
# asking twice. A different tree never matches: a decline followed by a fix is
# a new commit and gets verified. The answer is computed once per process.
na_pending() {
  [ "$NA_SOURCE" = "git" ] || return 1
  if [ -z "${NA_PENDING_RESULT:-}" ]; then
    NA_PENDING_RESULT=1
    if [ -z "${NA_DRY_RUN:-}" ] && [ -f "$NA_CLI" ] \
       && "$NA_PY" "$NA_CLI" _proceeded --id "$NA_ID" --if-pending --same-tree >/dev/null 2>&1; then
      NA_PENDING_RESULT=0
    fi
  fi
  return "$NA_PENDING_RESULT"
}

# na_fire REASON — the mistake is about to happen. Records the fire and emits
# the decision for whichever runner we are under, then exits.
na_fire() {
  local reason="$1" mode decision label
  mode="${NA_MODE:-$(na_mode)}"
  # A hook that asks a question rather than guarding the tree sets NA_LABEL
  # (the capture check says "asks"); the library knows no hook by name.
  case "$mode" in
    warn)  decision="ask";  label="${NA_LABEL:-would block}" ;;
    block) decision="deny"; label="blocked" ;;
    *)     exit 0 ;;   # retired or unknown: silent
  esac

  # A sweep: say what is in the tree and exit 1, so a script can tell. Nothing
  # is recorded; a sweep is not a fire.
  if [ "$NA_SOURCE" = "manual" ]; then
    echo "never-again $NA_ID in the tree: $reason" >&2
    exit 1
  fi

  if [ "$NA_SOURCE" = "git" ]; then
    # The git runner is the second look at a commit Claude Code already asked
    # about; record the answer and stay quiet rather than warn twice.
    na_pending && exit 0
    if [ -z "${NA_DRY_RUN:-}" ] && [ -f "$NA_CLI" ]; then
      "$NA_PY" "$NA_CLI" _fired "$NA_ID" "$mode" git "" >/dev/null 2>&1
    fi
    echo "never-again $NA_ID $label: $reason" >&2
    [ "$mode" = "block" ] && exit 1
    exit 0
  fi

  if [ -z "${NA_DRY_RUN:-}" ] && [ -f "$NA_CLI" ]; then
    "$NA_PY" "$NA_CLI" _fired "$NA_ID" "$mode" "${NA_AGENT:-claude}" "$NA_TOOL_USE_ID" >/dev/null 2>&1
  fi

  # In warn mode the prompt goes to the person. Under auto mode the harness
  # answers it and nobody sees anything: the first field report found both
  # of its fires a day later in the log. So a warn also carries a
  # systemMessage, which the model reads whatever the mode, and can act on.
  "$NA_PY" -c '
import json, sys
out = {"hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": sys.argv[1],
    "permissionDecisionReason": sys.argv[2]}}
if sys.argv[1] == "ask":
    out["systemMessage"] = sys.argv[2] + " (warn mode: if this prompt was answered for you, stop and check before going on)"
print(json.dumps(out))
' "$decision" "never-again $NA_ID $label: $reason"
  exit 0
}
