const fs = require("fs");
const path = require("path");

const archNames = {
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal",
};

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { force: true, recursive: true });
}

function readDirs(targetPath) {
  try {
    return fs
      .readdirSync(targetPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function walkDirs(root, predicate, results = []) {
  for (const entry of readDirs(root)) {
    const entryPath = path.join(root, entry);
    if (predicate(entryPath, entry)) {
      results.push(entryPath);
    }
    walkDirs(entryPath, predicate, results);
  }
  return results;
}

function findUnpackedNodeModules(appOutDir) {
  return walkDirs(
    appOutDir,
    (entryPath, entryName) =>
      entryName === "node_modules" && entryPath.includes(`app.asar.unpacked${path.sep}`),
  );
}

function currentTargets(platform, arch) {
  if (arch === "universal") {
    return platform === "darwin"
      ? [
          { platform: "darwin", arch: "arm64" },
          { platform: "darwin", arch: "x64" },
        ]
      : [{ platform, arch: "x64" }];
  }

  return [{ platform, arch }];
}

function keepOnnxRuntime(nodeModulesDir, platform, arch) {
  const napiDir = path.join(nodeModulesDir, "onnxruntime-node", "bin", "napi-v6");
  if (!exists(napiDir)) {
    return;
  }

  const keep = new Set(
    currentTargets(platform, arch).map((target) => `${target.platform}/${target.arch}`),
  );
  for (const platformName of readDirs(napiDir)) {
    const platformDir = path.join(napiDir, platformName);
    for (const archName of readDirs(platformDir)) {
      if (!keep.has(`${platformName}/${archName}`)) {
        removePath(path.join(platformDir, archName));
      }
    }
    if (readDirs(platformDir).length === 0) {
      removePath(platformDir);
    }
  }
}

function keepScopedPackages(scopeDir, keepNames) {
  if (!exists(scopeDir)) {
    return;
  }

  for (const packageName of readDirs(scopeDir)) {
    if (!keepNames.has(packageName)) {
      removePath(path.join(scopeDir, packageName));
    }
  }
}

function keepCanvasPackages(nodeModulesDir, platform, arch) {
  const keep = new Set(["canvas", "wasm-runtime"]);
  for (const target of currentTargets(platform, arch)) {
    if (target.platform === "darwin") {
      keep.add(`canvas-darwin-${target.arch}`);
    } else if (target.platform === "win32") {
      keep.add(`canvas-win32-${target.arch}-msvc`);
    } else if (target.platform === "linux") {
      keep.add(`canvas-linux-${target.arch}-gnu`);
    }
  }
  keepScopedPackages(path.join(nodeModulesDir, "@napi-rs"), keep);
}

function keepSharpPackages(nodeModulesDir, platform, arch) {
  const keep = new Set(["colour"]);
  for (const target of currentTargets(platform, arch)) {
    if (target.platform === "darwin") {
      keep.add(`sharp-darwin-${target.arch}`);
      keep.add(`sharp-libvips-darwin-${target.arch}`);
    } else if (target.platform === "win32") {
      keep.add(`sharp-win32-${target.arch}`);
    } else if (target.platform === "linux") {
      keep.add(`sharp-linux-${target.arch}`);
      keep.add(`sharp-libvips-linux-${target.arch}`);
    }
  }
  keepScopedPackages(path.join(nodeModulesDir, "@img"), keep);
}

function pruneBetterSqlite(nodeModulesDir) {
  const packageDir = path.join(nodeModulesDir, "better-sqlite3");
  removePath(path.join(packageDir, "deps"));
  removePath(path.join(packageDir, "src"));
  removePath(path.join(packageDir, "binding.gyp"));
}

module.exports = async function afterPackPrune(context) {
  const platform = context.electronPlatformName;
  const arch = archNames[context.arch] ?? String(context.arch);
  const nodeModulesDirs = findUnpackedNodeModules(context.appOutDir);

  for (const nodeModulesDir of nodeModulesDirs) {
    keepOnnxRuntime(nodeModulesDir, platform, arch);
    keepCanvasPackages(nodeModulesDir, platform, arch);
    keepSharpPackages(nodeModulesDir, platform, arch);
    pruneBetterSqlite(nodeModulesDir);
  }
};
