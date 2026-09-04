const fs = require("fs");
const path = require("path");

// ---------------------------------
// Files
// ---------------------------------

const KROK_DIR = path.join(
  __dirname,
  "..",
  "krok1"
);

const CLEANING_REPORT = path.join(
  KROK_DIR,
  "cleaning_report.csv"
);

const LEXICAL_REPORT = path.join(
  KROK_DIR,
  "lexical_report.csv"
);

const OUTPUT_FILE =
  process.env.OUTPUT_FILE ||
  path.join(
    __dirname,
    "..",
    "krok1",
    "review_queue.csv"
  );

const LEXICAL_OUTPUT_FILE = process.env.OUTPUT_FILE 
  ? process.env.OUTPUT_FILE.replace("review_queue.csv", "lexical_source_review.csv")
  : path.join(__dirname, "..", "krok1", "lexical_source_review.csv");


const LEXICAL_REVIEW_FILE = process.env.OUTPUT_FILE 
  ? process.env.OUTPUT_FILE.replace("review_queue.csv", "lexical_source_review.csv")
  : path.join(__dirname, "..", "krok1", "lexical_source_review.csv");

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

  if (rows.length === 0) {
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
// CSV writer
// ---------------------------------

function csvEscape(value) {
  const str = String(value ?? "");

  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(
      /"/g,
      '""'
    )}"`;
  }

  return str;
}

// ---------------------------------
// Priority
// ---------------------------------

function getPriority(category) {
  switch (category) {
    case "MEDICAL REVIEW":
      return 1;

    case "SAFE":
      return 2;

    case "LIKELY_TYPO":
      return 3;

    case "REVIEW":
      return 4;

    default:
      return 5;
  }
}

// ---------------------------------
// Load reports
// ---------------------------------

function loadReport(file) {
  if (!fs.existsSync(file)) {
    console.error(
      `Missing file: ${file}`
    );

    process.exit(1);
  }

  return parseCSV(
    fs.readFileSync(file, "utf8")
  );
}


const SAFE_PLAN_FILE = path.join(KROK_DIR, "safe_correction_plan.csv");
const CLEANED_JSON_FILE = path.join(KROK_DIR, "questions.cleaned.json");

const safePlanRows = loadReport(SAFE_PLAN_FILE);
const cleanedQuestions = JSON.parse(fs.readFileSync(CLEANED_JSON_FILE, "utf8"));
const cleanedMap = {};
cleanedQuestions.forEach(q => {
  cleanedMap[String(q.id)] = q;
});

const cleaningRows =
  loadReport(CLEANING_REPORT);

const lexicalRows =
  loadReport(LEXICAL_REPORT);

// ---------------------------------
// Normalize Layer 1
// ---------------------------------

const queue = cleaningRows.map(row => ({
  source_layer: "LAYER_1",

  id: row.id ?? "",
  year: row.year ?? "",
  subject: row.subject ?? "",
  field: row.field ?? "",
  original: row.original ?? "",
  detected: row.detected ?? "",
  proposed: row.proposed ?? "",

  category:
    row.category ?? "REVIEW",

  type: row.type ?? "",
  confidence: row.confidence ?? "",
  note: row.note ?? "",

  priority:
    getPriority(row.category),

  approval_status: "PENDING",
  reviewer_note: ""
}));

// ---------------------------------
// Normalize Layer 2
// ---------------------------------

lexicalRows.forEach(row => {
  // VALID terms should normally
  // already be absent from the report.
  if (row.decision === "VALID") {
    return;
  }

  let category;

  if (row.category === "SAFE") {
    category = "SAFE";
  } else if (
    row.decision === "LIKELY_TYPO"
  ) {
    category = "LIKELY_TYPO";
  } else {
    category = "REVIEW";
  }

  queue.push({
    source_layer: "LAYER_2",

    id: row.id ?? "",
    year: row.year ?? "",
    subject: row.subject ?? "",
    field: row.field ?? "",

    original: "",

    detected:
      row.detected ?? "",

    proposed:
      row.proposed ?? "",

    category,

    type:
      row.type ?? "LEXICAL_REVIEW",

    confidence:
      row.confidence ?? "",

    note:
      row.note ?? "",

    priority:
      getPriority(category),

    approval_status: "PENDING",
    reviewer_note: ""
  });
});

// ---------------------------------
// Count lexical occurrences
// ---------------------------------

const lexicalOccurrences = {};

