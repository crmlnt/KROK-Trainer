// Dynamic subject support for Exam Mode.
// Loaded after app.js so KROK 1 can use the real subject names
// coming directly from questions.json while preserving old exam URLs.

window.startExamFromUrl = function (params) {
  examSessionLog = [];
  examMode = true;
  reviewMode = false;

  const homeBtn = document.getElementById("homeBtn");

  if (homeBtn) {
    homeBtn.classList.add("exit-exam-btn");

    homeBtn.innerHTML = `
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10 17l5-5-5-5"></path>
        <path d="M15 12H3"></path>
        <path d="M21 19V5a2 2 0 0 0-2-2h-6"></path>
      </svg>

      <span>Exit Exam</span>
    `;
  }

  const subjectControls =
    document.getElementById("subjectFilter")?.closest(".controls");

  if (subjectControls) {
    subjectControls.style.display = "none";
  }

  const tutorialBtn = document.querySelector(
    'button[onclick*="guide.html"]'
  );

  if (tutorialBtn) {
    tutorialBtn.style.display = "none";
  }

  const practiceTools = document.getElementById("practice-tools");

  if (practiceTools) {
    practiceTools.style.display = "none";
  }

  const selectedTopic = params.get("topic");
  const selectedQuestionCount = params.get("questions");
  const examType = params.get("exam") || "krok1";

  let filteredQuestions;

  if (!selectedTopic || selectedTopic === "all") {
    filteredQuestions = [...allQuestions];
  } else {
    const legacyKrok1Topics = {
      "normal-physiology": "Normal Phisiology",
      "pathophysiology": "Pathophysiology",
      "pathomorphology": "Pathomorphology",
      "pharmacology": "Pharmacology",
      "histology": "Histology"
    };

    const subjectName =
      examType === "krok2"
        ? selectedTopic
        : (legacyKrok1Topics[selectedTopic] || selectedTopic);

    filteredQuestions = allQuestions.filter(
      question => question.subject === subjectName
    );
  }

  const uniqueQuestions =
    removeDuplicateQuestions(filteredQuestions);

  if (uniqueQuestions.length === 0) {
    alert("No questions found for this subject.");
    return;
  }

  let examCount;

  if (
    !selectedQuestionCount ||
    selectedQuestionCount === "all"
  ) {
    examCount = uniqueQuestions.length;
  } else {
    examCount = Number(selectedQuestionCount);
  }

  if (!examCount || examCount <= 0) {
    alert("Invalid number of questions.");
    return;
  }

  examCount = Math.min(
    examCount,
    uniqueQuestions.length
  );

  questions = shuffleArray(uniqueQuestions)
    .slice(0, examCount);

  startExamTimer(questions.length);

  currentQuestionIndex = 0;
  score = 0;
  correctAnswers = 0;
  wrongAnswers = 0;
  answered = false;

  scoreText.textContent = "Score: 0";
  feedback.textContent = "";

  nextBtn.style.display = "none";
  reviewBtn.style.display = "none";

  updateStats();
  showQuestion();
};