#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

OUT_FILE="${CLAUDE_REVIEW_OUTPUT:-tmp/claude-review.md}"
MAX_TURNS="${CLAUDE_REVIEW_MAX_TURNS:-10}"
ALLOWED_TOOLS="Read,Bash(git status),Bash(git status *),Bash(git diff),Bash(git diff *),Bash(git log),Bash(git log *)"

mkdir -p "$(dirname "$OUT_FILE")"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI is not installed or not on PATH." >&2
  exit 127
fi

if [[ -z "$(git status --porcelain --untracked-files=normal)" ]]; then
  printf "NO_CHANGES_TO_REVIEW\n" | tee "$OUT_FILE"
  exit 0
fi

PROMPT=$(cat <<'PROMPT'
You are reviewing local, uncommitted changes in this repository.

Read REVIEW.md and AGENTS.md first. Review staged, unstaged, and untracked changes. Treat untracked files shown by git status as review targets and read them directly when needed. Use only read-only inspection and git read commands. Do not edit files, run formatters, install dependencies, start dev servers, or change git state.

Useful commands:
- git status --short
- git diff --stat
- git diff --cached --stat
- git diff
- git diff --cached
- git log --oneline -n 10

Follow REVIEW.md exactly. If there are no material findings, the entire response must be exactly one line: NO_ISSUES_FOUND. Do not wrap NO_ISSUES_FOUND in Markdown code fences.
PROMPT
)

args=(
  --bare
  -p "$PROMPT"
  --allowedTools "$ALLOWED_TOOLS"
  --output-format text
  --max-turns "$MAX_TURNS"
)

if [[ -n "${CLAUDE_REVIEW_MODEL:-}" ]]; then
  args+=(--model "$CLAUDE_REVIEW_MODEL")
fi

raw_output="$(NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}" claude "${args[@]}")"
normalized_output="$raw_output"
clean_output="$(printf "%s" "$raw_output" | tr -d '\r')"
last_non_empty_line="$(printf "%s\n" "$clean_output" | awk 'NF { line = $0 } END { print line }')"

if [[ "$clean_output" == "NO_ISSUES_FOUND" ||
  "$clean_output" == $'```text\nNO_ISSUES_FOUND\n```' ||
  "$clean_output" == $'```\nNO_ISSUES_FOUND\n```' ]] ||
  { [[ "$last_non_empty_line" == "NO_ISSUES_FOUND" ]] &&
    ! printf "%s\n" "$clean_output" | grep -Eq '^\[P[0-3]\]'; }; then
  normalized_output="NO_ISSUES_FOUND"
fi

printf "%s\n" "$normalized_output" | tee "$OUT_FILE"