queue.forEach(row => {
  if (
    row.source_layer === "LAYER_2" &&
    row.type === "KNOWN_LEXICAL_DECISION"
  ) {
    const token = String(
      row.detected
    ).toLowerCase();

    lexicalOccurrences[token] =
      (lexicalOccurrences[token] || 0) + 1;
  }
});

// ---------------------------------
// Deduplicate
// ---------------------------------

const uniqueQueue = [];
const seen = new Set();

queue.forEach(row => {
  let key;

  // A known lexical decision is global:
  // review each token only once.
  if (
    row.source_layer === "LAYER_2" &&
    row.type === "KNOWN_LEXICAL_DECISION"
  ) {
    key = [
      row.source_layer,
      row.type,
      String(row.detected).toLowerCase()
    ].join("|");
  } else {
    // Context-dependent findings remain
    // associated with question and field.
    key = [
      row.source_layer,
      row.id,
      row.field,
      row.type,
      row.detected,
      row.proposed
    ].join("|");
  }

  if (!seen.has(key)) {
    seen.add(key);

    const outputRow = {
      ...row,

      occurrences:
        row.source_layer === "LAYER_2" &&
        row.type === "KNOWN_LEXICAL_DECISION"
          ? lexicalOccurrences[
              String(row.detected).toLowerCase()
            ] || 1
          : 1
    };

    uniqueQueue.push(outputRow);
  }
});

// ---------------------------------
// Separate queues
// ---------------------------------

const lexicalSourceReview =
  uniqueQueue.filter(row =>
    row.source_layer === "LAYER_2" &&
    row.type === "KNOWN_LEXICAL_DECISION" &&
    row.category === "REVIEW"
  );

const operationalQueue =
  uniqueQueue.filter(row =>
    !(
      row.source_layer === "LAYER_2" &&
      row.type === "KNOWN_LEXICAL_DECISION" &&
      row.category === "REVIEW"
    )
  );


// ---------------------------------
// Lifecycle Matching
// ---------------------------------
const ORIGINAL_JSON_FILE = path.join(KROK_DIR, "questions.original.json");
const originalQuestions = JSON.parse(fs.readFileSync(ORIGINAL_JSON_FILE, "utf8"));
const originalMap = {};
originalQuestions.forEach(q => { originalMap[String(q.id)] = q; });

function getFieldStr(q, field) {
  if (!q) return "";
  if (field === "question") return q.question || "";
  if (field === "topic") return q.topic || "";
  if (field.startsWith("answer_")) {
    const idx = parseInt(field.split("_")[1], 10) - 1;
    return (q.answers && q.answers[idx]) ? q.answers[idx] : "";
  }
  return "";
}

operationalQueue.forEach(row => {
  const idStr = String(row.id);
  const planRows = safePlanRows.filter(p => String(p.id) === idStr && p.field === row.field);
  const authorizedRows = planRows.filter(p => p.apply === "YES");
  
  if (authorizedRows.length === 0) {
    row.approval_status = "PENDING";
    return;
  }
  
  const cleanedFieldStr = getFieldStr(cleanedMap[idStr], row.field);
  const origFieldStr = getFieldStr(originalMap[idStr], row.field);
  
  let isMatched = false;
  
  if (row.source_layer === "LAYER_1") {
    const match = authorizedRows.find(p => {
      // 1. Exact transformation match
      if (row.original && row.proposed && p.original && p.proposed) {
          if (row.original === p.original && row.proposed === p.proposed) {
              return true;
          }
      }
      
      // 2. Exact detected token match
      if (row.detected && row.detected.trim() !== "" && p.detected === row.detected) {
          return true;
      }
      
      // 3. Fallback for blank/ambiguous detector rows: require original match + type match.
      // This prevents Q2386 SPACE_BEFORE_PUNCTUATION from matching MISSING_SPACE_AFTER_PUNCTUATION.
      if (row.original && row.original.trim() !== "" && p.original === row.original) {
          // If queue row lacks proposed, use type as supplementary evidence.
          if (!row.proposed || row.proposed.trim() === "") {
              // MUST NOT authorize if specific detected token cannot be matched
              if (row.detected && row.detected.trim() !== "") {
                  if (p.detected && p.detected.trim() !== "" && row.detected !== p.detected) {
                      return false; // specific mismatch
                  }
              }
              if (p.type === row.type) return true;
          }
      }
      
      return false;
    });
    
    if (match) {
       if (row.detected && row.detected.trim() !== "") {
           if (!cleanedFieldStr.includes(row.detected)) {
               isMatched = true;
           } else if (match.proposed && cleanedFieldStr === match.proposed) {
               isMatched = true;
           }
       } else {
           if (cleanedFieldStr !== origFieldStr) {
               isMatched = true;
           }
       }
    }
  } else {
    // LAYER_2
    const match = authorizedRows.find(p => {
      if (p.detected === row.detected) return true;
      if (p.original && p.original.includes(row.detected) && p.proposed && !p.proposed.includes(row.detected)) return true;
      return false;
    });
    
    if (match) {
      if (!cleanedFieldStr.includes(row.detected)) {
        isMatched = true;
      }
    }
  }
  
  if (isMatched) {
    row.approval_status = "AUTHORIZED_IMPLEMENTED";
  } else {
    row.approval_status = "PENDING";
  }
});

