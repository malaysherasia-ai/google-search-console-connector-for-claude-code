#!/usr/bin/env bash
# never-again verify-shaped hook: "X must pass before commit".
# Copy to .claude/hooks/na/<id>.sh, set ID and RULE, and put the command and
# the watched files in the lesson's "verify" block in state.json. Everything
# else is in na-verify.sh next to it. Run by hand: bash <id>.sh --run
ID="L000"
RULE="the check must pass before committing"
TRIGGER="commit"
WATCH=""                        # leave empty: the verify block's own watch list decides
source "$(dirname "${BASH_SOURCE[0]}")/na-verify.sh"
