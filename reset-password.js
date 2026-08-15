const newPasswordInput =
  document.getElementById("newPassword");

const confirmPasswordInput =
  document.getElementById("confirmPassword");

const resetPasswordBtn =
  document.getElementById("resetPasswordBtn");

const resetMessage =
  document.getElementById("resetMessage");


resetPasswordBtn.addEventListener(
  "click",
  async () => {

    resetMessage.textContent = "";

    const newPassword =
      newPasswordInput.value;

    const confirmPassword =
      confirmPasswordInput.value;


    if (!newPassword || !confirmPassword) {

      resetMessage.textContent =
        "Please complete both password fields.";

      return;
    }


    if (newPassword !== confirmPassword) {

      resetMessage.textContent =
        "Passwords do not match.";

      return;
    }


    const { error } =
      await supabaseClient.auth.updateUser({
        password: newPassword
      });


    if (error) {

      resetMessage.textContent =
        error.message;

      return;
    }


    resetMessage.textContent =
      "Password updated successfully. You can now sign in with your new password.";


    setTimeout(() => {

      window.location.href =
        "account.html";

    }, 2000);

  }
);