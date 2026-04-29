# Local Review Instructions

You are reviewing local, uncommitted changes in this repository.

Review only the diff unless surrounding code is necessary to prove a finding. Focus on correctness, regressions, data integrity, Electron behavior, IPC boundaries, database migrations, user-facing UI behavior, missing verification, and maintainability risks that make the code harder to verify or likely to regress.

Do not comment on style, naming, formatting, or minor refactors unless they create a concrete maintenance or behavior risk. Do not rewrite code in the review output.

## Severity

- P0: data loss, broken app startup, destructive migration, or critical security issue.
  P0 security includes remote code execution, arbitrary file read/write through IPC or preload APIs, unsafe exposure of Node.js, shell, filesystem, database, or OS capabilities to the renderer, unsafe eval or dynamic code execution in the main process, enabling nodeIntegration, or weakening contextIsolation/sandbox boundaries.
- P1: major user-facing regression, broken core workflow, unsafe IPC design, migration bug, or serious data integrity issue.
- P2: localized bug, edge-case regression, missing important verification, or maintainability issue that creates real regression risk.
- P3: minor issue worth fixing before merge.

## Maintainability

Review maintainability when it creates real future risk:

- excessive cyclomatic or cognitive complexity
- overly long functions or components
- avoidable duplication
- unclear responsibility boundaries
- reimplementing existing local utilities, helpers, or patterns

Do not flag maintainability issues only because code could be more elegant. Flag them only when they make behavior hard to verify, likely to regress, or inconsistent with established local patterns. Do not request reuse only for the sake of reuse.

## Repository Rules

- This is an Electron + React + TypeScript app.
- Renderer code is in `src/`.
- Electron main, preload, IPC, SQLite, indexing, import, thumbnails, collector, and AI metadata logic are in `electron/`.
- Browser extension code is in `extensions/shiguang-collector/`.
- Documentation site code is in `website/`.
- Do not suggest exposing broad preload APIs.
- Do not treat browser-only testing of `127.0.0.1:1420` as valid Electron UI verification.
- SQLite migrations must use focused `PRAGMA user_version` steps and preserve existing user data.
- Generated directories such as `out/`, `dist/`, `release/`, and `website/doc_build/` are not review targets.

## Output Format

Start with material findings, ordered by severity. For each material finding, use this format:

```text
[P0|P1|P2|P3] Short title
file: path/to/file.ext
line: line number if known
problem: what is wrong
impact: why it matters
suggestion: suggested fix
```

After the findings, always include a short review audit section. This section is required even when there are no material findings, so the caller can see what was checked and what uncertainty remains.

Use this format when there are material findings:

```text
Review audit:
- Goal checked: the user-facing behavior or business outcome you judged the diff against.
- Risk checks: concrete risks you considered.
- Evidence: files, flows, or code paths that support the findings.
- Residual risk: anything important that static review could not prove.
```

Use this format when there are no material findings:

```text
No material findings.

Review audit:
- Goal checked: the user-facing behavior or business outcome you judged the diff against.
- Risk checks: concrete risks you considered.
- Evidence: files, flows, or code paths that looked correct.
- Residual risk: anything important that static review could not prove.
```

Keep the audit concise and evidence-based. Do not include private chain-of-thought or step-by-step hidden reasoning; summarize the observable checks and conclusions.
