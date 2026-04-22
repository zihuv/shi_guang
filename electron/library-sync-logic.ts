import path from "node:path";

export type LibrarySyncChangeKind = "added" | "updated" | "removed" | "moved" | "skipped";

export interface LibrarySyncFileState {
  path: string;
  deletedAt?: string | null;
  missingAt?: string | null;
}

export function classifyExistingPathSync(
  existing: Pick<LibrarySyncFileState, "deletedAt" | "missingAt">,
  unchanged: boolean,
): LibrarySyncChangeKind {
  if (existing.deletedAt) {
    return "skipped";
  }
  if (!existing.missingAt && unchanged) {
    return "skipped";
  }
  return existing.missingAt ? "added" : "updated";
}

export function shouldUseMoveCandidate(
  candidate: LibrarySyncFileState | null,
  nextPath: string,
  candidatePathExists: boolean,
): boolean {
  if (!candidate) {
    return false;
  }
  if (path.resolve(candidate.path) === path.resolve(nextPath)) {
    return false;
  }
  return Boolean(candidate.missingAt) || !candidatePathExists;
}

export function shouldMarkMissing(args: {
  hasRecord: boolean;
  deletedAt?: string | null;
  missingAt?: string | null;
  existsOnDisk: boolean;
}): boolean {
  return Boolean(args.hasRecord && !args.deletedAt && !args.missingAt && !args.existsOnDisk);
}
