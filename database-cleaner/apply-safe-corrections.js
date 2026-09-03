const fs = require("fs");
const path = require("path");
const {
  normalizeScientificFormatting
} = require("./scientific-formatting-engine");
const {
  applyCyrillicConfusable
} = require("./cyrillic-confusable-engine");
const {
  applyBrokenWordCorrection
} = require("./broken-word-engine");

// ---------------------------------
// Files
// ---------------------------------

const KROK_DIR = path.join(
  __dirname,
  "krok1"
);

const SOURCE_FILE = path.join(
  KROK_DIR,
  "questions.original.json"
);

const PLAN_FILE = path.join(
  KROK_DIR,
  "safe_correction_plan.csv"
);

const OUTPUT_FILE = path.join(
  KROK_DIR,
  "questions.cleaned.json"
);

// ---------------------------------
// CSV parser
// ---------------------------------

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (
        insideQuotes &&
        text[i + 1] === '"'
      ) {
        field += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (
      char === "," &&
      !insideQuotes
    ) {
      row.push(field);
      field = "";
    } else if (
      (char === "\n" || char === "\r") &&
      !insideQuotes
    ) {
      if (
        char === "\r" &&
        text[i + 1] === "\n"
      ) {
        i++;
      }

      row.push(field);

      if (
        row.some(value =>
          value.trim() !== ""
        )
      ) {
        rows.push(row);
      }

      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0];

  return rows
    .slice(1)
    .map(values => {
      const object = {};

      headers.forEach(
        (header, index) => {
          object[header.trim()] =
            values[index] ?? "";
        }
      );

      return object;
    });
}

// ---------------------------------
// Safety checks
// ---------------------------------

[
  SOURCE_FILE,
  PLAN_FILE
].forEach(file => {
  if (!fs.existsSync(file)) {
    console.error(
      `Missing file: ${file}`
    );
    process.exit(1);
  }
});

// ---------------------------------
// Load
// ---------------------------------

const questions = JSON.parse(
  fs.readFileSync(
    SOURCE_FILE,
    "utf8"
  )
);

const plan = parseCSV(
  fs.readFileSync(
    PLAN_FILE,
    "utf8"
  )
);

if (!Array.isArray(questions)) {
  console.error(
    "Source database is not an array."
  );
  process.exit(1);
}

const authorized = plan.filter(
  row =>
    row.apply === "YES" &&
    row.plan_status ===
      "AUTO_APPROVED"
);

// ---------------------------------
// Field helpers
// ---------------------------------

function getFieldInfo(
  question,
  field
) {
  if (
    typeof question[field] ===
    "string"
  ) {
    return {
      ok: true,
      kind: "DIRECT",
      field,
      value: question[field]
    };
  }

  const answerMatch =
    /^answer_(\d+)$/.exec(field);

  if (answerMatch) {
    const index =
      Number(answerMatch[1]) - 1;

    if (
      Array.isArray(question.answers) &&
      index >= 0 &&
      index < question.answers.length &&
      typeof question.answers[index] ===
        "string"
    ) {
      return {
        ok: true,
        kind: "ANSWER",
        answerIndex: index,
        value: question.answers[index]
      };
    }
  }

  return {
    ok: false,
    reason:
      `Could not resolve field "${field}"`
  };
}

function setFieldValue(
  question,
  fieldInfo,
  value
) {
  if (fieldInfo.kind === "DIRECT") {
    question[fieldInfo.field] =
      value;
    return;
  }

  if (fieldInfo.kind === "ANSWER") {
    question.answers[
      fieldInfo.answerIndex
    ] = value;
  }
}

// ---------------------------------
// Group corrections by ID + field
// ---------------------------------

const groups = new Map();

authorized.forEach(correction => {
  const key = [
    String(correction.id),
    String(correction.field)
  ].join("|");

  if (!groups.has(key)) {
    groups.set(key, []);
  }

  groups
    .get(key)
    .push(correction);
});

// ---------------------------------
// Counters
// ---------------------------------

let appliedCorrections = 0;
let changedFields = 0;
let errors = 0;

const problems = [];

// ---------------------------------
// Apply
// ---------------------------------

