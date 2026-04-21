const H2_HEADING = /^## \[(.+?)\](?: - \d{4}-\d{2}-\d{2})?\s*$/;

function normalizeNewlines(markdown) {
  return markdown.replace(/\r\n/g, "\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMeaningfulReleaseNotes(notes) {
  return notes
    .split("\n")
    .some((line) => line.trim() && !line.trim().startsWith("### "));
}

function findH2Section(lines, matcher) {
  const start = lines.findIndex((line) => matcher(line));
  if (start === -1) {
    return null;
  }

  const end = lines.findIndex((line, index) => index > start && H2_HEADING.test(line));
  return {
    start,
    end: end === -1 ? lines.length : end,
    content: lines.slice(start + 1, end === -1 ? lines.length : end).join("\n").trim(),
  };
}

function getUnreleasedNotes(markdown) {
  const lines = normalizeNewlines(markdown).split("\n");
  return (
    findH2Section(lines, (line) => /^## \[Unreleased\]\s*$/.test(line))?.content ?? ""
  );
}

function getVersionNotes(markdown, version) {
  const escapedVersion = escapeRegExp(version);
  const versionHeading = new RegExp(`^## \\[${escapedVersion}\\](?: - \\d{4}-\\d{2}-\\d{2})?\\s*$`);
  const lines = normalizeNewlines(markdown).split("\n");
  return findH2Section(lines, (line) => versionHeading.test(line))?.content ?? "";
}

function moveUnreleasedToVersion(markdown, version, releaseDate) {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split("\n");

  if (getVersionNotes(normalized, version)) {
    throw new Error(`CHANGELOG already contains a section for ${version}.`);
  }

  const unreleased = findH2Section(lines, (line) => /^## \[Unreleased\]\s*$/.test(line));
  if (!unreleased) {
    throw new Error("CHANGELOG is missing the ## [Unreleased] section.");
  }

  const notes = unreleased.content;
  if (!isMeaningfulReleaseNotes(notes)) {
    throw new Error("CHANGELOG ## [Unreleased] does not contain release notes.");
  }

  const before = lines.slice(0, unreleased.start + 1).join("\n").trimEnd();
  const after = lines.slice(unreleased.end).join("\n").trimStart();

  let nextMarkdown = `${before}\n\n## [${version}] - ${releaseDate}\n\n${notes}`;
  if (after) {
    nextMarkdown += `\n\n${after}`;
  }

  return `${nextMarkdown.trimEnd()}\n`;
}

module.exports = {
  getUnreleasedNotes,
  getVersionNotes,
  isMeaningfulReleaseNotes,
  moveUnreleasedToVersion,
};
