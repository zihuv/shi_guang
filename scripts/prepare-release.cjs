const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/prepare-release.cjs <version>');
  process.exit(1);
}

// 1. Update version in package files
const files = ['package.json', 'src-tauri/tauri.conf.json'];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const updated = content.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
  fs.writeFileSync(file, updated);
  console.log(`✅ Updated ${file} to ${version}`);
});

// 2. Generate release body from template
const templatePath = path.join(process.env.GITHUB_WORKSPACE || '.', '.github/release_template.md');
const outputFile = process.env.GITHUB_OUTPUT;

if (fs.existsSync(templatePath)) {
  try {
    const template = fs.readFileSync(templatePath, 'utf8');
    const content = template.replace(/VERSION/g, version);
    
    if (outputFile) {
      // Running in GitHub Actions
      const delimiter = 'EOF_' + Math.random().toString(36).substring(7);
      fs.appendFileSync(outputFile, `body<<${delimiter}\n`);
      fs.appendFileSync(outputFile, `${content}\n`);
      fs.appendFileSync(outputFile, `${delimiter}\n`);
      console.log('✅ Generated release body for GitHub output');
    } else {
      // Running locally, just print the content
      console.log('\n📝 Release body template:');
      console.log('-------------------');
      console.log(content);
      console.log('-------------------');
    }
  } catch (error) {
    console.error('❌ Error generating release body:', error.message);
    process.exit(1);
  }
} else {
  console.warn('⚠️ Release template not found, skipping body generation');
}