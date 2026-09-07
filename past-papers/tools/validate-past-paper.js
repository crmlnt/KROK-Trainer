const fs = require('fs');

const [, , jsonPath, expectedCountArg] = process.argv;

if (!jsonPath || !expectedCountArg) {
  console.error("Usage: node validate-past-paper.js <json-path> <expected-count>");
  process.exit(1);
}

const expectedCount = parseInt(expectedCountArg, 10);
let data;

try {
  const fileContent = fs.readFileSync(jsonPath, 'utf-8');
  data = JSON.parse(fileContent);
} catch (error) {
  console.error("❌ Failed to parse JSON:", error.message);
  process.exit(1);
}

const questions = data.questions;

if (!Array.isArray(questions)) {
  console.error("❌ Invalid format: 'questions' is not an array.");
  process.exit(1);
}

let hasError = false;

if (questions.length !== expectedCount) {
  console.error(`❌ Expected ${expectedCount} questions, but found ${questions.length}.`);
  hasError = true;
}

const seenNumbers = new Set();
let previousNumber = 0;

for (let i = 0; i < questions.length; i++) {
  const q = questions[i];
  
  if (typeof q.number !== 'number') {
    console.error(`❌ Question at index ${i} is missing a valid 'number'.`);
    hasError = true;
  } else {
    if (seenNumbers.has(q.number)) {
      console.error(`❌ Duplicate question number found: ${q.number}`);
      hasError = true;
    }
    seenNumbers.add(q.number);
    
    if (q.number !== previousNumber + 1) {
      console.error(`❌ Non-sequential question number: expected ${previousNumber + 1}, found ${q.number}`);
      hasError = true;
    }
    previousNumber = q.number;
  }
  
  if (typeof q.question !== 'string' || q.question.trim().length === 0) {
    console.error(`❌ Question ${q.number || 'at index '+i} has empty or missing text.`);
    hasError = true;
  }
  
  if (!Array.isArray(q.answers) || q.answers.length !== 5) {
    console.error(`❌ Question ${q.number} does not have exactly 5 answers.`);
    hasError = true;
  } else {
    q.answers.forEach((ans, ansIdx) => {
      if (typeof ans !== 'string' || ans.trim().length === 0) {
        console.error(`❌ Question ${q.number} has empty text for answer index ${ansIdx}.`);
        hasError = true;
      }
    });
  }
  
  if (typeof q.correct !== 'number' || q.correct < 0 || q.correct > 4) {
    console.error(`❌ Question ${q.number} has invalid correct index: ${q.correct}. Must be 0-4.`);
    hasError = true;
  }
}

if (hasError) {
  console.error("\nValidation failed with errors. ❌");
  process.exit(1);
} else {
  console.log("Validation passed successfully! ✅");
  process.exit(0);
}
