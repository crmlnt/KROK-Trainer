
//VARIABLES
let questions = [];
let allQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let errors = JSON.parse(localStorage.getItem("errors")) || [];
let answered = false;
let reviewMode = false;
let correctAnswers = 0;
let wrongAnswers = 0;
let examMode = false;
let examSessionLog = [];
let reviewExamIndex = 0;
let examTimerInterval = null;
let examTimeRemaining = 0;
let aiUserAnswer = null;
let aiExplanationLoaded = false;
let selectedAnswerButton = null;
let selectedAnswerIsCorrect = null;

// HTML ELEMENTS

//const examQuestionCount = 3;
const questionNumber = document.getElementById("question-number");
const questionText = document.getElementById("question-text");
const subjectDisplay = document.getElementById("subject-display");
const answersContainer = document.getElementById("answers-container");
const feedback = document.getElementById("feedback");
const scoreText = document.getElementById("score");
const nextBtn = document.getElementById("next-btn");
//const progressBar = document.getElementById("progress-bar");
const errorLog = document.getElementById("error-log");
const errorCount = document.getElementById("error-count");
const reviewBtn = document.getElementById("review-btn");
const clearErrorsBtn = document.getElementById("clear-errors-btn");
const statsText = document.getElementById("stats");
const progressBar = document.getElementById("progressBar");
const statsBtn = document.getElementById("stats-btn");
const themeBtn = document.getElementById("theme-btn");
const exportErrorsBtn = document.getElementById("export-errors-btn");
const reviewExamBtn = document.getElementById("reviewExamBtn");
const prevReviewBtn = document.getElementById("prevReviewBtn");
const nextReviewBtn = document.getElementById("nextReviewBtn");
const examTimer = document.getElementById("examTimer");
const examTimerText = document.getElementById("examTimerText");


if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark-mode");
}

//FUNCTIONS

async function saveExamSession() {

  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    console.log(
      "Local development: exam session not saved to Supabase."
    );
    return;
  }
  
  try {
    const {
      data: { user }
    } = await supabaseClient.auth.getUser();

    // Se l'utente non è loggato,
    // l'esame continua normalmente ma non viene salvato.
    if (!user) {
      console.log("Exam not saved: user is not logged in.");
      return;
    }

    const params = new URLSearchParams(window.location.search);

    const examType = params.get("exam") || "krok1";
    const topic = params.get("topic") || "all";

    const krokNumber =
      examType === "krok2" ? 2 : 1;

    const accuracy =
      Math.round(
        (correctAnswers / questions.length) * 100
      );

    let subject = topic;

    // Nomi leggibili per KROK 1
    const krok1TopicNames = {
      "all": "All Topics",
      "normal-physiology": "Normal Physiology",
      "pathophysiology": "Pathophysiology",
      "pathomorphology": "Pathomorphology",
      "pharmacology": "Pharmacology",
      "histology": "Histology"
    };

    if (krokNumber === 1) {
      subject = krok1TopicNames[topic] || topic;
    }

    if (krokNumber === 2 && topic === "all") {
      subject = "All Topics";
    }

    const { error } = await supabaseClient
      .from("exam_sessions")
      .insert({
        user_id: user.id,
        krok: krokNumber,
        mode: "exam",
        subject: subject,
        questions_total: questions.length,
        correct: correctAnswers,
        wrong: wrongAnswers,
        score: accuracy
      });

    if (error) {
      console.error("Error saving exam session:", error);
      return;
    }

    console.log("Exam session saved successfully.");

  } catch (error) {
    console.error("Unexpected error saving exam:", error);
  }
}



