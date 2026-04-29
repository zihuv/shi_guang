#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI is not installed or not on PATH." >&2
  exit 127
fi

BACKGROUND="${CLAUDE_REVIEW_BACKGROUND:-Codex has already made local changes for the current user request. The diff may include staged, unstaged, and untracked files. Review the user-facing goal, intended outcome, and changed code.}"

PROMPT=$(cat <<PROMPT
You are reviewing local, uncommitted changes in this repository.

Background:
$BACKGROUND

The background should describe the user problem, business context, and intended user-facing outcome. Treat implementation details in the diff as evidence to verify, not as the source of truth. Challenge whether the changed code actually satisfies the goal and whether it creates regressions in adjacent workflows.

Read REVIEW.md and AGENTS.md first. Review staged, unstaged, and untracked changes. Treat untracked files shown by git status as review targets and read them directly when needed.

This is a read-only review. Do not edit files, run formatters, install dependencies, start dev servers, or change git state.

Follow REVIEW.md exactly. Always include the required review audit section, even when there are no material findings.
PROMPT
)

args=(
  --bare
  -p "$PROMPT"
)

if [[ -n "${CLAUDE_REVIEW_MODEL:-}" ]]; then
  args+=(--model "$CLAUDE_REVIEW_MODEL")
fi

NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}" claude "${args[@]}"