for (const corrections of groups.values()) {
  const first = corrections[0];

  const question = questions.find(
    item =>
      String(item.id) ===
      String(first.id)
  );

  if (!question) {
    errors++;

    problems.push(
      `${first.id}: question not found`
    );

    continue;
  }

  const fieldInfo = getFieldInfo(
    question,
    first.field
  );

  if (!fieldInfo.ok) {
    errors++;

    problems.push(
      `${first.id}: ${fieldInfo.reason}`
    );

    continue;
  }

  const sourceText = fieldInfo.value;

  const originalsMatch =
    corrections.every(
      correction =>
        correction.original ===
        sourceText
    );

  if (!originalsMatch) {
    errors++;

    problems.push(
      `${first.id} ${first.field}: correction-plan original does not match source database`
    );

    continue;
  }

  let workingText = sourceText;
  let groupFailed = false;

  for (const correction of corrections) {

    // ---------------------------------
    // B12_SPACING
    // ---------------------------------

    if (
      correction.type ===
      "B12_SPACING"
    ) {
      const expectedProposal =
        sourceText.replace(
          /\bB\s+12\b/g,
          "B12"
        );

      if (
        correction.proposed !==
        expectedProposal
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid B12 proposal`
        );

        groupFailed = true;
        break;
      }

      workingText =
        workingText.replace(
          /\bB\s+12\b/g,
          "B12"
        );

      appliedCorrections++;
      continue;
    }

    // ---------------------------------
    // BROKEN_WORD_HYPHENATION
    // ---------------------------------

    if (
      correction.type ===
      "BROKEN_WORD_HYPHENATION"
    ) {
      const token = String(
        correction.detected || ""
      );

      if (!token) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: missing hyphenation token`
        );

        groupFailed = true;
        break;
      }

      const sourceOccurrences =
        sourceText.split(token)
          .length - 1;

      if (sourceOccurrences !== 1) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: "${token}" occurs ${sourceOccurrences} times in source`
        );

        groupFailed = true;
        break;
      }

      const correctedToken =
        token.replace("-", "");

      const expectedProposal =
        sourceText.replace(
          token,
          correctedToken
        );

      if (
        correction.proposed !==
        expectedProposal
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid hyphenation proposal`
        );

        groupFailed = true;
        break;
      }

      const currentOccurrences =
        workingText.split(token)
          .length - 1;

      if (currentOccurrences !== 1) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: "${token}" no longer occurs exactly once during grouped application`
        );

        groupFailed = true;
        break;
      }

      workingText =
        workingText.replace(
          token,
          correctedToken
        );

      appliedCorrections++;
      continue;
    }

    // ---------------------------------
    // SPACE_BEFORE_PUNCTUATION
    // ---------------------------------

    if (
      correction.type ===
      "SPACE_BEFORE_PUNCTUATION"
    ) {
      const expectedProposal =
        sourceText.replace(
          /\s+([,.!?;:])/g,
          "$1"
        );

      if (
        correction.proposed !==
        expectedProposal
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid space-before-punctuation proposal`
        );

        groupFailed = true;
        break;
      }

      const after =
        workingText.replace(
          /\s+([,.!?;:])/g,
          "$1"
        );

      if (after === workingText) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: no space-before-punctuation pattern remains`
        );

        groupFailed = true;
        break;
      }

      workingText = after;

      appliedCorrections++;
      continue;
    }

    // ---------------------------------
    // MISSING_SPACE_AFTER_PUNCTUATION
    // ---------------------------------

    if (
      correction.type ===
      "MISSING_SPACE_AFTER_PUNCTUATION"
    ) {
      const expectedProposal =
        sourceText
          .replace(
            /([!?;:])([A-Za-z])/g,
            "$1 $2"
          )
          .replace(
            /\.([A-Z])/g,
            ". $1"
          );

      if (
        correction.proposed !==
        expectedProposal
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid missing-space-after-punctuation proposal`
        );

        groupFailed = true;
        break;
      }

      const after =
        workingText
          .replace(
            /([!?;:])([A-Za-z])/g,
            "$1 $2"
          )
          .replace(
            /\.([A-Z])/g,
            ". $1"
          );

      if (after === workingText) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: no missing-space pattern remains during grouped application`
        );

        groupFailed = true;
        break;
      }

      workingText = after;

      appliedCorrections++;
      continue;
    }

    // ---------------------------------
    // OCR_CASE_CORRUPTION
    // ---------------------------------

    if (
      correction.type ===
      "OCR_CASE_CORRUPTION"
    ) {
      const token = String(
        correction.detected || ""
      );

      if (!token) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: missing OCR token`
        );

        groupFailed = true;
        break;
      }

      // Only the validated FI -> fi
      // transformation is permitted.
      if (!token.includes("FI")) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: OCR token does not contain FI`
        );

        groupFailed = true;
        break;
      }

      const correctedToken =
        token.replace(/FI/g, "fi");

      const sourceOccurrences =
        sourceText.split(token)
          .length - 1;

      if (sourceOccurrences !== 1) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: OCR token "${token}" occurs ${sourceOccurrences} times in source`
        );

        groupFailed = true;
        break;
      }

      const expectedProposal =
        sourceText.replace(
          token,
          correctedToken
        );

      if (
        correction.proposed !==
        expectedProposal
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid OCR case proposal`
        );

        groupFailed = true;
        break;
      }

      // Case correction only:
      // string length must remain identical.
      if (
        expectedProposal.length !==
        sourceText.length
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: OCR correction changes text length`
        );

        groupFailed = true;
        break;
      }

      const currentOccurrences =
        workingText.split(token)
          .length - 1;

      if (currentOccurrences !== 1) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: OCR token "${token}" no longer occurs exactly once during grouped application`
        );

        groupFailed = true;
        break;
      }

      workingText =
        workingText.replace(
          token,
          correctedToken
        );

      appliedCorrections++;
      continue;
    }





    // ---------------------------------
    // KNOWN_LEXICAL_TYPO
    // ---------------------------------

    if (
      correction.type ===
      "KNOWN_LEXICAL_TYPO"
    ) {
      const token = String(
        correction.detected || ""
      );

      if (!token) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: missing lexical typo token`
        );

        groupFailed = true;
        break;
      }

      const sourceOccurrences =
        sourceText.split(token).length - 1;

      if (sourceOccurrences !== 1) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: lexical token "${token}" occurs ${sourceOccurrences} times in source`
        );

        groupFailed = true;
        break;
      }

      // Recover replacement token from
      // the stored full-field proposal.
      const prefixIndex =
        sourceText.indexOf(token);

      const prefix =
        sourceText.slice(
          0,
          prefixIndex
        );

      const suffix =
        sourceText.slice(
          prefixIndex + token.length
        );

      if (
        !correction.proposed.startsWith(prefix) ||
        !correction.proposed.endsWith(suffix)
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid lexical typo proposal structure`
        );

        groupFailed = true;
        break;
      }

      const replacementToken =
        correction.proposed.slice(
          prefix.length,
          correction.proposed.length -
          suffix.length
        );

      if (!replacementToken) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: empty lexical replacement`
        );

        groupFailed = true;
        break;
      }

      const expectedProposal =
        sourceText.replace(
          token,
          replacementToken
        );

      if (
        correction.proposed !==
        expectedProposal
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid lexical typo proposal`
        );

        groupFailed = true;
        break;
      }

      const currentOccurrences =
        workingText.split(token).length - 1;

      if (currentOccurrences !== 1) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: lexical token "${token}" no longer occurs exactly once during grouped application`
        );

        groupFailed = true;
        break;
      }

      workingText =
        workingText.replace(
          token,
          replacementToken
        );

      appliedCorrections++;
      continue;
    }





    // ---------------------------------
    // OCR_CHARACTER_CORRUPTION
    // ---------------------------------

    if (
      correction.type ===
      "OCR_CHARACTER_CORRUPTION"
    ) {
      const token = "ß";

      const sourceOccurrences =
        (sourceText.match(/ß/g) || []).length;

      if (sourceOccurrences < 1) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: no ß character found in source`
        );

        groupFailed = true;
        break;
      }

      const expectedProposal =
        sourceText.replace(/ß/g, "fl");

      if (
        correction.proposed !==
        expectedProposal
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid OCR character proposal`
        );

        groupFailed = true;
        break;
      }

      const after =
        workingText.replace(/ß/g, "fl");

      if (after === workingText) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: no ß character remains during grouped application`
        );

        groupFailed = true;
        break;
      }

      workingText = after;

      appliedCorrections++;
      continue;
    }





    // ---------------------------------
    // SCIENTIFIC FORMATTING
    // ---------------------------------

    if (
      correction.type === "SCIENTIFIC_NOTATION" ||
      correction.type === "TEMPERATURE_FORMAT" ||
      correction.type === "GAS_NOTATION"
    ) {
      const expectedProposal =
        normalizeScientificFormatting(
          sourceText,
          correction.type
        );

      if (
        expectedProposal === null ||
        correction.proposed !== expectedProposal
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: invalid ${correction.type} proposal`
        );

        groupFailed = true;
        break;
      }

      const after =
        normalizeScientificFormatting(
          workingText,
          correction.type
        );

      if (
        after === null ||
        after === workingText
      ) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: no ${correction.type} pattern remains during application`
        );

        groupFailed = true;
        break;
      }

      workingText = after;

      appliedCorrections++;
      continue;
    }






    // ---------------------------------
    // CYRILLIC_CONFUSABLE
    // ---------------------------------

    if (
      correction.type ===
      "CYRILLIC_CONFUSABLE"
    ) {
      const result =
        applyCyrillicConfusable(
          sourceText,
          workingText,
          correction
        );

      if (!result.ok) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: ${result.error}`
        );

        groupFailed = true;
        break;
      }

      workingText = result.text;

      appliedCorrections++;
      continue;
    }



    // ---------------------------------
    // BROKEN WORDS
    // ---------------------------------

    if (
      correction.type === "POSSIBLE_BROKEN_WORD" ||
      correction.type === "BROKEN_WORD_WITH_SPACE"
    ) {
      const result =
        applyBrokenWordCorrection(
          sourceText,
          workingText,
          correction
        );

      if (!result.ok) {
        errors++;

        problems.push(
          `${correction.id} ${correction.field}: ${result.error}`
        );

        groupFailed = true;
        break;
      }

      workingText = result.text;

      appliedCorrections++;
      continue;
    }




    // ---------------------------------
    // Unsupported type
    // ---------------------------------

    errors++;

    problems.push(
      `${correction.id} ${correction.field}: unsupported AUTO_APPROVED type "${correction.type}"`
    );

    groupFailed = true;
    break;
  }

  if (groupFailed) {
    continue;
  }

  if (workingText !== sourceText) {
    setFieldValue(
      question,
      fieldInfo,
      workingText
    );

    changedFields++;
  }
}

// ---------------------------------
// Critical safety gate
// ---------------------------------

if (
  errors > 0 ||
  appliedCorrections !==
    authorized.length
) {
  console.log("");
  console.log(
    "KROK Safe Corrections"
  );

  console.log(
    "---------------------"
  );

  console.log(
    `Questions loaded: ${questions.length}`
  );

  console.log(
    `Authorized corrections: ${authorized.length}`
  );

  console.log(
    `Correction groups: ${groups.size}`
  );

  console.log(
    `Applied corrections: ${appliedCorrections}`
  );

  console.log(
    `Fields changed: ${changedFields}`
  );

  console.log(
    `Errors: ${errors}`
  );

  console.log("");
  console.log(
    "ABORTED: questions.cleaned.json was NOT created."
  );

  if (problems.length > 0) {
    console.log("");
    console.log("Problems");
    console.log("--------");

    problems.forEach(problem =>
      console.log(problem)
    );
  }

  process.exit(1);
}

// ---------------------------------
// Write cleaned DB
// ---------------------------------

fs.writeFileSync(
  OUTPUT_FILE,
  JSON.stringify(
    questions,
    null,
    2
  ) + "\n",
  "utf8"
);

// ---------------------------------
// Summary
// ---------------------------------

const appliedByType = {};

authorized.forEach(row => {
  appliedByType[row.type] =
    (appliedByType[row.type] || 0) +
    1;
});

console.log("");
console.log(
  "KROK Safe Corrections"
);

console.log(
  "---------------------"
);

console.log(
  `Questions loaded: ${questions.length}`
);

console.log(
  `Authorized corrections: ${authorized.length}`
);

console.log(
  `Correction groups: ${groups.size}`
);

console.log(
  `Applied corrections: ${appliedCorrections}`
);

console.log(
  `Fields changed: ${changedFields}`
);

console.log(
  `Errors: ${errors}`
);

console.log("");
console.log(
  "Applied by type"
);

console.log(
  "---------------"
);

Object.entries(appliedByType)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(
      `${type}: ${count}`
    );
  });

console.log("");
console.log(
  `Created: ${OUTPUT_FILE}`
);