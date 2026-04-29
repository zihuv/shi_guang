#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

OUT_FILE="${CLAUDE_REVIEW_OUTPUT:-tmp/claude-review.md}"

mkdir -p "$(dirname "$OUT_FILE")"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI is not installed or not on PATH." >&2
  exit 127
fi

PROMPT=$(cat <<'PROMPT'
You are reviewing local, uncommitted changes in this repository.

Read REVIEW.md and AGENTS.md first. Review staged, unstaged, and untracked changes. Treat untracked files shown by git status as review targets and read them directly when needed.

This is a read-only review. Do not edit files, run formatters, install dependencies, start dev servers, or change git state.

Follow REVIEW.md exactly. If there are no material findings, the entire response must be exactly one line: NO_ISSUES_FOUND. Do not wrap NO_ISSUES_FOUND in Markdown code fences.
PROMPT
)

args=(
  --bare
  -p "$PROMPT"
)

if [[ -n "${CLAUDE_REVIEW_MODEL:-}" ]]; then
  args+=(--model "$CLAUDE_REVIEW_MODEL")
fi

NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}" claude "${args[@]}" | tee "$OUT_FILE"
