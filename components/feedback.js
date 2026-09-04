(function() {
  // Create Feedback button
  const fbBtn = document.createElement("button");
  fbBtn.className = "feedback-floating-btn";
  fbBtn.type = "button";
  fbBtn.setAttribute("aria-label", "Submit Feedback");
  fbBtn.innerHTML = '<span aria-hidden="true">💬</span> Feedback';
  document.body.appendChild(fbBtn);

  // Create Modal
  const modalHTML = `
    <div class="feedback-modal-overlay" id="feedbackOverlay" aria-hidden="true">
      <div class="feedback-modal" role="dialog" aria-labelledby="feedbackTitle" aria-modal="true">
        <div class="feedback-header">
          <h2 id="feedbackTitle">Feedback</h2>
          <button type="button" class="feedback-close-btn" aria-label="Close feedback modal">×</button>
        </div>
        <form id="feedbackForm">
          <div class="feedback-group">
            <label for="feedbackType">Type</label>
            <select id="feedbackType" name="type" required>
              <option value="Bug">Bug</option>
              <option value="Suggestion">Suggestion</option>
              <option value="Question">Question</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="feedback-group">
            <label for="feedbackEmail">Email (optional)</label>
            <input type="email" id="feedbackEmail" name="email" placeholder="you@example.com">
          </div>
          <div class="feedback-group">
            <label for="feedbackMessage">Message</label>
            <textarea id="feedbackMessage" name="message" rows="4" required placeholder="What's on your mind?"></textarea>
          </div>
          <div id="feedbackStatus" class="feedback-status" aria-live="polite"></div>
          <div class="feedback-actions">
            <button type="button" class="feedback-cancel-btn">Cancel</button>
            <button type="submit" class="feedback-submit-btn">Send</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  const overlay = document.getElementById("feedbackOverlay");
  const form = document.getElementById("feedbackForm");
  const closeBtns = document.querySelectorAll(".feedback-close-btn, .feedback-cancel-btn");
  const submitBtn = document.querySelector(".feedback-submit-btn");
  const statusDiv = document.getElementById("feedbackStatus");
  const msgInput = document.getElementById("feedbackMessage");

  function openModal() {
    overlay.setAttribute("aria-hidden", "false");
    msgInput.focus();
  }

  function closeModal() {
    overlay.setAttribute("aria-hidden", "true");
    form.reset();
    statusDiv.textContent = "";
    statusDiv.className = "feedback-status";
  }

  fbBtn.addEventListener("click", openModal);
  closeBtns.forEach(btn => btn.addEventListener("click", closeModal));

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.getAttribute("aria-hidden") === "false") {
      closeModal();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    statusDiv.textContent = "";

    const formData = new FormData(form);
    formData.append("page", window.location.pathname);
    
    try {
      const res = await fetch("https://formspree.io/f/myeyppwv", {
        method: "POST",
        body: formData,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (res.ok) {
        statusDiv.textContent = "Thank you! Your feedback has been sent.";
        statusDiv.className = "feedback-status success";
        form.reset();
        setTimeout(closeModal, 2500);
      } else {
        statusDiv.textContent = "Oops! There was a problem sending your feedback.";
        statusDiv.className = "feedback-status error";
      }
    } catch (err) {
      statusDiv.textContent = "Network error. Please try again later.";
      statusDiv.className = "feedback-status error";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send";
    }
  });
})();
