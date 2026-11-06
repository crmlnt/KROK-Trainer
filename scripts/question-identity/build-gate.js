'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BANKS, BASELINE_COMMIT, createManifest, validateManifest, validateTransition } = require('./manifest');
const root = path.resolve(__dirname, '../..');
function validateBuild(krok, bytes) {
  const config = BANKS.find(b => b.krok === krok);
  if (!config) throw new Error('Invalid KROK');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, `data/question-identity/krok${krok}-main.manifest.json`)));
  const baseline = execFileSync('git', ['show', `${BASELINE_COMMIT}:${config.path}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  validateTransition(createManifest(config, baseline), manifest);
  return validateManifest(manifest, Buffer.from(bytes));
}
module.exports = { validateBuild };
