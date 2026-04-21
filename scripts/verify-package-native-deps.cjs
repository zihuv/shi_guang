const fs = require("fs");
const path = require("path");

const runnerOs = (process.argv[2] || process.platform).toLowerCase();
const releaseDir = path.resolve(process.argv[3] || "release");

const platform =
  runnerOs === "windows" || runnerOs === "win32"
    ? "win32"
    : runnerOs === "macos" || runnerOs === "darwin"
      ? "darwin"
      : runnerOs === "linux"
        ? "linux"
        : null;

if (!platform) {
  throw new Error(`Unsupported runner OS: ${process.argv[2] || process.platform}`);
}

const checks = {
  win32: {
    label: "Windows DirectML",
    required: [
      "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node",
      "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime.dll",
      "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/DirectML.dll",
      "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/dxcompiler.dll",
      "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/dxil.dll",
    ],
    binaryTokens: [
      {
        file: "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node",
        token: "dml",
      },
    ],
  },
  darwin: {
    label: "macOS CoreML",
    required: [
      "node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node",
      "node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/libonnxruntime.1.24.3.dylib",
    ],
    binaryTokens: [
      {
        file: "node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node",
        token: "coreml",
      },
    ],
  },
  linux: {
    label: "Linux ONNX Runtime",
    required: [
      "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node",
      "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1",
    ],
    binaryTokens: [],
  },
};

function walk(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      callback(fullPath, entry);
      walk(fullPath, callback);
    }
  }
}

function findUnpackedDirs(root) {
  if (!fs.existsSync(root)) {
    throw new Error(`Release directory does not exist: ${root}`);
  }

  const dirs = [];
  walk(root, (entryPath, entry) => {
    if (entry.isDirectory() && entry.name === "app.asar.unpacked") {
      dirs.push(entryPath);
    }
  });
  return dirs;
}

function resolvePackagedFile(unpackedDirs, relativePath) {
  const normalized = relativePath.split("/").join(path.sep);
  for (const unpackedDir of unpackedDirs) {
    const candidate = path.join(unpackedDir, normalized);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function assertBinaryToken(filePath, token) {
  const needle = Buffer.from(token);
  const haystack = fs.readFileSync(filePath);
  if (haystack.indexOf(needle) === -1) {
    throw new Error(`Expected ${filePath} to contain marker "${token}".`);
  }
}

const unpackedDirs = findUnpackedDirs(releaseDir);
if (unpackedDirs.length === 0) {
  throw new Error(`No app.asar.unpacked directory found under ${releaseDir}.`);
}

const check = checks[platform];
const missing = [];
for (const requiredFile of check.required) {
  if (!resolvePackagedFile(unpackedDirs, requiredFile)) {
    missing.push(requiredFile);
  }
}

if (missing.length > 0) {
  throw new Error(
    `Missing packaged ${check.label} files:\n${missing.map((file) => `- ${file}`).join("\n")}`,
  );
}

for (const { file, token } of check.binaryTokens) {
  const packagedFile = resolvePackagedFile(unpackedDirs, file);
  assertBinaryToken(packagedFile, token);
}

console.log(`Verified packaged native dependencies for ${check.label}.`);
