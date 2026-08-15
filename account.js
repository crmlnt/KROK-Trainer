const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const logoutBtn = document.getElementById("logoutBtn");

const authForm = document.getElementById("authForm");
const accountPanel = document.getElementById("accountPanel");

const userEmail = document.getElementById("userEmail");
const authMessage = document.getElementById("authMessage");


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
      "Account created. Check your email to confirm your account.";

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