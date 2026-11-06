'use strict';

// Read-only validator: no network, no pipeline changes and no output files.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BANKS, BASELINE_COMMIT, createManifest, validateManifest, validateTransition } = require('./manifest.js');
const root = path.resolve(__dirname, '../..');

function main() {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/question-identity/check-manifests.js');
  for (const config of BANKS) {
    const bytes = fs.readFileSync(path.join(root, config.path));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/question-identity', `krok${config.krok}-main.manifest.json`), 'utf8'));
    const baseline = execFileSync('git', ['show', `${BASELINE_COMMIT}:${config.path}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    const summary = validateManifest(manifest, bytes);
    // Comparing with the independent committed bank also catches simultaneous
    // edits to a bank and its manifest. Future changes need a separate review.
    validateTransition(createManifest(config, baseline), manifest);
    console.log(JSON.stringify({ bank: config.path, ...summary, duplicateContentPolicy: 'informational_only' }));
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
