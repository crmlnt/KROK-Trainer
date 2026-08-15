const historyLoading = document.getElementById("historyLoading");
const loginRequired = document.getElementById("loginRequired");
const emptyHistory = document.getElementById("emptyHistory");
const historyContent = document.getElementById("historyContent");

const totalExamsEl = document.getElementById("totalExams");
const totalQuestionsEl = document.getElementById("totalQuestions");
const averageScoreEl = document.getElementById("averageScore");
const examCountEl = document.getElementById("examCount");
const examList = document.getElementById("examList");


function hideAllStates() {
  historyLoading.hidden = true;
  loginRequired.hidden = true;
  emptyHistory.hidden = true;
  historyContent.hidden = true;
}


function formatDate(dateString) {
  const date = new Date(dateString);

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}


function getScoreClass(score) {
  if (score >= 60) {
    return "score-pass";
  }

  return "score-fail";
}


function renderExamHistory(exams) {

  const totalExams = exams.length;

  const totalQuestions = exams.reduce(
    (sum, exam) => sum + exam.questions_total,
    0
  );

  const averageScore =
    Math.round(
      exams.reduce((sum, exam) => sum + Number(exam.score), 0) /
      totalExams
    );


  totalExamsEl.textContent = totalExams;
  totalQuestionsEl.textContent = totalQuestions;
  averageScoreEl.textContent = `${averageScore}%`;

  examCountEl.textContent =
    `${totalExams} ${totalExams === 1 ? "exam" : "exams"}`;


  examList.innerHTML = "";


  exams.forEach(exam => {

    const card = document.createElement("article");

    card.className = "exam-history-card";


    card.innerHTML = `
      <div class="exam-history-main">

        <div class="exam-history-meta">
          <span class="exam-krok">
            KROK ${exam.krok}
          </span>

          <span class="exam-date">
            ${formatDate(exam.created_at)}
          </span>
        </div>


        <h3>${exam.subject}</h3>


        <div class="exam-history-stats">

          <span>
            ${exam.questions_total} Questions
          </span>

          <span class="correct-text">
            ${exam.correct} Correct
          </span>

          <span class="wrong-text">
            ${exam.wrong} Wrong
          </span>

        </div>

      </div>


      <div class="exam-history-score ${getScoreClass(Number(exam.score))}">
        ${Math.round(Number(exam.score))}%
      </div>
    `;


    examList.appendChild(card);

  });

}


async function loadExamHistory() {

  try {

    hideAllStates();
    historyLoading.hidden = false;


    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser();


    if (userError) {
      console.error("User error:", userError);
    }


    if (!user) {

      hideAllStates();
      loginRequired.hidden = false;

      return;
    }


    const { data: exams, error } =
      await supabaseClient
        .from("exam_sessions")
        .select("*")
        .order("created_at", {
          ascending: false
        });


    if (error) {

      console.error(
        "Error loading exam history:",
        error
      );

      historyLoading.innerHTML =
        "<p>Unable to load exam history.</p>";

      return;
    }


    hideAllStates();


    if (!exams || exams.length === 0) {

      emptyHistory.hidden = false;

      return;
    }


    renderExamHistory(exams);

    historyContent.hidden = false;


  } catch (error) {

    console.error(
      "Unexpected history error:",
      error
    );

    hideAllStates();

    historyLoading.hidden = false;

    historyLoading.innerHTML =
      "<p>Unable to load exam history.</p>";

  }

}


loadExamHistory();