lexicalSourceReview.forEach(row => {
    row.approval_status = "PENDING";
});
// ---------------------------------
// Sort
// ---------------------------------

operationalQueue.sort((a, b) => {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }

  if (a.id !== b.id) {
    return String(a.id).localeCompare(
      String(b.id)
    );
  }

  return String(a.field).localeCompare(
    String(b.field)
  );
});

lexicalSourceReview.sort((a, b) => {
  if (b.occurrences !== a.occurrences) {
    return b.occurrences - a.occurrences;
  }

  return String(a.detected).localeCompare(
    String(b.detected)
  );
});

// ---------------------------------
// Export
// ---------------------------------

const headers = [
  "priority",
  "source_layer",
  "id",
  "year",
  "subject",
  "field",
  "original",
  "detected",
  "occurrences",
  "proposed",
  "category",
  "type",
  "confidence",
  "note",
  "approval_status",
  "reviewer_note"
];

// Operational review queue
const output = [
  headers.join(","),

  ...operationalQueue.map(row =>
    headers
      .map(header =>
        csvEscape(row[header])
      )
      .join(",")
  )
].join("\n");

fs.writeFileSync(
  OUTPUT_FILE,
  output,
  "utf8"
);

// Separate lexical/source-specific review
const lexicalOutput = [
  headers.join(","),

  ...lexicalSourceReview.map(row =>
    headers
      .map(header =>
        csvEscape(row[header])
      )
      .join(",")
  )
].join("\n");

fs.writeFileSync(
  LEXICAL_REVIEW_FILE,
  lexicalOutput,
  "utf8"
);

// ---------------------------------
// Summary helpers
// ---------------------------------

function countByCategory(rows) {
  const counts = {};

  rows.forEach(row => {
    counts[row.category] =
      (counts[row.category] || 0) + 1;
  });

  return counts;
}

const operationalCounts =
  countByCategory(operationalQueue);

// ---------------------------------
// Summary
// ---------------------------------

console.log("");
console.log("KROK Review Queue");
console.log("-----------------");

console.log(
  `Layer 1 findings: ${cleaningRows.length}`
);

console.log(
  `Layer 2 findings: ${lexicalRows.length}`
);

console.log(
  `Unique findings before split: ${uniqueQueue.length}`
);

console.log("");
console.log("Operational queue");
console.log("-----------------");

console.log(
  `Items: ${operationalQueue.length}`
);

[
  "MEDICAL REVIEW",
  "SAFE",
  "LIKELY_TYPO",
  "REVIEW"
].forEach(category => {
  console.log(
    `${category}: ${
      operationalCounts[category] || 0
    }`
  );
});

console.log("");
console.log("Lexical source review");
console.log("---------------------");

console.log(
  `Unique tokens: ${lexicalSourceReview.length}`
);

const totalLexicalOccurrences =
  lexicalSourceReview.reduce(
    (sum, row) =>
      sum + Number(row.occurrences || 0),
    0
  );

console.log(
  `Total occurrences: ${totalLexicalOccurrences}`
);

// ---------------------------------
// Operational REVIEW by type
// ---------------------------------

const reviewByType = {};

operationalQueue
  .filter(row =>
    row.category === "REVIEW"
  )
  .forEach(row => {
    const type =
      row.type || "UNKNOWN";

    reviewByType[type] =
      (reviewByType[type] || 0) + 1;
  });

console.log("");
console.log("Operational REVIEW by type");
console.log("--------------------------");

Object.entries(reviewByType)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(
      `${type}: ${count}`
    );
  });

// ---------------------------------
// Created files
// ---------------------------------

console.log("");
console.log(`Created: ${OUTPUT_FILE}`);
console.log(
  `Created: ${LEXICAL_REVIEW_FILE}`
);