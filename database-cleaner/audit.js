const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(
  __dirname,
  "krok1",
  "questions.original.json"
);

const OUTPUT_FILE = path.join(
  __dirname,
  "krok1",
  "cleaning_report.csv"
);

const PILOT_SIZE = Infinity;

const questions = JSON.parse(
  fs.readFileSync(INPUT_FILE, "utf8")
);

const pilot = questions.slice(0, PILOT_SIZE);

const findings = [];

function addFinding({
  question,
  field,
  original,
  detected = "",
  proposed = "",
  category,
  type,
  confidence,
  note
}) {
  findings.push({
    id: question.id,
    year: question.year ?? "",
    subject: question.subject ?? "",
    field,
    original,
    detected,
    proposed,
    category,
    type,
    confidence,
    source: "automatic audit",
    status: "PENDING",
    note
  });
}

function inspectText(question, field, text) {
  if (typeof text !== "string") return;

  // 1. PDF/page-number artefacts
  if (/--\s*\d+\s+of\s+\d+\s*--/i.test(text)) {
    addFinding({
      question,
      field,
      original: text,
      category: "SAFE",
      type: "PDF_PAGE_ARTIFACT",
      confidence: "HIGH",
      note: "Possible page-number artefact from source PDF."
    });
  }

    // 2. Words broken across PDF lines WITH a space:
    // pati- ent, condi- tion
    //
    // This pattern can also match legitimate constructions
    // such as "Rh- factor" or "Water- and fat-soluble",
    // therefore it requires manual review.

    if (/\b[A-Za-z]{2,}-\s+[A-Za-z]{2,}\b/.test(text)) {

        addFinding({

            question,

            field,

            original: text,

            category: "REVIEW",

            type: "BROKEN_WORD_WITH_SPACE",

            confidence: "MEDIUM",

            note: "Possible word split by PDF/OCR line wrapping; may also be legitimate hyphenation and requires review."

        });

    }

    // 3. Highly suspicious OCR/PDF word splits without spaces.
    // Examples: pati-ent, vomiti-ng, condi-tion.
    // Intentionally conservative to avoid flagging legitimate hyphenated words.
    const suspiciousBrokenWord =
        /\b[A-Za-z]{4,}-(?:ng|ent|tion|sion|ment|emia|uria|osis|pathy)\b/gi;

    const brokenMatches = [...text.matchAll(suspiciousBrokenWord)];

    brokenMatches.forEach(match => {
        addFinding({
            question,
            field,
            original: text,
            detected: match[0],
            category: "REVIEW",
            type: "POSSIBLE_BROKEN_WORD",
            confidence: "MEDIUM",
            note: "Likely OCR/PDF word split detected. Manual review required."
        });
    });

  // 4. Multiple spaces
  if (/ {2,}/.test(text)) {
    addFinding({
      question,
      field,
      original: text,
      category: "SAFE",
      type: "MULTIPLE_SPACES",
      confidence: "HIGH",
      note: "Multiple consecutive spaces detected."
    });
  }

  // 5. Space before punctuation
  if (/\s+[,.!?;:]/.test(text)) {
    addFinding({
      question,
      field,
      original: text,
      category: "SAFE",
      type: "SPACE_BEFORE_PUNCTUATION",
      confidence: "HIGH",
      note: "Whitespace found immediately before punctuation."
    });
  }

  // 6. Possible missing space after punctuation
  if (/[,.!?;:][A-Za-z]/.test(text)) {
    addFinding({
      question,
      field,
      original: text,
      category: "REVIEW",
      type: "MISSING_SPACE_AFTER_PUNCTUATION",
      confidence: "MEDIUM",
      note: "May be punctuation followed by missing whitespace."
    });
  }

  // 7. Temperature formatting likely damaged by OCR:
  // 39,2o C   37,6oC   34,5o C
  if (/\b\d{2,3}[,.]\d+\s*[o°]\s*C\b/i.test(text)) {
    addFinding({
      question,
      field,
      original: text,
      category: "REVIEW",
      type: "TEMPERATURE_FORMAT",
      confidence: "HIGH",
      note: "Possible OCR corruption in temperature notation."
    });
  }

  // 8. Vitamin B12 spacing:
  // B 12, B 12-deficiency
  if (/\bB\s+12\b/i.test(text)) {
    addFinding({
      question,
      field,
      original: text,
      category: "SAFE",
      type: "B12_SPACING",
      confidence: "HIGH",
      note: "Vitamin B12 appears split by OCR spacing."
    });
  }

  // 9. Simple gas notation:
  // O 2, CO 2, C O 2
  if (
    /\bO\s+2\b/i.test(text) ||
    /\bC\s+O\s+2\b/i.test(text) ||
    /\bCO\s+2\b/i.test(text)
  ) {
    addFinding({
      question,
      field,
      original: text,
      category: "REVIEW",
      type: "GAS_NOTATION",
      confidence: "MEDIUM",
      note: "Possible OCR spacing problem in O2/CO2 notation."
    });
  }

  // 10. Other scientific notation likely damaged by OCR:
  // H C O 3, N a +, C a 2+, M g 2+
  if (
    /\bH\s+C\s+O\s+3\b/i.test(text) ||
    /\bN\s+a\s*[+\-]?\b/i.test(text) ||
    /\bC\s+a\s*\d*\s*[+\-]?\b/i.test(text) ||
    /\bM\s+g\s*\d*\s*[+\-]?\b/i.test(text)
  ) {
    addFinding({
      question,
      field,
      original: text,
      category: "REVIEW",
      type: "SCIENTIFIC_NOTATION",
      confidence: "MEDIUM",
      note: "Possible OCR spacing problem in medical/scientific notation."
    });
  }

    // Suspicious uppercase letters inside lowercase words.
    // Typical PDF/OCR corruption: insufFIciency, signiFIcant, FIltration.
    const suspiciousInternalCaps =
        /\b[A-Za-z]*[a-z][A-Z]{2,}[a-zA-Z]*\b/g;

    const internalCapsMatches = text.match(suspiciousInternalCaps) || [];

    internalCapsMatches.forEach(match => {
        addFinding({
            question,
            field,
            original: text,
            detected: match,
            category: "REVIEW",
            type: "OCR_CASE_CORRUPTION",
            confidence: "HIGH",
            note: "Suspicious uppercase sequence inside a word; possible PDF/OCR corruption."
        });
    });

    // Targeted OCR / Unicode confusables.
    // Detect only characters that we have actually observed
    // as suspicious in the KROK dataset.

    // Detect Cyrillic characters only when mixed with Latin characters
    // inside the same token.
    // Examples to flag:
    //   Н2-histamine
    //   apoА
    //
    // Pure Cyrillic/Ukrainian words such as:
    //   крок
    //   англомовний
    // are NOT OCR confusables.

    const mixedScriptTokens =
        text.match(/[A-Za-zА-Яа-яІіЇїЄєҐґ0-9-]+/g) || [];

    mixedScriptTokens.forEach(token => {
        const hasLatin = /[A-Za-z]/.test(token);
        const hasCyrillic = /[А-Яа-яІіЇїЄєҐґ]/.test(token);

        if (hasLatin && hasCyrillic) {
            addFinding({
                question,
                field,
                original: text,
                detected: token,
                category: "REVIEW",
                type: "CYRILLIC_CONFUSABLE",
                confidence: "HIGH",
                note: "Mixed Latin/Cyrillic token detected; possible visually confusable OCR character."
            });
        }
    });

    // Known OCR corruption: ß used where letters such as 'fl' may have been damaged.
    // Example observed: ßow.
    if (text.includes("ß")) {
        addFinding({
            question,
            field,
            original: text,
            detected: "ß",
            category: "REVIEW",
            type: "OCR_CHARACTER_CORRUPTION",
            confidence: "HIGH",
            note: "Suspicious OCR character detected."
        });
    }

    // Known lexical anomalies observed during manual validation.
    // Detection only: no automatic correction yet.
    const knownTypos = {
        miocardial: "myocardial",
        pumbing: "pumping",
        filtartion: "filtration",
        uconscious: "unconscious",
        conten: "content"
    };

    Object.entries(knownTypos).forEach(([wrong, suggestion]) => {
        const typoRegex = new RegExp(`\\b${wrong}\\b`, "gi");
        const matches = text.match(typoRegex) || [];

        matches.forEach(match => {
            addFinding({
                question,
                field,
                original: text,
                detected: match,
                proposed: suggestion,
                category: "REVIEW",
                type: "KNOWN_LEXICAL_TYPO",
                confidence: "HIGH",
                note: "Known lexical anomaly identified during manual validation."
            });
        });
    });

    // Possible missing numeric clinical value.
    // Example: "clearance of ml/min" where the number seems lost.
    const missingClinicalValuePatterns = [
        /\bof\s+(?:ml\/min|mm\s*Hg|mmol\/l|g\/l|bpm|\/min)\b/i
    ];

    missingClinicalValuePatterns.forEach(pattern => {
        if (pattern.test(text)) {
            addFinding({
                question,
                field,
                original: text,
                detected: text.match(pattern)?.[0] ?? "",
                category: "MEDICAL REVIEW",
                type: "POSSIBLE_MISSING_CLINICAL_VALUE",
                confidence: "HIGH",
                note: "A clinical unit appears without an associated numeric value. Source verification required."
            });
        }
    });

    const additionalBrokenWordPatterns = [
        /\bprimari-ly\b/gi,
        /\bwi-th\b/gi,
        /\badmini-stered\b/gi,
        /\bsuppressi-on\b/gi,
        /\bhospiali-zed\b/gi
    ];

    additionalBrokenWordPatterns.forEach(pattern => {
        const matches = text.match(pattern) || [];

        matches.forEach(match => {
            addFinding({
                question,
                field,
                original: text,
                detected: match,
                category: "REVIEW",
                type: "POSSIBLE_BROKEN_WORD",
                confidence: "HIGH",
                note: "Known OCR/PDF hyphenation pattern detected."
            });
        });
    });


  // 12. SOURCE_CONTAMINATION (FLAG ONLY)
  const sourceContaminationPattern = /(?:MSQ\s+(?:Krok|Крок))|(?:(?:Krok|Крок)\s+\d+\s+Medicine)|(?:(?:Krok|Крок).*?\d{4}-\d{4})/i;
  
  if (sourceContaminationPattern.test(text)) {
    let cat = "MEDICAL REVIEW";
    if (field === "topic") {
      cat = "HUMAN REVIEW";
    }
    
    addFinding({
      question,
      field,
      original: text,
      detected: text.match(sourceContaminationPattern)[0],
      category: cat,
      type: "SOURCE_CONTAMINATION",
      confidence: "HIGH",
      note: "High-confidence source/exam metadata detected."
    });
  }

  // 13. EXPLICIT MEDICAL FINDINGS (FLAG ONLY)
  if (question.id === 412 && field === "question" && text.includes("Hb Ale")) {
    addFinding({
      question,
      field,
      original: text,
      detected: "Hb Ale",
      category: "MEDICAL REVIEW",
      type: "SUSPICIOUS_MEDICAL_NOTATION",
      confidence: "HIGH",
      note: "Suspicious medical notation containing 'Hb Ale'."
    });
  }

  if (question.id === 2272 && field === "question" && text.includes("Which of the following phases most likely takes")) {
    addFinding({
      question,
      field,
      original: text,
      detected: "Which of the following phases most likely takes",
      category: "MEDICAL REVIEW",
      type: "TRUNCATED_STEM",
      confidence: "HIGH",
      note: "Abruptly truncated stem."
    });
  }

  // 11. Suspicious isolated answer placeholder

  if (/^\s*[-–—]\s*$/.test(text)) {
    addFinding({
      question,
      field,
      original: text,
      category: "MEDICAL REVIEW",
      type: "EMPTY_OR_PLACEHOLDER_OPTION",
      confidence: "HIGH",
      note: "Answer option appears to contain only a dash."
    });
  }
}

