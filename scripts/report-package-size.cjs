const fs = require("fs");
const path = require("path");

const releaseDir = path.resolve(process.argv[2] || "release");

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

function sizeOf(targetPath) {
  const stat = fs.lstatSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  let total = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    total += sizeOf(path.join(targetPath, entry.name));
  }
  return total;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function walk(root, predicate, results = []) {
  if (!exists(root)) {
    return results;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (predicate(entryPath, entry)) {
      results.push(entryPath);
    }
    if (entry.isDirectory()) {
      walk(entryPath, predicate, results);
    }
  }
  return results;
}

function topLevelDirs(root, limit = 20) {
  if (!exists(root)) {
    return [];
  }

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const entryPath = path.join(root, entry.name);
      return {
        name: entry.name,
        size: sizeOf(entryPath),
      };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, limit);
}

function printSection(title) {
  console.log(`\n## ${title}`);
}

if (!exists(releaseDir)) {
  throw new Error(`Release directory does not exist: ${releaseDir}`);
}

printSection("Release files");
const releaseFiles = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => {
    const entryPath = path.join(releaseDir, entry.name);
    return {
      name: entry.name,
      size: sizeOf(entryPath),
    };
  })
  .sort((a, b) => b.size - a.size);

for (const file of releaseFiles) {
  console.log(`${formatBytes(file.size).padStart(10)}  ${file.name}`);
}

printSection("Packaged app internals");
const interestingPaths = [
  ...walk(releaseDir, (entryPath, entry) => entry.isDirectory() && entry.name.endsWith(".app")),
  ...walk(
    releaseDir,
    (entryPath, entry) => entry.isDirectory() && entry.name.endsWith("-unpacked"),
  ),
  ...walk(releaseDir, (entryPath, entry) => entry.isFile() && entry.name === "app.asar"),
  ...walk(
    releaseDir,
    (entryPath, entry) => entry.isDirectory() && entry.name === "app.asar.unpacked",
  ),
];

for (const entryPath of interestingPaths.sort()) {
  console.log(
    `${formatBytes(sizeOf(entryPath)).padStart(10)}  ${path.relative(releaseDir, entryPath)}`,
  );
}

printSection("Largest unpacked native modules");
const unpackedNodeModules = walk(
  releaseDir,
  (entryPath, entry) =>
    entry.isDirectory() && entry.name === "node_modules" && entryPath.includes("app.asar.unpacked"),
);

for (const nodeModulesDir of unpackedNodeModules) {
  console.log(`\n${path.relative(releaseDir, nodeModulesDir)}`);
  for (const item of topLevelDirs(nodeModulesDir, 20)) {
    console.log(`${formatBytes(item.size).padStart(10)}  ${item.name}`);
  }
}
