'use strict';
// Generates reviewable SQL on stdout only. Never connects to Supabase.
const fs = require('node:fs');
const path = require('node:path');
const { BANKS } = require('../question-identity/manifest');
const { validateBuild } = require('../question-identity/build-gate');
const root = path.resolve(__dirname, '../..');
function catalogSQL() {
  const rows = [];
  for (const config of BANKS) {
    const bytes = fs.readFileSync(path.join(root, config.path));
    validateBuild(config.krok, bytes);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, `data/question-identity/krok${config.krok}-main.manifest.json`)));
    const revisions = new Map(manifest.entries.map(e => [e.legacyId, e.revision]));
    for (const q of JSON.parse(bytes)) {
      if (q.subject.startsWith('Past Paper')) throw new Error('Past Paper in main catalog');
      rows.push(`(${config.krok},'main:${q.id}',${revisions.get(q.id)},${q.answers.length},${q.correct})`);
    }
  }
  return '-- Generated from validated published banks. Review before applying.\nbegin;\ninsert into mistake_private.catalog (krok,question_id,revision,answer_count,correct_index) values\n' + rows.join(',\n') + ';\ncommit;\n';
}
if (require.main === module) process.stdout.write(catalogSQL());
module.exports = { catalogSQL };
