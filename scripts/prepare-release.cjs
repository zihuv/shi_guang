const fs = require("fs");
const path = require("path");

const version = process.argv[2]?.trim();

if (!version) {
  console.error("Usage: node scripts/prepare-release.cjs <version>");
  process.exit(1);
}

const filesToValidate = [
  "package.json",
  "extensions/shiguang-collector/manifest.json",
];

const mismatches = [];

for (const file of filesToValidate) {
  const content = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(content);

  if (parsed.version !== version) {
    mismatches.push(`${file}: expected ${version}, found ${parsed.version}`);
  }
}

if (mismatches.length > 0) {
  console.error("Release version validation failed.");
  console.error("Commit the version bump before running the release workflow:");
  mismatches.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

const templatePath = path.join(
  process.env.GITHUB_WORKSPACE || ".",
  ".github/release_template.md",
);
const outputFile = process.env.GITHUB_OUTPUT;

let body = `See the assets to download version ${version}.`;

if (fs.existsSync(templatePath)) {
  body = fs.readFileSync(templatePath, "utf8").replace(/VERSION/g, version);
} else {
  console.warn("Release template not found, using default release body.");
}

if (outputFile) {
  const delimiter = `EOF_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(outputFile, `version=${version}\n`);
  fs.appendFileSync(outputFile, `body<<${delimiter}\n`);
  fs.appendFileSync(outputFile, `${body}\n`);
  fs.appendFileSync(outputFile, `${delimiter}\n`);
  console.log(`Prepared release metadata for ${version}`);
} else {
  console.log(`Validated release version ${version}`);
  console.log("");
  console.log(body);
}
