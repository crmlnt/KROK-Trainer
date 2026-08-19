const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authForm = document.getElementById("authForm");
const accountPanel = document.getElementById("accountPanel");
const userEmail = document.getElementById("userEmail");
const authMessage = document.getElementById("authMessage");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
const changePasswordBtn = document.getElementById("changePasswordBtn");
const changePasswordPanel = document.getElementById("changePasswordPanel");
const cancelPasswordBtn = document.getElementById("cancelPasswordBtn");
const currentPasswordInput = document.getElementById("currentPassword");
const newPasswordInput = document.getElementById("newPassword");
const confirmNewPasswordInput = document.getElementById("confirmNewPassword");
const savePasswordBtn = document.getElementById("savePasswordBtn");
const changePasswordMessage = document.getElementById("changePasswordMessage");


function showUser(user) {

  authForm.hidden = true;
  accountPanel.hidden = false;

  userEmail.textContent = user.email;

}


function showLogin() {

  authForm.hidden = false;
  accountPanel.hidden = true;

}


async function checkSession() {

  const {
    data: { session }
  } = await supabaseClient.auth.getSession();

  if (session) {
    showUser(session.user);
  } else {
    showLogin();
  }

}

forgotPasswordLink.addEventListener("click", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();

  if (!email) {
    authMessage.textContent =
      "Enter your email address first, then click Forgot password?";
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password.html`
  });

  if (error) {
    authMessage.textContent = error.message;
    return;
  }

  authMessage.textContent =
    "Password reset email sent. Check your inbox.";
});


signupBtn.addEventListener("click", async () => {

  authMessage.textContent = "";

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  const { data, error } =
    await supabaseClient.auth.signUp({
      email,
      password
    });

  if (error) {
    authMessage.textContent = error.message;
    return;
  }

  if (data.session) {

    showUser(data.user);

  } else {

    authMessage.textContent =
      "Account created! Please check your email to confirm your account. The verification email will be sent by Supabase Auth, our authentication provider. If you don't see it, please check your Spam or Junk folder.";

  }

});


loginBtn.addEventListener("click", async () => {

  authMessage.textContent = "";

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  const { data, error } =
    await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    authMessage.textContent = error.message;
    return;
  }

  showUser(data.user);

});


logoutBtn.addEventListener("click", async () => {

  await supabaseClient.auth.signOut();

  showLogin();

});


supabaseClient.auth.onAuthStateChange(
  (event, session) => {

    if (session) {
      showUser(session.user);
    } else {
      showLogin();
    }

  }
);

changePasswordBtn.addEventListener("click", () => {
  changePasswordPanel.hidden = false;
});

cancelPasswordBtn.addEventListener("click", () => {
  changePasswordPanel.hidden = true;
});

savePasswordBtn.addEventListener("click", async () => {

  changePasswordMessage.textContent = "";

  const currentPassword =
    currentPasswordInput.value;

  const newPassword =
    newPasswordInput.value;

  const confirmNewPassword =
    confirmNewPasswordInput.value;


  if (!currentPassword || !newPassword || !confirmNewPassword) {

    changePasswordMessage.textContent =
      "Please complete all password fields.";

    return;
  }


  if (newPassword !== confirmNewPassword) {

    changePasswordMessage.textContent =
      "New passwords do not match.";

    return;
  }


  const {
    data: { session }
  } = await supabaseClient.auth.getSession();


  if (!session) {

    changePasswordMessage.textContent =
      "Your session has expired. Please sign in again.";

    return;
  }


  const email = session.user.email;


  const { error: signInError } =
    await supabaseClient.auth.signInWithPassword({
      email,
      password: currentPassword
    });


  if (signInError) {

    changePasswordMessage.textContent =
      "Current password is incorrect.";

    return;
  }


  const { error: updateError } =
    await supabaseClient.auth.updateUser({
      password: newPassword
    });


  if (updateError) {

    changePasswordMessage.textContent =
      updateError.message;

    return;
  }


  changePasswordMessage.textContent =
    "Password updated successfully.";


  currentPasswordInput.value = "";
  newPasswordInput.value = "";
  confirmNewPasswordInput.value = "";

});


checkSession();