async function loadQuestions() {
  const params = new URLSearchParams(window.location.search);

  const examType = params.get("exam") || "krok1";

  const questionFile =
    examType === "krok2"
      ? "krok2/questions-krok2.json"
      : "questions.json";

  const response = await fetch(questionFile);

  const text = await response.text();

  console.log(text);

  allQuestions = JSON.parse(text);
  console.log(
  "Subjects found:",
  [...new Set(allQuestions.map(q => q.subject))]
  );

  populateSubjectFilter();

  if (params.get("mode") === "exam") {
    startExamFromUrl(params);
  } else {
    questions = [...allQuestions];
    questions = shuffleArray(questions);

    const questionParam = params.get("question");
    if (questionParam) {
      const rawId = questionParam.trim();
      let normalizedId = null;

      if (examType === "krok2") {
        if (/^krok2-\d+$/i.test(rawId)) {
          normalizedId = rawId.toLowerCase();
        } else if (/^\d+$/.test(rawId)) {
          normalizedId = `krok2-${rawId.padStart(4, "0")}`;
        }
      } else {
        if (/^krok1-\d+$/i.test(rawId)) {
          normalizedId = String(parseInt(rawId.slice(6), 10));
        } else if (/^\d+$/.test(rawId)) {
          normalizedId = String(parseInt(rawId, 10));
        }
      }

      if (normalizedId !== null) {
        const targetQuestion = allQuestions.find(
          q => String(q.id).toLowerCase() === normalizedId
        );

        if (targetQuestion) {
          const targetIndex = questions.indexOf(targetQuestion);
          if (targetIndex > -1) {
            questions.splice(targetIndex, 1);
          }
          questions.unshift(targetQuestion);
        }
      }
    }

    showQuestion();
  }
}

function removeDuplicateQuestions(questionList) {
  const seen = new Set();

  return questionList.filter(q => {
    const normalizedQuestion = q.question.trim().toLowerCase();

    if (seen.has(normalizedQuestion)) {
      return false;
    }

    seen.add(normalizedQuestion);
    return true;
  });
}

function populateSubjectFilter() {
  const subjectFilter = document.getElementById("subjectFilter");

  subjectFilter.options[0].textContent =
  `All Subjects (${allQuestions.length})`;

  const subjectCounts = {};

  allQuestions.forEach(q => {
    const subject = q.subject || "Unknown";

    if (!subjectCounts[subject]) {
      subjectCounts[subject] = 0;
    }

    subjectCounts[subject]++;
  });

  const subjects = Object.keys(subjectCounts).sort();

  subjects.forEach(subject => {
    const option = document.createElement("option");

    option.value = subject;
    option.textContent = `${subject} (${subjectCounts[subject]})`;

    subjectFilter.appendChild(option);
  });
}

function showQuestion() {
  answered = false;
  aiUserAnswer = null;
  selectedAnswerButton = null;
  selectedAnswerIsCorrect = null;
  aiExplanationLoaded = false;

const confirmAnswerBtn =

    document.getElementById("confirmAnswerBtn");



  if (confirmAnswerBtn) {

    confirmAnswerBtn.style.display = "none";

  }


  feedback.textContent = "";
  answersContainer.innerHTML = "";

  const aiExplainBtn = document.getElementById("aiExplainBtn");

  if (aiExplainBtn) {
    aiExplainBtn.style.display = "none";
    aiExplainBtn.textContent = "✨ AI Explain";
  }

  const aiExplanationBox =
    document.getElementById("aiExplanationBox");

  const aiExplanationContent =
    document.getElementById("aiExplanationContent");

  if (aiExplanationBox) {
    aiExplanationBox.style.display = "none";
  }

  if (aiExplanationContent) {
    aiExplanationContent.textContent =
      "Loading explanation...";
  }

  nextBtn.style.display = "none";
  reviewBtn.style.display = "none";
  reviewExamBtn.style.display = "none";
  prevReviewBtn.style.display = "none";
  nextReviewBtn.style.display = "none";

  hideExportActions();

  const currentQuestion = questions[currentQuestionIndex];
  subjectDisplay.textContent =
  `Subject: ${currentQuestion.subject}`;

  questionNumber.textContent = `Question ${currentQuestionIndex + 1} of ${questions.length}`;
  questionText.textContent = currentQuestion.question;

  //progressBar.value =
   // ((currentQuestionIndex + 1) / questions.length) * 100;

  const shuffledAnswers = currentQuestion.answers.map((answer, index) => {
    return {
      text: answer,
      isCorrect: index === currentQuestion.correct
    };
  });

  shuffledAnswers.sort(() => Math.random() - 0.5);

  shuffledAnswers.forEach((answer) => {
    const button = document.createElement("button");
    button.textContent = answer.text;
    button.classList.add("answer-btn");

    
      button.addEventListener("click", () => {

        if (answered) return;

        document
          .querySelectorAll(".answer-btn")
          .forEach(btn => btn.classList.remove("selected"));

        button.classList.add("selected");

        selectedAnswerButton = button;
        selectedAnswerIsCorrect = answer.isCorrect;

        const confirmAnswerBtn =
          document.getElementById("confirmAnswerBtn");

        if (confirmAnswerBtn) {
          confirmAnswerBtn.style.display = "block";
        }

      });
    
    
    answersContainer.appendChild(button);
  });
  updateProgressBar();
}

