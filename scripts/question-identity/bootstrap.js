'use strict';

// Explicit bootstrap only; existing converters and application pipelines never call this.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BANKS, BASELINE_COMMIT, createManifest, verifyPublished } = require('./manifest.js');
const root = path.resolve(__dirname, '../..');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--write') || args.length > 1) throw new Error('Usage: node scripts/question-identity/bootstrap.js [--write]');
  if (args.includes('--write') && BANKS.some(config => fs.existsSync(path.join(root, 'data/question-identity', `krok${config.krok}-main.manifest.json`)))) {
    throw new Error('Refusing to overwrite existing manifests');
  }
  const prepared = [];
  for (const config of BANKS) {
    const bytes = fs.readFileSync(path.join(root, config.path));
    const committed = execFileSync('git', ['show', `${BASELINE_COMMIT}:${config.path}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    if (!bytes.equals(committed)) throw new Error('Local bank differs from committed foundation baseline');
    const proof = await verifyPublished(config, bytes, async url => {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Published request failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    });
    const target = path.join(root, 'data/question-identity', `krok${config.krok}-main.manifest.json`);
    if (args.includes('--write') && fs.existsSync(target)) throw new Error(`Refusing to overwrite ${target}`);
    prepared.push({ target, manifest: createManifest(config, bytes) });
    console.log(JSON.stringify({ bank: config.path, published: proof, localMatchesPublished: true }));
  }
  // Both sources must pass verification before creating either manifest.
  if (args.includes('--write')) {
    fs.mkdirSync(path.join(root, 'data/question-identity'), { recursive: true });
    for (const { target, manifest } of prepared) fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    console.log('Created two manifests; question banks were not written.');
  } else console.log('Dry run only; no files written.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
