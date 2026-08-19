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
    redirectTo: `${window.location.origin}/KROK-Trainer/reset-password.html`
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


checkSession();