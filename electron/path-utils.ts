import path from "node:path";

export function normalizePath(value: string): string {
  return path.normalize(value);
}

export function normalizePathForCompare(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function pathHasPrefix(candidate: string, prefix: string): boolean {
  const normalizedCandidate = normalizePathForCompare(candidate);
  const normalizedPrefix = normalizePathForCompare(prefix).replace(/\/+$/, "");
  return (
    normalizedCandidate === normalizedPrefix ||
    normalizedCandidate.startsWith(`${normalizedPrefix}/`)
  );
}

export function replacePathPrefix(candidate: string, oldPrefix: string, newPrefix: string) {
  if (!pathHasPrefix(candidate, oldPrefix)) {
    return null;
  }

  const relative = path.relative(oldPrefix, candidate);
  return path.join(newPrefix, relative);
}

export function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

export function isInsideAnyPath(candidate: string, roots: string[]): boolean {
  return roots.some((root) => pathHasPrefix(candidate, root));
}

export function normalizeFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("文件夹名称不能为空");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("文件夹名称不合法");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("文件夹名称不能包含斜杠");
  }
  return trimmed;
}
