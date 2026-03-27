const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");

const filesToUpdate = [
  "package.json",
  "src-tauri/tauri.conf.json",
];

function isValidVersion(version) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

async function resolveVersion() {
  const argVersion = process.argv[2]?.trim();

  if (argVersion) {
    return argVersion;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const answer = await rl.question("Input release version: ");
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const version = await resolveVersion();

  if (!isValidVersion(version)) {
    console.error(`Invalid version: ${version || "<empty>"}`);
    console.error("Expected format like 0.1.0 or 0.1.0-beta.1");
    process.exit(1);
  }

  for (const file of filesToUpdate) {
    const filePath = path.resolve(file);
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content);
    parsed.version = version;
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
    console.log(`Updated ${file} -> ${version}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