function startExamTimer(questionCount) {
  console.log("TIMER STARTED", questionCount);

  // 1 minute per question
  examTimeRemaining = questionCount * 60;

  examTimer.style.display = "block";

  updateExamTimerDisplay();

  if (examTimerInterval) {
    clearInterval(examTimerInterval);
  }

  examTimerInterval = setInterval(() => {

    examTimeRemaining--;

    updateExamTimerDisplay();

    if (examTimeRemaining <= 0) {
      examTimeRemaining = 0;
      clearInterval(examTimerInterval);
      examTimerInterval = null;

      finishExamByTimer();
    }

  }, 1000);
}


function updateExamTimerDisplay() {

  const hours = Math.floor(examTimeRemaining / 3600);

  const minutes = Math.floor(
    (examTimeRemaining % 3600) / 60
  );

  const seconds = examTimeRemaining % 60;

  examTimerText.textContent =
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`;
}

function stopExamTimer() {
  if (examTimerInterval) {
    clearInterval(examTimerInterval);
    examTimerInterval = null;
  }
    examTimer.style.display = "none";
    console.log("TIMER STOPPED AT:", examTimeRemaining);
}

function finishExamByTimer() {

  const unanswered =
    questions.length - correctAnswers - wrongAnswers;

  wrongAnswers += unanswered;

  currentQuestionIndex = questions.length - 1;

  examTimer.style.display = "none";

  nextBtn.click();
}

function checkAnswer(button, isCorrect) {
  if (answered) return;

  answered = true;
  aiUserAnswer = button.textContent;

  const allButtons = document.querySelectorAll(".answer-btn");
  const currentQuestion = questions[currentQuestionIndex];

  saveSubjectStats(currentQuestion.subject, isCorrect);


  // =========================
  // EXAM MODE
  // =========================

  

  if (examMode) {

    examSessionLog.push({
      date: new Date().toLocaleDateString(),
      id: currentQuestion.id,
      subject: currentQuestion.subject,
      question: currentQuestion.question,
      answers: currentQuestion.answers,
      yourAnswer: button.textContent,
      correctAnswer: currentQuestion.answers[currentQuestion.correct],
      result: isCorrect ? "Correct" : "Wrong"
    });

    button.classList.add("selected");

    // Update score internally
    if (isCorrect) {
      score++;
      correctAnswers++;
    } else {
      wrongAnswers++;
    }


    // No immediate feedback during exam
    feedback.textContent = "";

    // Do not show current score
    scoreText.textContent = "";

    // Allow user to continue
    nextBtn.style.display = "block";

    return;
  }

  // Remove temporary selection style before showing feedback
  allButtons.forEach((btn) => {
    btn.classList.remove("selected");
  });

  // =========================
  // PRACTICE MODE
  // =========================

  if (isCorrect) {

    button.classList.add("correct");

    feedback.textContent = "Correct!";

    score++;
    correctAnswers++;

    updateStats();

  } else {

    button.classList.add("wrong");

    feedback.textContent = "Wrong!";

    wrongAnswers++;

    updateStats();


    errors.push({
      date: new Date().toLocaleDateString(),
      subject: currentQuestion.subject,
      question: currentQuestion.question,
      answers: currentQuestion.answers,
      correct: currentQuestion.correct,
      yourAnswer: button.textContent,
      correctAnswer: currentQuestion.answers[currentQuestion.correct]
    });

    updateErrorLog();


    allButtons.forEach((btn) => {

      if (
        btn.textContent ===
        currentQuestion.answers[currentQuestion.correct]
      ) {
        btn.classList.add("correct");
      }

    });

  }

  const aiExplainBtn = document.getElementById("aiExplainBtn");

  if (aiExplainBtn) {
    aiExplainBtn.style.display = "inline-flex";
  }

  scoreText.textContent = `Score: ${score}`;

  nextBtn.style.display = "block";
}

function updateErrorLog() {
  localStorage.setItem("errors", JSON.stringify(errors));  
  errorCount.textContent = `Errors: ${errors.length}`;
  errorLog.innerHTML = "";

  errors.forEach((error) => {
    const li = document.createElement("li");

    li.textContent =
      `Q: ${error.question} | Your answer: ${error.yourAnswer} | Correct: ${error.correctAnswer}`;

    errorLog.appendChild(li);
  });
}

function updateStats() {

  const total = correctAnswers + wrongAnswers;

  let accuracy = 0;

  if (total > 0) {
    accuracy = Math.round((correctAnswers / total) * 100);
  }

  statsText.textContent =
    `Correct: ${correctAnswers} | Wrong: ${wrongAnswers} | Accuracy: ${accuracy}%`;
}

/*function startExamMode() {
  examMode = true;
  reviewMode = false;

  questions.sort(() => Math.random() - 0.5);
  questions = questions.slice(0, examQuestionCount);

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
}*/

function getFilteredQuestions() {
  const subjectFilter = document.getElementById("subjectFilter");

  if (!subjectFilter) {
    return [...allQuestions];
  }

  const selectedSubject = subjectFilter.value;

  if (selectedSubject === "all") {
    return [...allQuestions];
  }

  return allQuestions.filter(q => q.subject === selectedSubject);
}

function startExamMode() {
  examSessionLog = [];
  examMode = true;
  reviewMode = false;


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



  const filteredQuestions = getFilteredQuestions();
  const uniqueQuestions = removeDuplicateQuestions(filteredQuestions);


  if (uniqueQuestions.length === 0) {
    alert("No questions found for this subject.");
    return;
  }

  const userChoice = prompt(
    `How many questions? Choose 10, 20, 50, 100, 200 or All.`
  );

  let examCount;

  if (userChoice === null) {
    return;
  }

  if (userChoice.toLowerCase() === "all") {
    examCount = uniqueQuestions.length;
  } else {
    examCount = Number(userChoice);
  }

  if (!examCount || examCount <= 0) {
    alert("Please enter a valid number.");
    return;
  }

  if (examCount > uniqueQuestions.length) {
    examCount = uniqueQuestions.length;
  }

  questions = shuffleArray(uniqueQuestions).slice(0, examCount);

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
}

function startExamFromUrl(params) {
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


  document.getElementById("practice-tools").style.display = "none";

  const selectedTopic = params.get("topic");
  const selectedQuestionCount = params.get("questions");

  let filteredQuestions;

  // Select topic
  const examType = params.get("exam") || "krok1";

  if (!selectedTopic || selectedTopic === "all") {

    filteredQuestions = [...allQuestions];

  } else {

    let subjectName;

    if (examType === "krok2") {

      // In KROK 2 the URL contains the real subject name
      subjectName = selectedTopic;

    } else {

      // KROK 1 keeps the existing slug system
      const topicMap = {
        "normal-physiology": "Normal Phisiology",
        "pathophysiology": "Pathophysiology",
        "pathomorphology": "Pathomorphology",
        "pharmacology": "Pharmacology",
        "histology": "Histology"
      };

      subjectName = topicMap[selectedTopic];
    }

    filteredQuestions = allQuestions.filter(
      q => q.subject === subjectName
    );
  }

  // Remove duplicates
  const uniqueQuestions =
    removeDuplicateQuestions(filteredQuestions);

  if (uniqueQuestions.length === 0) {
    alert("No questions found for this subject.");
    return;
  }

  // Number of questions
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

  // Prevent requesting more questions than available
  examCount = Math.min(
    examCount,
    uniqueQuestions.length
  );

  // Prepare exam
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
}

function shuffleArray(array) {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));

    const temp = shuffled[i];
    shuffled[i] = shuffled[randomIndex];
    shuffled[randomIndex] = temp;
  }

  return shuffled;
}

function updateProgressBar() {
  if (!progressBar || questions.length === 0) return;

  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;


  progressBar.style.width = `${progress}%`;
}

function saveSubjectStats(subject, isCorrect) {
  const params = new URLSearchParams(window.location.search);
  const examType = params.get("exam") || "krok1";

  const storageKey =
    examType === "krok2"
      ? "krok2_subjectStats"
      : "krok1_subjectStats";

  const stats =
    JSON.parse(localStorage.getItem(storageKey)) || {};

  if (!stats[subject]) {
    stats[subject] = {
      correct: 0,
      wrong: 0
    };
  }

  if (isCorrect) {
    stats[subject].correct++;
  } else {
    stats[subject].wrong++;
  }

  localStorage.setItem(
    storageKey,
    JSON.stringify(stats)
  );
}

function showStatistics() {
  const params = new URLSearchParams(window.location.search);
  const examType = params.get("exam") || "krok1";

  const storageKey =
    examType === "krok2"
      ? "krok2_subjectStats"
      : "krok1_subjectStats";

  const stats =
    JSON.parse(localStorage.getItem(storageKey)) || {};

  if (Object.keys(stats).length === 0) {
    feedback.innerHTML = `
      <div class="exam-summary">
        <h2>Statistics</h2>
        <p>No statistics available yet.</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="exam-summary">
      <h2>Statistics Dashboard</h2>
  `;

  Object.keys(stats)
  .filter(subject => subject !== "Test")
  .map(subject => {
    const correct = stats[subject].correct;
    const wrong = stats[subject].wrong;
    const total = correct + wrong;
    const accuracy = Math.round((correct / total) * 100);

    return {
      subject,
      correct,
      wrong,
      total,
      accuracy
    };
  })
  .sort((a, b) => a.accuracy - b.accuracy)
  .forEach(item => {

    const subject = item.subject;
    const correct = item.correct;
    const wrong = item.wrong;
    const total = item.total;
    const accuracy = item.accuracy;

    html += `
      <hr>
      <p><strong>${subject}</strong></p>
      <p>Correct: ${correct}</p>
      <p>Wrong: ${wrong}</p>
      <p>Accuracy: ${accuracy}%</p>
    `;
  });

  html += `</div>`;

  questionNumber.textContent = "";
  subjectDisplay.textContent = "";
  questionText.textContent = "";
  answersContainer.innerHTML = "";
  nextBtn.style.display = "none";
  reviewBtn.style.display = "none";
  feedback.innerHTML = html;
}

function exportErrorLog() {
  if (errors.length === 0) {
    alert("No mistakes to export.");
    return;
  }

  let logText = "Date\tSubject\tQuestion\tYour Answer\tCorrect Answer\tNotes\n";

  errors.forEach(error => {
    logText += `${error.date || ""}\t${error.subject || ""}\t${error.question}\t${error.yourAnswer}\t${error.correctAnswer}\t\n`;
  });

  navigator.clipboard.writeText(logText);

  alert("Error log copied to clipboard!");
}

function exportExamLog() {
  if (examSessionLog.length === 0) {
    alert("No exam session data available.");
    return;
  }

  const headers = [
    "Date",
    "ID",
    "Subject",
    "Question",
    "Your Answer",
    "Correct Answer",
    "Result"
  ];

  const rows = examSessionLog.map(item => [
    item.date,
    item.id,
    item.subject,
    item.question,
    item.yourAnswer,
    item.correctAnswer,
    item.result
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map(row =>
      row.map(value =>
        `"${String(value).replace(/"/g, '""')}"`
      ).join(",")
    )
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `krok_exam_log_${new Date().toISOString().slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function goHome() {

  if (examMode) {
    const confirmExit = confirm(
      "Exit exam?\n\nYour current exam progress will be lost."
    );

    if (!confirmExit) {
      return;
    }
  }

  const params = new URLSearchParams(window.location.search);
  const examType = params.get("exam") || "krok1";

  if (examType === "krok2") {
    window.location.href = "krok2.html";
  } else {
    window.location.href = "krok1.html";
  }
}

function resetTrainer() {
  examMode = false;
  reviewMode = false;
  answered = false;

  currentQuestionIndex = 0;
  score = 0;
  correctAnswers = 0;
  wrongAnswers = 0;

  questions = shuffleArray(getFilteredQuestions());

  scoreText.textContent = "Score: 0";
  feedback.textContent = "";
  nextBtn.style.display = "none";
  reviewBtn.style.display = "none";

  updateStats();

  if (questions.length > 0) {
    showQuestion();
  } else {
    questionText.textContent = "No questions found for this subject.";
    questionNumber.textContent = "";
    subjectDisplay.textContent = "";
    answersContainer.innerHTML = "";
    updateProgressBar();
  }
}



function showExamResults() {

  const accuracy =
    Math.round((correctAnswers / questions.length) * 100);

  let result = "FAILED ❌";

  if (accuracy >= 60) {
    result = "PASSED ✅";
  }

  const params = new URLSearchParams(window.location.search);
  const examType = params.get("exam") || "krok1";

  const newExamUrl =
    examType === "krok2"
      ? "exam.html?exam=krok2"
      : "exam.html";

  const studyModeUrl =
    examType === "krok2"
      ? "krok2.html"
      : "krok1.html";

  document.querySelector(".quiz-card").style.display = "none";

  feedback.innerHTML = `
    <div class="exam-summary">

      <div class="exam-summary-icon">✓</div>

      <h2>Exam Completed</h2>

      <p class="exam-summary-subtitle">
        Your mock examination has been completed.
      </p>

      <div class="exam-score">
        <span class="exam-score-value">${accuracy}%</span>
        <span class="exam-score-label">Final Score</span>
      </div>

      <div class="exam-progress">
        <div
          class="exam-progress-fill"
          style="width: ${accuracy}%;">
        </div>
      </div>

      <div class="exam-results-grid">

        <div class="exam-result-item">
          <strong>${questions.length}</strong>
          <span>Questions</span>
        </div>

        <div class="exam-result-item correct-result">
          <strong>${correctAnswers}</strong>
          <span>Correct</span>
        </div>

        <div class="exam-result-item wrong-result">
          <strong>${wrongAnswers}</strong>
          <span>Wrong</span>
        </div>

      </div>

      <div class="exam-status">
        ${result}
      </div>

      <div class="exam-summary-actions">

        <a href="${newExamUrl}" class="exam-action-primary">
          Start New Exam
        </a>

        <a href="${studyModeUrl}" class="exam-action-secondary">
          Back to Study Mode
        </a>

        <a href="index.html" class="exam-action-link">
          Back to Exam Selection
        </a>

      </div>

      <button id="examToolsToggle" class="exam-tools-toggle">
        Review & Export ▼
      </button>

      <div
        id="examToolsPanel"
        class="exam-tools-panel"
        style="display: none;"
      >

      <button id="finalReviewExamBtn" class="exam-tool-card">
            <span class="exam-tool-icon">
              <svg viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </span>

          <span class="exam-tool-content">
            <strong>Review Exam</strong>
            <small>Review all questions from this exam</small>
          </span>
        </button>


        <button id="finalExportExamBtn" class="exam-tool-card">
          <span class="exam-tool-icon">
            <svg viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <path d="M14 2v6h6"/>
              <path d="M12 18v-6"/>
              <path d="m9 15 3 3 3-3"/>
            </svg>
          </span>

          <span class="exam-tool-content">
            <strong>Export Exam Log</strong>
            <small>Download full exam results (CSV)</small>
          </span>
        </button>


        <button id="finalExportErrorsBtn" class="exam-tool-card">
          <span class="exam-tool-icon">
            <svg viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true">
              <path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0z"/>
              <path d="M12 9v4"/>
              <path d="M12 17h.01"/>
            </svg>
          </span>

          <span class="exam-tool-content">
            <strong>Export Error Log</strong>
            <small>Download incorrect answers only (CSV)</small>
          </span>
        </button>


        <button id="finalClearErrorsBtn" class="exam-tool-danger">
          <span class="exam-tool-icon">
            <svg viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true">
              <path d="M3 6h18"/>
              <path d="M8 6V4h8v2"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v5"/>
              <path d="M14 11v5"/>
            </svg>
          </span>

          <span class="exam-tool-content">
            <strong>Clear Error Log</strong>
            <small>Remove all incorrect answers from the log</small>
          </span>
        </button>


      </div>

    </div>
  `;


  const examToolsToggle =
    document.getElementById("examToolsToggle");

  const examToolsPanel =
    document.getElementById("examToolsPanel");


  examToolsToggle.addEventListener("click", () => {

    const isOpen =
      examToolsPanel.style.display === "grid";

    examToolsPanel.style.display =
      isOpen ? "none" : "grid";

    examToolsToggle.textContent =
      isOpen
        ? "Review & Export ▼"
        : "Review & Export ▲";
  });


const finalReviewExamBtn =
  document.getElementById("finalReviewExamBtn");

finalReviewExamBtn.addEventListener(
  "click",
  startExamReview
);


const finalExportExamBtn =
  document.getElementById("finalExportExamBtn");

finalExportExamBtn.addEventListener(
  "click",
  exportExamLog
);


const finalExportErrorsBtn =
  document.getElementById("finalExportErrorsBtn");

finalExportErrorsBtn.addEventListener(
  "click",
  exportErrorLog
);


const finalClearErrorsBtn =
  document.getElementById("finalClearErrorsBtn");

finalClearErrorsBtn.addEventListener(
  "click",
  clearErrorLog
);

showExportActions();
reviewExamBtn.style.display = "block";

}




function startExamReview() {
  if (examSessionLog.length === 0) {
    alert("No exam data available for review.");
    return;
  }
  document.querySelector(".quiz-card").style.display = "block";
  reviewExamIndex = 0;
  showExamReviewQuestion();
}

function showExamReviewQuestion() {
  const item = examSessionLog[reviewExamIndex];

  questionNumber.textContent =
    `Review Question ${reviewExamIndex + 1} of ${examSessionLog.length}`;

  subjectDisplay.textContent =
    `Subject: ${item.subject} | ID: ${item.id}`;

  questionText.textContent = item.question;

  answersContainer.innerHTML = "";

  item.answers.forEach((answer) => {
    const answerDiv = document.createElement("div");
    answerDiv.classList.add("review-answer");

    answerDiv.textContent = answer;

    if (answer === item.correctAnswer) {
      answerDiv.classList.add("correct-review-answer");
    }

    if (answer === item.yourAnswer && item.result === "Wrong") {
      answerDiv.classList.add("wrong-review-answer");
    }

    answersContainer.appendChild(answerDiv);
  });

  feedback.innerHTML = `
    <div class="exam-review-result">
      <p><strong>Your answer:</strong> ${item.yourAnswer}</p>
      <p><strong>Correct answer:</strong> ${item.correctAnswer}</p>
      <p><strong>Result:</strong> ${item.result}</p>
    </div>

      <button
        id="backToExamResultsBtn"
        class="exam-action-secondary"
        type="button">
        ← Back to Exam Results
      </button>

  `;

  const backToExamResultsBtn =
    document.getElementById("backToExamResultsBtn");

  backToExamResultsBtn.addEventListener(
    "click",
    showExamResults
  );

  prevReviewBtn.style.display = reviewExamIndex > 0 ? "inline-block" : "none";
  nextReviewBtn.style.display = reviewExamIndex < examSessionLog.length - 1 ? "inline-block" : "none";

  nextBtn.style.display = "none";
  reviewExamBtn.style.display = "none";
}

function hideExportActions() {
  document.getElementById("export-errors-btn").style.display = "none";
  document.getElementById("exportExamLogBtn").style.display = "none";
  reviewBtn.style.display = "none";
  reviewExamBtn.style.display = "none";
}

function showExportActions() {
  document.getElementById("export-errors-btn").style.display = "inline-block";
  document.getElementById("exportExamLogBtn").style.display = "inline-block";

  if (errors.length > 0) {
    reviewBtn.style.display = "inline-block";
  }

  if (examSessionLog.length > 0) {
    reviewExamBtn.style.display = "inline-block";
  }
}

// EVEMT LISTENER


const subjectFilter = document.getElementById("subjectFilter");

subjectFilter.addEventListener("change", () => {
  if (examMode) return;

  resetTrainer();
});

reviewExamBtn.addEventListener("click", startExamReview);

reviewExamBtn.addEventListener("click", startExamReview);

document.getElementById("homeBtn").addEventListener("click", goHome);

exportErrorsBtn.addEventListener("click", exportErrorLog);

statsBtn.addEventListener("click", showStatistics);

prevReviewBtn.addEventListener("click", () => {
  if (reviewExamIndex > 0) {
    reviewExamIndex--;
    showExamReviewQuestion();
  }
});

nextReviewBtn.addEventListener("click", () => {
  if (reviewExamIndex < examSessionLog.length - 1) {
    reviewExamIndex++;
    showExamReviewQuestion();
  }
});

nextBtn.addEventListener("click", () => {
  currentQuestionIndex++;

  if (currentQuestionIndex < questions.length) {
    showQuestion();
  } else {
    if (examMode) {
      questionText.textContent = "";
    } else {
      questionText.textContent = "Quiz completed!";
    }

    questionNumber.textContent = "";
    answersContainer.innerHTML = "";
    if (examMode) {
    
    stopExamTimer();
    saveExamSession();
    showExamResults();

} else {

  feedback.textContent =
    `Final score: ${score} / ${questions.length}`;

}
    nextBtn.style.display = "none";

    if (errors.length > 0 && reviewMode === false) {
  reviewBtn.style.display = "block";
}
  }
});

const aiExplainBtn = document.getElementById("aiExplainBtn");

if (aiExplainBtn) {
  aiExplainBtn.addEventListener("click", async () => {

    const aiExplanationBox =
      document.getElementById("aiExplanationBox");

    const aiExplanationContent =
      document.getElementById("aiExplanationContent");

    if (aiExplanationLoaded) {
      aiExplanationBox.style.display = "block";
      return;
    }

    if (!aiExplanationBox || !aiExplanationContent) {
      return;
    }

    const currentQuestion =
      questions[currentQuestionIndex];

    if (!currentQuestion || !aiUserAnswer) {
      aiExplanationBox.style.display = "block";

      aiExplanationContent.textContent =
        "Unable to generate an explanation for this question.";

      return;
    }

    aiExplanationBox.style.display = "block";

    aiExplanationContent.textContent =
      "Loading explanation...";

    aiExplainBtn.disabled = true;

    try {

      const correctAnswer =
        currentQuestion.answers[currentQuestion.correct];

      const { data, error } =
        await supabaseClient.functions.invoke(
          "AI-Explain",
          {
            body: {
              question: currentQuestion.question,
              answers: currentQuestion.answers,
              correctAnswer: correctAnswer,
              userAnswer: aiUserAnswer,
              subject: currentQuestion.subject
            }
          }
        );

      if (error) {
        console.error(
          "AI Explain function error:",
          error
        );

        aiExplanationContent.textContent =
          "Unable to generate the explanation. Please try again.";

        return;
      }

      if (
        !data ||
        !data.correctReason ||
        !data.userAnswerFeedback ||
        !data.keyConcept
      ) {
        aiExplanationContent.textContent =
          "No explanation was returned.";

        return;
      }

      aiExplanationContent.innerHTML = `
          <div class="ai-section">
            <h4>✓ Why this answer is correct</h4>
            <p>${data.correctReason}</p>
          </div>

            <div class="ai-section">
              <h4>💭 Your answer</h4>
              <p>${data.userAnswerFeedback}</p>
            </div>

            <div class="ai-key-concept">
              <h4>💡 Key concept</h4>
              <p>${data.keyConcept}</p>
            </div>
          `;
      aiExplanationLoaded = true;
      aiExplainBtn.textContent = "✨ Show Explanation";

    } catch (error) {

      console.error(
        "Unexpected AI Explain error:",
        error
      );

      aiExplanationContent.textContent =
        "Unable to generate the explanation. Please try again.";

    } finally {

      aiExplainBtn.disabled = false;

    }
  });
}

const closeAiExplanation =
  document.getElementById("closeAiExplanation");

if (closeAiExplanation) {
  closeAiExplanation.addEventListener("click", () => {

    const aiExplanationBox =
      document.getElementById("aiExplanationBox");

    if (aiExplanationBox) {
      aiExplanationBox.style.display = "none";
    }

  });
}

reviewBtn.addEventListener("click", () => {
  questions = errors.map((error) => {
    return {
      question: error.question,
      answers: error.answers,
      correct: error.correct
    };
  });

  currentQuestionIndex = 0;
  score = 0;
  answered = false;
  reviewMode = true;

  scoreText.textContent = "Score: 0";

  showQuestion();
});


function clearErrorLog() {
  const confirmDelete = confirm(
    "Are you sure you want to delete the entire Error Log? This action cannot be undone."
  );

  if (!confirmDelete) {
    return;
  }

  errors = [];

  localStorage.removeItem("errors");

  updateErrorLog();

  alert("Error Log deleted.");
}

clearErrorsBtn.addEventListener("click", clearErrorLog);



themeBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");

  if (document.body.classList.contains("dark-mode")) {
    localStorage.setItem("theme", "dark");
  } else {
    localStorage.setItem("theme", "light");
  }
});

document
  .getElementById("exportExamLogBtn")
  .addEventListener("click", exportExamLog);

const confirmAnswerBtn =
  document.getElementById("confirmAnswerBtn");

if (confirmAnswerBtn) {
  confirmAnswerBtn.addEventListener("click", () => {

    if (
      !selectedAnswerButton ||
      selectedAnswerIsCorrect === null
    ) {
      return;
    }

    confirmAnswerBtn.style.display = "none";

    checkAnswer(
      selectedAnswerButton,
      selectedAnswerIsCorrect
    );

  });
}

// APP START

updateErrorLog();
updateStats();
loadQuestions();