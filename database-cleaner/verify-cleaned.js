const fs = require("fs");
const path = require("path");
const {
  normalizeScientificFormatting
} = require("./scientific-formatting-engine");
const {
  applyCyrillicConfusable
} = require("./cyrillic-confusable-engine");

const {
  applyCorrectionToText
} = require("./correction-engine");
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

const ORIGINAL_FILE = path.join(
  KROK_DIR,
  "questions.original.json"
);

const CLEANED_FILE = path.join(
  KROK_DIR,
  "questions.cleaned.json"
);

const PLAN_FILE = path.join(
  KROK_DIR,
  "safe_correction_plan.csv"
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
  ORIGINAL_FILE,
  CLEANED_FILE,
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

const original = JSON.parse(
  fs.readFileSync(
    ORIGINAL_FILE,
    "utf8"
  )
);

const cleaned = JSON.parse(
  fs.readFileSync(
    CLEANED_FILE,
    "utf8"
  )
);

const plan = parseCSV(
  fs.readFileSync(
    PLAN_FILE,
    "utf8"
  )
);

if (
  !Array.isArray(original) ||
  !Array.isArray(cleaned)
) {
  console.error(
    "Both databases must be arrays."
  );
  process.exit(1);
}

// ---------------------------------
// Authorized corrections
// ---------------------------------

const authorized = plan.filter(
  row =>
    row.apply === "YES" &&
    row.plan_status ===
      "AUTO_APPROVED"
);

// ---------------------------------
// Expected DB starts as original clone
// ---------------------------------

const expected = JSON.parse(
  JSON.stringify(original)
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
// Group corrections
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
// Reconstruct expected DB
// ---------------------------------

let reconstructedCorrections = 0;
let reconstructionErrors = 0;

const reconstructionProblems = [];

for (
  const corrections
  of groups.values()
) {
  const first = corrections[0];

  const question =
    expected.find(
      item =>
        String(item.id) ===
        String(first.id)
    );

  if (!question) {
    reconstructionErrors++;

    reconstructionProblems.push(
      `${first.id}: question not found`
    );

    continue;
  }

  const fieldInfo =
    getFieldInfo(
      question,
      first.field
    );

  if (!fieldInfo.ok) {
    reconstructionErrors++;

    reconstructionProblems.push(
      `${first.id}: ${fieldInfo.reason}`
    );

    continue;
  }

  const sourceText =
    fieldInfo.value;

  const originalsMatch =
    corrections.every(
      correction =>
        correction.original ===
        sourceText
    );

  if (!originalsMatch) {
    reconstructionErrors++;

    reconstructionProblems.push(
      `${first.id} ${first.field}: correction-plan original mismatch`
    );

    continue;
  }

  let workingText =
    sourceText;

  let groupFailed = false;

  for (
    const correction
    of corrections
  ) {

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
        reconstructionErrors++;

        reconstructionProblems.push(
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

      reconstructedCorrections++;
      continue;
    }

    // ---------------------------------
    // BROKEN_WORD_HYPHENATION
    // ---------------------------------

    if (
      correction.type ===
      "BROKEN_WORD_HYPHENATION"
    ) {
      const token =
        String(
          correction.detected || ""
        );

      if (!token) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: missing hyphenation token`
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
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: invalid hyphenation proposal`
        );

        groupFailed = true;
        break;
      }

      const occurrences =
        workingText.split(
          token
        ).length - 1;

      if (occurrences !== 1) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: token "${token}" occurs ${occurrences} times during reconstruction`
        );

        groupFailed = true;
        break;
      }

      workingText =
        workingText.replace(
          token,
          correctedToken
        );

      reconstructedCorrections++;
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
        reconstructionErrors++;

        reconstructionProblems.push(
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

      if (
        after === workingText
      ) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: no space-before-punctuation change remains`
        );

        groupFailed = true;
        break;
      }

      workingText = after;

      reconstructedCorrections++;
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
        reconstructionErrors++;

        reconstructionProblems.push(
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

      if (
        after === workingText
      ) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: no missing-space change remains`
        );

        groupFailed = true;
        break;
      }

      workingText = after;

      reconstructedCorrections++;
      continue;
    }

    // ---------------------------------
    // OCR_CASE_CORRUPTION
    // ---------------------------------

    if (
      correction.type ===
      "OCR_CASE_CORRUPTION"
    ) {
      const token =
        String(
          correction.detected || ""
        );

      if (!token) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: missing OCR token`
        );

        groupFailed = true;
        break;
      }

      if (!token.includes("FI")) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: OCR token does not contain FI`
        );

        groupFailed = true;
        break;
      }

      const correctedToken =
        token.replace(
          /FI/g,
          "fi"
        );

      const sourceOccurrences =
        sourceText.split(
          token
        ).length - 1;

      if (
        sourceOccurrences !== 1
      ) {
        reconstructionErrors++;

        reconstructionProblems.push(
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
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: invalid OCR case proposal`
        );

        groupFailed = true;
        break;
      }

      if (
        expectedProposal.length !==
        sourceText.length
      ) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: OCR correction changes text length`
        );

        groupFailed = true;
        break;
      }

      const currentOccurrences =
        workingText.split(
          token
        ).length - 1;

      if (
        currentOccurrences !== 1
      ) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: OCR token "${token}" occurs ${currentOccurrences} times during reconstruction`
        );

        groupFailed = true;
        break;
      }

      workingText =
        workingText.replace(
          token,
          correctedToken
        );

      reconstructedCorrections++;
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

      reconstructedCorrections++;
      continue;
    }





    // ---------------------------------
    // OCR_CHARACTER_CORRUPTION
    // ---------------------------------

    if (
      correction.type ===
      "OCR_CHARACTER_CORRUPTION"
    ) {
      const sourceOccurrences =
        (sourceText.match(/ß/g) || []).length;

      if (sourceOccurrences < 1) {
        reconstructionErrors++;

        reconstructionProblems.push(
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
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: invalid OCR character proposal`
        );

        groupFailed = true;
        break;
      }

      const after =
        workingText.replace(/ß/g, "fl");

      if (after === workingText) {
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: no ß character remains during reconstruction`
        );

        groupFailed = true;
        break;
      }

      workingText = after;

      reconstructedCorrections++;
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

      reconstructedCorrections++;
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
        reconstructionErrors++;

        reconstructionProblems.push(
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
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: no ${correction.type} pattern remains during reconstruction`
        );

        groupFailed = true;
        break;
      }

      workingText = after;

      reconstructedCorrections++;
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
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: ${result.error}`
        );

        groupFailed = true;
        break;
      }

      workingText = result.text;

      reconstructedCorrections++;
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
        reconstructionErrors++;

        reconstructionProblems.push(
          `${correction.id} ${correction.field}: ${result.error}`
        );

        groupFailed = true;
        break;
      }

      workingText = result.text;

      reconstructedCorrections++;
      continue;
    }



    // ---------------------------------
    // Unsupported type
    // ---------------------------------

    reconstructionErrors++;

    reconstructionProblems.push(
      `${correction.id}: unsupported type "${correction.type}"`
    );

    groupFailed = true;
    break;
  }

  if (!groupFailed) {
    setFieldValue(
      question,
      fieldInfo,
      workingText
    );
  }
}