pilot.forEach(question => {
  inspectText(
    question,
    "question",
    question.question
  );

  inspectText(
    question,
    "topic",
    question.topic
  );

  if (Array.isArray(question.answers)) {
    question.answers.forEach((answer, index) => {
      inspectText(
        question,
        `answer_${index + 1}`,
        answer
      );
    });
  }
});

function csvEscape(value) {
  const str = String(value ?? "");

  if (
    str.includes(",") ||
    str.includes("\"") ||
    str.includes("\n")
  ) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }

  return str;
}

const headers = [
  "id",
  "year",
  "subject",
  "field",
  "original",
  "detected",
  "proposed",
  "category",
  "type",
  "confidence",
  "source",
  "status",
  "note"
];

const csv = [
  headers.join(","),
  ...findings.map(row =>
    headers.map(header =>
      csvEscape(row[header])
    ).join(",")
  )
].join("\n");

fs.writeFileSync(
  OUTPUT_FILE,
  csv,
  "utf8"
);

console.log("");
console.log("KROK Database Audit");
console.log("-------------------");
console.log(`Questions analysed: ${pilot.length}`);
console.log(`Findings: ${findings.length}`);

const safe = findings.filter(
  f => f.category === "SAFE"
).length;

const review = findings.filter(
  f => f.category === "REVIEW"
).length;

const medical = findings.filter(
  f => f.category === "MEDICAL REVIEW"
).length;

console.log(`SAFE: ${safe}`);
console.log(`REVIEW: ${review}`);
console.log(`MEDICAL REVIEW: ${medical}`);

console.log("");
console.log("Findings by type");
console.log("----------------");

const byType = {};

findings.forEach(finding => {
  byType[finding.type] = (byType[finding.type] || 0) + 1;
});

Object.entries(byType)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(`${type}: ${count}`);
  });

console.log("");
console.log(`Report created: ${OUTPUT_FILE}`);

