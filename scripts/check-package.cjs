'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const findings = [];
let files = 0;
const fileNames = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const file = path.join(directory, entry.name);
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (entry.isSymbolicLink()) { findings.push({ file: relative, issue: 'symlink' }); continue; }
    if (entry.isDirectory()) { walk(file); continue; }
    files++;
    fileNames.push(relative);
    if (/\.(?:exe|dll|node|png|jpg|zip|log|jsonl|info)$/i.test(entry.name) || /^(?:models|mcp)\.json$/i.test(entry.name) || /^\.env(?:\.|$)/.test(entry.name)) findings.push({ file: relative, issue: 'private_or_binary_file' });
    const text = fs.readFileSync(file, 'utf8');
    const patterns = [
      ['personal_windows_path', /[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[A-Za-z0-9_-]+/i],
      ['github_token', /(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,})/],
      ['jwt_literal', /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
      ['bearer_literal', /Bearer\s+[A-Za-z0-9_.~-]{25,}/i],
      ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ['credential_literal', /(?:accessToken|refreshToken|apiKey)\s*[:=]\s*['"][A-Za-z0-9_.-]{25,}['"]/],
    ];
    for (const [issue, pattern] of patterns) if (pattern.test(text)) findings.push({ file: relative, issue });
  }
}
walk(root);
const manifestFile = path.join(root, 'package-manifest.json');
if (fs.existsSync(manifestFile)) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const expected = Object.keys(manifest.files || {}).sort();
  const actual = fileNames.filter(name => name !== 'package-manifest.json').sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) findings.push({ file: 'package-manifest.json', issue: 'manifest_file_list_mismatch' });
  for (const name of actual) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
    if (manifest.files?.[name] !== digest) findings.push({ file: name, issue: 'manifest_hash_mismatch' });
  }
}
for (const required of ['SKILL.md', 'README.md', 'LICENSE', 'scripts/setup.ps1', 'scripts/manage.cjs']) if (!fs.existsSync(path.join(root, required))) findings.push({ file: required, issue: 'missing_required_file' });
console.log(JSON.stringify({ success: findings.length === 0, scope: 'bounded publication content scan; not a universal security guarantee', files, findings }, null, 2));
if (findings.length) process.exitCode = 1;
