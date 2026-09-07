const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const [, , pdfPath, yearArg, outputPath] = process.argv;

if (!pdfPath || !yearArg || !outputPath) {
  console.error("Usage: node parse-past-paper.js <pdf-path> <year> <output-path>");
  process.exit(1);
}

const year = parseInt(yearArg, 10);

async function parsePdf() {
  const dataBuffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: dataBuffer });
  const result = await parser.getText();
  const text = result.text;

  // Normalise line endings and clear form feeds
  const lines = text.replace(/\f/g, '\n').replace(/\r\n/g, '\n').split('\n');

  let currentQuestion = null;
  const questions = [];
  
  let state = 0; // 0=none, 1=Q, 2=A, 3=B, 4=C, 5=D, 6=E
  
  const finishQuestion = () => {
    if (currentQuestion && currentQuestion.options && currentQuestion.options.E) {
      currentQuestion.answers = [
        currentQuestion.options.A.trim(),
        currentQuestion.options.B.trim(),
        currentQuestion.options.C.trim(),
        currentQuestion.options.D.trim(),
        currentQuestion.options.E.trim()
      ];
      delete currentQuestion.options;
      currentQuestion.question = currentQuestion.question.trim();
      questions.push(currentQuestion);
    }
  };

  const isHeaderFooter = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // skip blank lines naturally
    if (/^\d+$/.test(trimmed)) return true;
    if (/^Krok\s*1\s*Medicine/i.test(trimmed)) return true;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(trimmed)) return true;
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    if (line.includes("INSTRUCTIONAL BOOK")) {
      break;
    }
    
    if (isHeaderFooter(line)) continue;
    
    const qMatch = line.match(/^(\d+)\.\s+(.*)/);
    // If we match a question number and we are either not tracking one, or we finished reading E
    if (qMatch && (state === 0 || state === 6)) {
      finishQuestion();
      currentQuestion = {
        number: parseInt(qMatch[1], 10),
        question: qMatch[2],
        options: {},
        correct: 0
      };
      state = 1;
      continue;
    }

    const fallbackMatch = line.match(/^G\s+(.+)/);
    if (currentQuestion && 
        currentQuestion.options.A !== undefined && 
        currentQuestion.options.B !== undefined && 
        currentQuestion.options.C === undefined && 
        currentQuestion.options.D === undefined && 
        fallbackMatch) {
      state = 4;
      currentQuestion.options['C'] = fallbackMatch[1];
      continue;
    }

    const optMatch = line.match(/^([A-E])\s*\.\s+(.*)/);
    if (optMatch && currentQuestion) {
      const optLetter = optMatch[1];
      if (optLetter === 'A') state = 2;
      else if (optLetter === 'B') state = 3;
      else if (optLetter === 'C') state = 4;
      else if (optLetter === 'D') state = 5;
      else if (optLetter === 'E') state = 6;
      
      currentQuestion.options[optLetter] = optMatch[2];
      continue;
    }

    // Continuation of the current block
    if (currentQuestion) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (state === 1) {
        currentQuestion.question += " " + trimmed;
      } else if (state === 2) {
        currentQuestion.options.A += " " + trimmed;
      } else if (state === 3) {
        currentQuestion.options.B += " " + trimmed;
      } else if (state === 4) {
        currentQuestion.options.C += " " + trimmed;
      } else if (state === 5) {
        currentQuestion.options.D += " " + trimmed;
      } else if (state === 6) {
        currentQuestion.options.E += " " + trimmed;
      }
    }
  }
  
  finishQuestion();

  const output = {
    exam: "KROK 1 Medicine",
    year: year,
    language: "English",
    sourceType: "past-paper",
    questions: questions
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Parsed ${questions.length} questions from ${pdfPath}`);
}

parsePdf().catch(console.error);
