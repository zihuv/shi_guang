const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { moveUnreleasedToVersion } = require("./changelog.cjs");

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:\.\d+)?$/;
const CHANGELOG_FILE = "docs/CHANGELOG.md";
const PACKAGE_JSON_FILE = "package.json";
const PACKAGE_LOCK_FILE = "package-lock.json";
const EXTENSION_MANIFEST_FILE = "extensions/shiguang-collector/manifest.json";
const VERSION_FILES = [PACKAGE_JSON_FILE, PACKAGE_LOCK_FILE, EXTENSION_MANIFEST_FILE];

function parseArgs(argv) {
  const flags = new Set();
  let version;

  for (const arg of argv) {
    if (arg.startsWith("--")) {
      flags.add(arg);
      continue;
    }

    if (version) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    version = arg.trim();
  }

  return {
    version,
    dryRun: flags.has("--dry-run"),
    noPush: flags.has("--no-push"),
    help: flags.has("--help"),
  };
}

function showHelp() {
  console.log(`Usage: npm run release -- <version> [--dry-run] [--no-push]

Examples:
  npm run release -- 0.1.2
  npm run release -- 0.1.2 --dry-run
  npm run release -- 0.1.2 --no-push`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("");
    const error = new Error(output.trim() || `Command failed: ${command} ${args.join(" ")}`);
    error.status = result.status;
    throw error;
  }

  return (result.stdout || "").trim();
}

function createGitRunner(repoRoot) {
  const safeDirectory = repoRoot.replace(/\\/g, "/");

  return (args, options) => run("git", ["-c", `safe.directory=${safeDirectory}`, ...args], options);
}

function ensureValidVersion(version) {
  if (!version || !VERSION_PATTERN.test(version)) {
    throw new Error(
      `Invalid version: ${version || "<empty>"}\nExpected a numeric version like 0.1.0 or 0.1.0.1 because the browser extension manifest is released together with the app.`,
    );
  }
}

function ensureVersionsAligned(versionFiles) {
  const versions = versionFiles.map((file) => ({
    file,
    version: readVersion(file),
  }));

  const firstVersion = versions[0]?.version;
  const mismatches = versions.filter(({ version }) => version !== firstVersion);

  if (mismatches.length > 0) {
    const detail = versions.map(({ file, version }) => `${file}: ${version}`).join("\n");

    throw new Error(`Version files are out of sync.\n${detail}`);
  }

  return firstVersion;
}

function readVersion(file) {
  const parsed = readJson(file);

  if (file === PACKAGE_LOCK_FILE) {
    const rootVersion = parsed.packages?.[""]?.version;
    if (rootVersion && rootVersion !== parsed.version) {
      throw new Error(
        `${PACKAGE_LOCK_FILE} version mismatch: root package is ${rootVersion}, top-level version is ${parsed.version}`,
      );
    }
  }

  return parsed.version;
}

function updateJsonVersion(file, version) {
  const filePath = path.resolve(file);
  const content = fs.readFileSync(filePath, "utf8");

  const updated = content.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${version}$3`);

  if (file === PACKAGE_LOCK_FILE) {
    const parsed = JSON.parse(content);
    if (parsed.packages?.[""]) {
      parsed.packages[""].version = version;
      fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
      return;
    }
  }

  fs.writeFileSync(filePath, updated);
}

function updateVersions(version) {
  run(npmCommand(), ["version", version, "--no-git-tag-version"], {
    stdio: "pipe",
  });

  for (const file of [EXTENSION_MANIFEST_FILE]) {
    updateJsonVersion(file, version);
  }
}

function releaseDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce((result, part) => {
      if (part.type !== "literal") {
        result[part.type] = part.value;
      }
      return result;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function updateChangelog(version) {
  const changelogPath = path.resolve(CHANGELOG_FILE);
  const changelog = fs.readFileSync(changelogPath, "utf8");
  fs.writeFileSync(changelogPath, moveUnreleasedToVersion(changelog, version, releaseDate()));
}

function ensureCleanWorktree(runGit) {
  const status = runGit(["status", "--short"]);

  if (status) {
    throw new Error(`Working tree is not clean. Commit or stash these changes first:\n${status}`);
  }
}

function ensureTagDoesNotExist(runGit, version) {
  const existing = runGit(["tag", "--list", version]);

  if (existing) {
    throw new Error(`Git tag already exists: ${version}`);
  }
}

function ensureUpstreamExists(runGit) {
  try {
    runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    throw new Error(
      "Current branch has no upstream branch. Use --no-push or configure upstream first.",
    );
  }
}

function printPlan(version, noPush) {
  const commitMessage = `${version}`;

  console.log("Release plan:");
  console.log(
    `- npm version ${version} --no-git-tag-version to update ${PACKAGE_JSON_FILE} and ${PACKAGE_LOCK_FILE}`,
  );
  console.log(`- update ${EXTENSION_MANIFEST_FILE} to ${version}`);
  console.log(`- move ${CHANGELOG_FILE} Unreleased notes to ${version}`);
  console.log(`- node scripts/prepare-release.cjs ${version}`);
  console.log(`- git add ${VERSION_FILES.join(" ")} ${CHANGELOG_FILE}`);
  console.log(`- git commit -m "${commitMessage}"`);
  console.log(`- git tag -a ${version} -m "${commitMessage}"`);

  if (!noPush) {
    console.log("- git push --follow-tags");
  }
}

function main() {
  const { version, dryRun, noPush, help } = parseArgs(process.argv.slice(2));

  if (help) {
    showHelp();
    return;
  }

  ensureValidVersion(version);

  const repoRoot = path.resolve(process.cwd());
  const runGit = createGitRunner(repoRoot);
  const currentVersion = ensureVersionsAligned(VERSION_FILES);

  if (currentVersion === version) {
    throw new Error(`Version is already ${version}. Nothing to release.`);
  }

  ensureCleanWorktree(runGit);
  ensureTagDoesNotExist(runGit, version);

  if (!noPush) {
    ensureUpstreamExists(runGit);
  }

  if (dryRun) {
    printPlan(version, noPush);
    return;
  }

  const commitMessage = `${version}`;

  updateVersions(version);
  updateChangelog(version);

  run(process.execPath, [path.join("scripts", "prepare-release.cjs"), version]);

  runGit(["add", ...VERSION_FILES, CHANGELOG_FILE]);
  runGit(["commit", "-m", commitMessage]);

  runGit(["tag", "-a", version, "-m", commitMessage]);

  if (!noPush) {
    runGit(["push", "--follow-tags"]);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
