const fs = require('fs');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/update-version.cjs <version>');
  process.exit(1);
}

const files = ['package.json', 'src-tauri/tauri.conf.json'];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const updated = content.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
  fs.writeFileSync(file, updated);
  console.log(`Updated ${file} to ${version}`);
});