// ---------------------------------
// Structural checks
// ---------------------------------

let structuralErrors = 0;

if (
  original.length !==
  cleaned.length
) {
  structuralErrors++;
}

// ---------------------------------
// Deep comparison
// expected vs cleaned
// ---------------------------------

const unexpectedDifferences = [];

function compareValues(
  expectedValue,
  actualValue,
  pathParts,
  questionId
) {
  if (
    expectedValue === null ||
    actualValue === null ||
    typeof expectedValue !==
      "object" ||
    typeof actualValue !==
      "object"
  ) {
    if (
      expectedValue !==
      actualValue
    ) {
      unexpectedDifferences.push({
        id: questionId,
        path:
          pathParts.join("."),
        expected:
          expectedValue,
        actual:
          actualValue
      });
    }

    return;
  }

  if (
    Array.isArray(expectedValue) ||
    Array.isArray(actualValue)
  ) {
    if (
      !Array.isArray(expectedValue) ||
      !Array.isArray(actualValue)
    ) {
      unexpectedDifferences.push({
        id: questionId,
        path:
          pathParts.join("."),
        expected:
          expectedValue,
        actual:
          actualValue
      });

      return;
    }

    const maxLength =
      Math.max(
        expectedValue.length,
        actualValue.length
      );

    for (
      let i = 0;
      i < maxLength;
      i++
    ) {
      compareValues(
        expectedValue[i],
        actualValue[i],
        [
          ...pathParts,
          String(i)
        ],
        questionId
      );
    }

    return;
  }

  const keys = new Set([
    ...Object.keys(expectedValue),
    ...Object.keys(actualValue)
  ]);

  keys.forEach(key => {
    compareValues(
      expectedValue[key],
      actualValue[key],
      [
        ...pathParts,
        key
      ],
      questionId
    );
  });
}

// ---------------------------------
// Compare every question
// ---------------------------------

const maxQuestions =
  Math.max(
    expected.length,
    cleaned.length
  );

