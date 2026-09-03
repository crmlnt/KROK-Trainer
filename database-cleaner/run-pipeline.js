const { spawnSync } = require("child_process");
const path = require("path");

const CLEANER_DIR = __dirname;

const steps = [
  {
    name: "Apply authorized SAFE corrections",
    script: "apply-safe-corrections.js"
  },
  {
    name: "Verify cleaned database",
    script: "verify-cleaned.js"
  }
];

console.log("");
console.log("KROK Database Cleaner");
console.log("=====================");
console.log("");

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];

  console.log(
    `${i + 1}. ${step.name}`
  );

  console.log(
    "-".repeat(step.name.length + 3)
  );

  const scriptPath = path.join(
    CLEANER_DIR,
    step.script
  );

  const result = spawnSync(
    process.execPath,
    [scriptPath],
    {
      stdio: "inherit",
      cwd: path.dirname(CLEANER_DIR)
    }
  );

  if (result.error) {
    console.error("");
    console.error(
      `PIPELINE ERROR: ${result.error.message}`
    );

    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("");
    console.error(
      `PIPELINE ABORTED at step ${i + 1}: ${step.name}`
    );

    console.error(
      "No later pipeline steps were executed."
    );

    process.exit(
      result.status || 1
    );
  }

  console.log("");
  console.log(
    `✓ Step ${i + 1} passed`
  );

  console.log("");
}

console.log(
  "================================"
);

console.log(
  "✓ KROK CLEANING PIPELINE PASSED"
);

console.log(
  "================================"
);

console.log("");
console.log(
  "questions.cleaned.json was regenerated"
);

console.log(
  "and verified against the authorized"
);

console.log(
  "SAFE correction plan."
);

console.log("");