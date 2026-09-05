const GH_TOKEN_STORAGE_KEY = "pzmc_translator_gh_token";
const GH_OAUTH_STATE_KEY = "pzmc_translator_oauth_state";
const GH_OAUTH_APPSTATE_KEY = "pzmc_translator_oauth_appstate";

let githubAuth = { token: null, login: null, avatar: null };

function restoreGithubAuth() {
  try {
    const saved = sessionStorage.getItem(GH_TOKEN_STORAGE_KEY);
    if (saved) githubAuth.token = JSON.parse(saved).token || null;
  } catch (e) { /* ignore */ }
}

function saveGithubAuth() {
  try {
    sessionStorage.setItem(GH_TOKEN_STORAGE_KEY, JSON.stringify({ token: githubAuth.token }));
  } catch (e) { /* ignore */ }
}

function isGithubSignedIn() {
  return !!githubAuth.token;
}

function getGithubToken() {
  return githubAuth.token;
}

function signOutGithub() {
  githubAuth = { token: null, login: null, avatar: null };
  sessionStorage.removeItem(GH_TOKEN_STORAGE_KEY);
  updateGithubAuthUI();
}

/** Validates a token against GET /user and stores it in memory + sessionStorage if valid. */
async function signInGithub(token) {
  const resp = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) {
    if (resp.status === 401) throw new Error("That sign-in was rejected - the token is invalid or expired.");
    throw new Error(`Could not verify sign-in (HTTP ${resp.status}).`);
  }
  const user = await resp.json();
  githubAuth = { token, login: user.login, avatar: user.avatar_url };
  saveGithubAuth();
  updateGithubAuthUI();
  return user;
}

/** On page load, re-validates a saved token so a stale/revoked one doesn't look signed-in. */
async function restoreAndVerifyGithubAuth() {
  restoreGithubAuth();
  if (!githubAuth.token) return;
  try {
    await signInGithub(githubAuth.token);
  } catch (e) {
    signOutGithub();
  }
}

/* ── OAuth redirect flow ──────────────────────────────────
   Sends the browser to GitHub's own login/authorize page - if the
   user already has a GitHub session there, this is just one consent
   screen and an immediate redirect back. If not, GitHub prompts them
   to log in first, same as it would for any other site. Either way,
   this tool never sees their GitHub password. */

function startGithubOAuth() {
  const state = crypto.randomUUID();
  sessionStorage.setItem(GH_OAUTH_STATE_KEY, state);

  if (typeof buildRedirectState === "function") {
    const appState = buildRedirectState();
    if (appState) sessionStorage.setItem(GH_OAUTH_APPSTATE_KEY, JSON.stringify(appState));
  }

  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id: CONFIG.oauth.clientId,
    scope: "repo",
    redirect_uri: redirectUri,
    state,
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params}`;
}

/** Returns true if this page load is the redirect back from GitHub. */
async function checkGithubOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code) return false;

  window.history.replaceState({}, "", window.location.pathname);

  const expectedState = sessionStorage.getItem(GH_OAUTH_STATE_KEY);
  sessionStorage.removeItem(GH_OAUTH_STATE_KEY);
  if (!state || state !== expectedState) {
    setSourceStatus("GitHub sign-in failed a security check - please try again.", "error");
    return true;
  }

  const statusEl = document.getElementById("ghAuthStatus");
  statusEl.textContent = "Finishing sign-in…";
  try {
    const resp = await fetch(`${CONFIG.oauth.workerUrl}/token?code=${encodeURIComponent(code)}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || data.error || "Token exchange failed.");
    await signInGithub(data.access_token);
    statusEl.textContent = "";

    const savedAppState = sessionStorage.getItem(GH_OAUTH_APPSTATE_KEY);
    sessionStorage.removeItem(GH_OAUTH_APPSTATE_KEY);
    if (savedAppState && typeof restoreAppStateAfterOAuth === "function") {
      await restoreAppStateAfterOAuth(JSON.parse(savedAppState));
    }
  } catch (e) {
    statusEl.textContent = `Sign-in failed: ${e.message}`;
  }
  return true;
}

function updateGithubAuthUI() {
  const signedOutView = document.getElementById("ghAuthSignedOut");
  const signedInView = document.getElementById("ghAuthSignedIn");
  const nameEl = document.getElementById("ghAuthName");
  const avatarEl = document.getElementById("ghAuthAvatar");

  if (isGithubSignedIn()) {
    signedOutView.classList.add("hidden");
    signedInView.classList.remove("hidden");
    nameEl.textContent = githubAuth.login;
    avatarEl.src = githubAuth.avatar || "";
  } else {
    signedOutView.classList.remove("hidden");
    signedInView.classList.add("hidden");
  }

  if (typeof onGithubAuthChanged === "function") onGithubAuthChanged();
}

document.addEventListener("DOMContentLoaded", () => {
  const oauthBtn = document.getElementById("ghAuthOAuthBtn");
  const oauthAvailable = !!(CONFIG.oauth && CONFIG.oauth.clientId && CONFIG.oauth.workerUrl);
  if (oauthAvailable) {
    oauthBtn.addEventListener("click", startGithubOAuth);
  } else {
    oauthBtn.disabled = true;
    oauthBtn.title = "OAuth sign-in isn't configured on this deployment - use a token instead.";
  }

  const tokenToggle = document.getElementById("ghAuthTokenToggle");
  const tokenPanel = document.getElementById("ghAuthTokenPanel");
  tokenToggle.addEventListener("click", () => tokenPanel.classList.toggle("hidden"));

  const tokenSignInBtn = document.getElementById("ghAuthTokenSignInBtn");
  const tokenInput = document.getElementById("ghAuthTokenInput");
  const statusEl = document.getElementById("ghAuthStatus");

  tokenSignInBtn.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    if (!token) { statusEl.textContent = "Paste a token first."; return; }
    tokenSignInBtn.disabled = true;
    statusEl.textContent = "Verifying…";
    try {
      await signInGithub(token);
      tokenInput.value = "";
      statusEl.textContent = "";
    } catch (e) {
      statusEl.textContent = e.message;
    } finally {
      tokenSignInBtn.disabled = false;
    }
  });

  tokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tokenSignInBtn.click();
  });

  document.getElementById("ghAuthSignOutBtn").addEventListener("click", signOutGithub);
});
