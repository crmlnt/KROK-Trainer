const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../..");

const files = [
  "exports/pathophysiology.json",
  "exports/pathomorphology.json",
  "exports/normal-phisiology.json",
  "exports/Microbiology.json",
  "exports/normal-anatomy.json",
  "exports/pharmacology.json",
  "exports/biology.json",
  "exports/histology.json",
  "exports/biochemistry.json"
];

let allQuestions = [];

files.forEach((file) => {
  const data = fs.readFileSync(path.join(root, file), "utf8");
  const questions = JSON.parse(data);

  allQuestions = allQuestions.concat(questions);
});

allQuestions = allQuestions.map((question, index) => {
  return {
    ...question,
    id: index + 1
  };
});

const candidate = JSON.stringify(allQuestions, null, 2);
require("../question-identity/build-gate").validateBuild(1, candidate);
fs.writeFileSync(path.join(root, "questions.json"), candidate);

console.log(`${allQuestions.length} total questions merged into questions.json`);