for (
  let i = 0;
  i < maxQuestions;
  i++
) {
  const expectedQuestion =
    expected[i];

  const cleanedQuestion =
    cleaned[i];

  const questionId =
    expectedQuestion?.id ??
    cleanedQuestion?.id ??
    `INDEX_${i}`;

  compareValues(
    expectedQuestion,
    cleanedQuestion,
    [],
    questionId
  );
}

// ---------------------------------
// Count actual changes
// ---------------------------------

const actualChanges = [];

function collectChanges(
  before,
  after,
  pathParts,
  questionId
) {
  if (
    before === null ||
    after === null ||
    typeof before !==
      "object" ||
    typeof after !==
      "object"
  ) {
    if (before !== after) {
      actualChanges.push({
        id: questionId,
        path:
          pathParts.join(".")
      });
    }

    return;
  }

  if (
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    if (
      !Array.isArray(before) ||
      !Array.isArray(after)
    ) {
      actualChanges.push({
        id: questionId,
        path:
          pathParts.join(".")
      });

      return;
    }

    const maxLength =
      Math.max(
        before.length,
        after.length
      );

    for (
      let i = 0;
      i < maxLength;
      i++
    ) {
      collectChanges(
        before[i],
        after[i],
        [
          ...pathParts,
          String(i)
        ],
        questionId
      );
    }

    return;
  }

  const keys = new Set([
    ...Object.keys(before),
    ...Object.keys(after)
  ]);

  keys.forEach(key => {
    collectChanges(
      before[key],
      after[key],
      [
        ...pathParts,
        key
      ],
      questionId
    );
  });
}

for (
  let i = 0;
  i < original.length;
  i++
) {
  const questionId =
    original[i]?.id ??
    `INDEX_${i}`;

  collectChanges(
    original[i],
    cleaned[i],
    [],
    questionId
  );
}

const changedQuestionIds =
  new Set(
    actualChanges.map(
      change =>
        String(change.id)
    )
  );

// ---------------------------------
// Breakdown by type
// ---------------------------------

const byType = {};

authorized.forEach(row => {
  byType[row.type] =
    (byType[row.type] || 0) + 1;
});

// ---------------------------------
// Summary
// ---------------------------------

console.log("");
console.log(
  "KROK Cleaned DB Verification"
);

console.log(
  "----------------------------"
);

console.log(
  `Questions compared: ${Math.min(
    original.length,
    cleaned.length
  )}`
);

console.log(
  `Authorized corrections: ${authorized.length}`
);

console.log(
  `Correction groups: ${groups.size}`
);

console.log(
  `Reconstructed corrections: ${reconstructedCorrections}`
);

console.log(
  `Questions changed: ${changedQuestionIds.size}`
);

console.log(
  `Fields changed: ${actualChanges.length}`
);

console.log(
  `Unexpected differences: ${unexpectedDifferences.length}`
);

console.log(
  `Reconstruction errors: ${reconstructionErrors}`
);

console.log(
  `Structural errors: ${structuralErrors}`
);

console.log("");
console.log(
  "Verified by type"
);

console.log(
  "----------------"
);

Object.entries(byType)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(
      `${type}: ${count}`
    );
  });

// ---------------------------------
// Failure gate
// ---------------------------------

if (
  unexpectedDifferences.length > 0 ||
  reconstructionErrors > 0 ||
  structuralErrors > 0 ||
  reconstructedCorrections !==
    authorized.length ||
  actualChanges.length !==
    groups.size
) {
  console.log("");
  console.log(
    "VERIFICATION FAILED"
  );

  if (
    reconstructionProblems.length >
      0
  ) {
    console.log("");
    console.log(
      "Reconstruction problems"
    );

    console.log(
      "-----------------------"
    );

    reconstructionProblems
      .forEach(problem =>
        console.log(problem)
      );
  }

  if (
    unexpectedDifferences.length >
      0
  ) {
    console.log("");
    console.log(
      "Unexpected differences"
    );

    console.log(
      "----------------------"
    );

    unexpectedDifferences
      .slice(0, 50)
      .forEach(change => {
        console.log(
          `ID ${change.id} | ${change.path}`
        );

        console.log(
          `  EXPECTED: ${JSON.stringify(
            change.expected
          )}`
        );

        console.log(
          `  ACTUAL:   ${JSON.stringify(
            change.actual
          )}`
        );
      });
  }

  process.exit(1);
}

// ---------------------------------
// Success
// ---------------------------------

console.log("");
console.log(
  "VERIFICATION PASSED"
);

console.log(
  "questions.cleaned.json exactly matches the authorized correction plan."
);

console.log(
  "No unauthorized or structural changes were detected."
);