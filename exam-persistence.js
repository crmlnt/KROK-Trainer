// Persistent exam storage for Exam History review and subject analytics.
// Loaded after app.js so it can reuse the current exam state without changing
// the existing quiz/exam flow.

saveExamSession = async function saveExamSession() {
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    console.log("Local development: exam session not saved to Supabase.");
    return;
  }

  try {
    const {
      data: { user }
    } = await supabaseClient.auth.getUser();

    if (!user) {
      console.log("Exam not saved: user is not logged in.");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const examType = params.get("exam") || "krok1";
    const topic = params.get("topic") || "all";
    const krokNumber = examType === "krok2" ? 2 : 1;

    const accuracy = Math.round(
      (correctAnswers / questions.length) * 100
    );

    let subject = topic;

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

    const { data: examSession, error: sessionError } = await supabaseClient
      .from("exam_sessions")
      .insert({
        user_id: user.id,
        krok: krokNumber,
        mode: "exam",
        subject,
        questions_total: questions.length,
        correct: correctAnswers,
        wrong: wrongAnswers,
        score: accuracy
      })
      .select("id")
      .single();

    if (sessionError) {
      console.error("Error saving exam session:", sessionError);
      return;
    }

    // examSessionLog contains answered questions. Add any questions left
    // unanswered (for example when the timer expires) as incorrect answers.
    const answeredIds = new Set(
      examSessionLog.map(item => String(item.id ?? ""))
    );

    const unansweredItems = questions
      .filter(question => !answeredIds.has(String(question.id ?? "")))
      .map(question => ({
        id: question.id,
        subject: question.subject || "Unknown",
        yourAnswer: null,
        correctAnswer: question.answers?.[question.correct] ?? null,
        result: "Wrong"
      }));

    const completeExamLog = [
      ...examSessionLog,
      ...unansweredItems
    ];

    const questionRows = completeExamLog.map(item => ({
      exam_session_id: examSession.id,
      user_id: user.id,
      question_id: item.id == null ? null : String(item.id),
      subject: item.subject || "Unknown",
      user_answer: item.yourAnswer ?? null,
      correct_answer: item.correctAnswer ?? null,
      is_correct: item.result === "Correct"
    }));

    if (questionRows.length > 0) {
      const { error: questionsError } = await supabaseClient
        .from("exam_session_questions")
        .insert(questionRows);

      if (questionsError) {
        console.error("Error saving exam questions:", questionsError);
        return;
      }
    }

    console.log(
      `Exam session ${examSession.id} saved with ${questionRows.length} question records.`
    );
  } catch (error) {
    console.error("Unexpected error saving exam:", error);
  }
};
