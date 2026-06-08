
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
const examBtn = document.getElementById("exam-btn");
const progressBar = document.getElementById("progressBar");
const statsBtn = document.getElementById("stats-btn");
const themeBtn = document.getElementById("theme-btn");
const exportErrorsBtn = document.getElementById("export-errors-btn");

if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark-mode");
}

//FUNCTIONS

async function loadQuestions() {
  const response = await fetch("questions.json");

  const text = await response.text();

  console.log(text);

  allQuestions = JSON.parse(text);
  console.log(
  "Subjects found:",
  [...new Set(allQuestions.map(q => q.subject))]
  );

  populateSubjectFilter();
  questions = [...allQuestions];

  questions = shuffleArray(questions);

  showQuestion();
}

function populateSubjectFilter() {
  const subjectFilter = document.getElementById("subjectFilter");

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
  feedback.textContent = "";
  answersContainer.innerHTML = "";
  nextBtn.style.display = "none";
  reviewBtn.style.display = "none";

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

    button.addEventListener("click", () => checkAnswer(button, answer.isCorrect));

    answersContainer.appendChild(button);
  });
  updateProgressBar();
}

function checkAnswer(button, isCorrect) {
  if (answered) return;

  answered = true;
  const allButtons = document.querySelectorAll(".answer-btn");
  const currentQuestion = questions[currentQuestionIndex];
  saveSubjectStats(currentQuestion.subject, isCorrect);

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
      if (btn.textContent === currentQuestion.answers[currentQuestion.correct]) {
        btn.classList.add("correct");
      }
    });
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
  examMode = true;
  reviewMode = false;

  const filteredQuestions = getFilteredQuestions();

  if (filteredQuestions.length === 0) {
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
    examCount = filteredQuestions.length;
  } else {
    examCount = Number(userChoice);
  }

  if (!examCount || examCount <= 0) {
    alert("Please enter a valid number.");
    return;
  }

  if (examCount > filteredQuestions.length) {
    examCount = filteredQuestions.length;
  }

  questions = shuffleArray(filteredQuestions).slice(0, examCount);

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
  const stats = JSON.parse(localStorage.getItem("subjectStats")) || {};

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

  localStorage.setItem("subjectStats", JSON.stringify(stats));
}

function showStatistics() {
  const stats = JSON.parse(localStorage.getItem("subjectStats")) || {};

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


// EVEMT LISTENER

exportErrorsBtn.addEventListener("click", exportErrorLog);

statsBtn.addEventListener("click", showStatistics);

nextBtn.addEventListener("click", () => {
  currentQuestionIndex++;

  if (currentQuestionIndex < questions.length) {
    showQuestion();
  } else {
    questionText.textContent = "Quiz completed!";
    questionNumber.textContent = "";
    answersContainer.innerHTML = "";
    if (examMode) {

  const accuracy =
    Math.round((correctAnswers / questions.length) * 100);

  let result = "FAILED ❌";

  if (accuracy >= 60) {
    result = "PASSED ✅";
  }

  feedback.innerHTML = `
  <div class="exam-summary">
    <h2>Exam Completed</h2>

    <p><strong>Questions:</strong> ${questions.length}</p>
    <p><strong>Correct:</strong> ${correctAnswers}</p>
    <p><strong>Wrong:</strong> ${wrongAnswers}</p>
    <p><strong>Accuracy:</strong> ${accuracy}%</p>

    <h3>${result}</h3>
  </div>
`;

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


clearErrorsBtn.addEventListener("click", () => {

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
});


examBtn.addEventListener("click", () => {
  startExamMode();
});

themeBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");

  if (document.body.classList.contains("dark-mode")) {
    localStorage.setItem("theme", "dark");
  } else {
    localStorage.setItem("theme", "light");
  }
});

// APP START

updateErrorLog();
updateStats();
loadQuestions();