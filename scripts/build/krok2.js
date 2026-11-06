const fs = require("fs");
const path = require("path");
const bankDir = path.resolve(__dirname, "../../krok2");

const exportsDir = path.join(bankDir, "exports-krok2");

const dedupAuditPath = path.join(
  bankDir,
  "krok2-final-dedup-audit.json"
);

if (!fs.existsSync(dedupAuditPath)) {
  console.error("Missing krok2-final-dedup-audit.json");
  process.exit(1);
}

const dedupAudit = JSON.parse(
  fs.readFileSync(dedupAuditPath, "utf8")
);

const removeIds = new Set(
  dedupAudit.removeIds || []
);

// ======================================================
// LOAD ALL VALID QUESTION JSON FILES
// ======================================================

const jsonFiles = fs
  .readdirSync(exportsDir)
  .filter(file =>
    file.endsWith(".json") &&
    !file.endsWith("-report.json")
  );

const allQuestions = [];

for (const file of jsonFiles) {

  const filePath = path.join(exportsDir, file);

  const data = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );

  if (!Array.isArray(data)) {
    continue;
  }

  for (const q of data) {

    allQuestions.push({
      ...q,
      sourceFile: file
    });
  }
}

// ======================================================
// FILTER APPROVED DUPLICATES
// ======================================================

const keptQuestions = allQuestions.filter(
  q => !removeIds.has(q.id)
);

const removedQuestions = allQuestions.filter(
  q => removeIds.has(q.id)
);

// ======================================================
// RENUMBER IDS
// ======================================================

const finalQuestions = keptQuestions.map(
  (q, index) => {

    const {
      id,
      sourceFile,
      warnings,
      ...rest
    } = q;

    return {
      id: `krok2-${String(index + 1).padStart(4, "0")}`,
      ...rest
    };
  }
);

// ======================================================
// VALIDATION
// ======================================================

const problems = [];

for (const q of finalQuestions) {

  if (!q.question) {
    problems.push({
      id: q.id,
      problem: "Missing question"
    });
  }

  if (
    !Array.isArray(q.answers) ||
    q.answers.length !== 5
  ) {
    problems.push({
      id: q.id,
      problem: "Invalid answer count"
    });
  }

  if (
    typeof q.correct !== "number" ||
    q.correct < 0 ||
    q.correct > 4
  ) {
    problems.push({
      id: q.id,
      problem: "Invalid correct answer index"
    });
  }

  if (
    Array.isArray(q.answers) &&
    q.answers.some(a => !a)
  ) {
    problems.push({
      id: q.id,
      problem: "Empty answer"
    });
  }
}

// ======================================================
// OUTPUT FILES
// ======================================================

const finalPath = path.join(
  bankDir,
  "questions-krok2.json"
);

if (problems.length) throw new Error("Invalid KROK 2 candidate");
const candidate = JSON.stringify(finalQuestions, null, 2);
require("../question-identity/build-gate").validateBuild(2, candidate);
fs.writeFileSync(finalPath, candidate, "utf8");

const removedPath = path.join(
  bankDir,
  "krok2-removed-duplicates.json"
);

fs.writeFileSync(
  removedPath,
  JSON.stringify(removedQuestions, null, 2),
  "utf8"
);

const validationPath = path.join(
  bankDir,
  "krok2-final-validation.json"
);

const validation = {
  inputQuestions: allQuestions.length,
  approvedDuplicateIds: removeIds.size,
  removedQuestions: removedQuestions.length,
  finalQuestions: finalQuestions.length,
  validationProblems: problems.length,
  problems
};

fs.writeFileSync(
  validationPath,
  JSON.stringify(validation, null, 2),
  "utf8"
);

// ======================================================
// SUMMARY
// ======================================================

console.log("\n======================================");
console.log("KROK 2 FINAL DATABASE BUILD");
console.log("======================================\n");

console.log(
  `Input valid questions: ${allQuestions.length}`
);

console.log(
  `Approved duplicate IDs: ${removeIds.size}`
);

console.log(
  `Actually removed: ${removedQuestions.length}`
);

console.log(
  `Final questions: ${finalQuestions.length}`
);

console.log(
  `Validation problems: ${problems.length}`
);

console.log("\nFiles created:");

console.log(
  `- ${finalPath}`
);

console.log(
  `- ${removedPath}`
);

console.log(
  `- ${validationPath}`
);

console.log("\nDone.\n");