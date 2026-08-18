const historyLoading = document.getElementById("historyLoading");
const loginRequired = document.getElementById("loginRequired");
const emptyHistory = document.getElementById("emptyHistory");
const historyContent = document.getElementById("historyContent");

const totalExamsEl = document.getElementById("totalExams");
const totalQuestionsEl = document.getElementById("totalQuestions");
const averageScoreEl = document.getElementById("averageScore");
const examCountEl = document.getElementById("examCount");
const examList = document.getElementById("examList");
const EXAMS_PER_PAGE = 5;

let currentHistoryPage = 1;
let allExamHistory = [];


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

  examList.innerHTML = "";

  const totalPages =
    Math.ceil(exams.length / EXAMS_PER_PAGE);

  if (currentHistoryPage > totalPages) {
    currentHistoryPage = totalPages;
  }

  const startIndex =
    (currentHistoryPage - 1) * EXAMS_PER_PAGE;

  const endIndex =
    startIndex + EXAMS_PER_PAGE;

  const examsToShow =
    exams.slice(startIndex, endIndex);


  examsToShow.forEach(exam => {

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


  renderHistoryPagination(totalPages);

}


function renderHistoryPagination(totalPages) {

  let pagination =
    document.getElementById("historyPagination");


  if (!pagination) {

    pagination =
      document.createElement("div");

    pagination.id = "historyPagination";

    examList.after(pagination);

  }


  pagination.innerHTML = "";


  if (totalPages <= 1) {
    pagination.style.display = "none";
    return;
  }


  pagination.style.display = "flex";


  // Previous

  const previousBtn =
    document.createElement("button");

  previousBtn.textContent = "‹";

  previousBtn.className =
    "pagination-btn pagination-arrow";

  previousBtn.disabled =
    currentHistoryPage === 1;


  previousBtn.addEventListener("click", () => {

    if (currentHistoryPage > 1) {

      currentHistoryPage--;

      renderExamHistory(allExamHistory);

    }

  });


  pagination.appendChild(previousBtn);


  // Page numbers

  for (let page = 1; page <= totalPages; page++) {

    const pageBtn =
      document.createElement("button");

    pageBtn.textContent = page;

    pageBtn.className = "pagination-btn";


    if (page === currentHistoryPage) {
      pageBtn.classList.add("active");
    }


    pageBtn.addEventListener("click", () => {

      currentHistoryPage = page;

      renderExamHistory(allExamHistory);

    });


    pagination.appendChild(pageBtn);

  }


  // Next

  const nextBtn =
    document.createElement("button");

  nextBtn.textContent = "›";

  nextBtn.className =
    "pagination-btn pagination-arrow";

  nextBtn.disabled =
    currentHistoryPage === totalPages;


  nextBtn.addEventListener("click", () => {

    if (currentHistoryPage < totalPages) {

      currentHistoryPage++;

      renderExamHistory(allExamHistory);

    }

  });


  pagination.appendChild(nextBtn);

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


    allExamHistory = exams;
    currentHistoryPage = 1;

    renderExamHistory(allExamHistory);

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