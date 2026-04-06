const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const VERSION_FILES = ["package.json", "src-tauri/tauri.conf.json"];

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
  console.log(`Usage: pnpm release <version> [--dry-run] [--no-push]

Examples:
  pnpm release 0.1.2
  pnpm release 0.1.2 --dry-run
  pnpm release 0.1.2 --no-push`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("");
    const error = new Error(
      output.trim() || `Command failed: ${command} ${args.join(" ")}`,
    );
    error.status = result.status;
    throw error;
  }

  return (result.stdout || "").trim();
}

function createGitRunner(repoRoot) {
  const safeDirectory = repoRoot.replace(/\\/g, "/");

  return (args, options) =>
    run("git", ["-c", `safe.directory=${safeDirectory}`, ...args], options);
}

function ensureValidVersion(version) {
  if (!version || !VERSION_PATTERN.test(version)) {
    throw new Error(
      `Invalid version: ${version || "<empty>"}\nExpected format like 0.1.0 or 0.1.0-beta.1`,
    );
  }
}

function ensureVersionsAligned(versionFiles) {
  const versions = versionFiles.map((file) => ({
    file,
    version: readJson(file).version,
  }));

  const firstVersion = versions[0]?.version;
  const mismatches = versions.filter(({ version }) => version !== firstVersion);

  if (mismatches.length > 0) {
    const detail = versions
      .map(({ file, version }) => `${file}: ${version}`)
      .join("\n");

    throw new Error(`Version files are out of sync.\n${detail}`);
  }

  return firstVersion;
}

function updateVersions(versionFiles, version) {
  for (const file of versionFiles) {
    const filePath = path.resolve(file);
    const parsed = readJson(filePath);
    parsed.version = version;
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  }
}

function ensureCleanWorktree(runGit) {
  const status = runGit(["status", "--short"]);

  if (status) {
    throw new Error(
      `Working tree is not clean. Commit or stash these changes first:\n${status}`,
    );
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
  console.log(`- update ${VERSION_FILES.join(", ")} to ${version}`);
  console.log(`- node scripts/prepare-release.cjs ${version}`);
  console.log(`- git add ${VERSION_FILES.join(" ")}`);
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

  updateVersions(VERSION_FILES, version);

  run(process.execPath, [path.join("scripts", "prepare-release.cjs"), version]);

  runGit(["add", ...VERSION_FILES]);
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
