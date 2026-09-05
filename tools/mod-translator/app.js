let LANGUAGES = {};
let currentSource = null;
let currentSourceData = {};

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initSourceActions();
  initEditorActions();
  await loadLanguages();
  const wasOAuthCallback = await checkGithubOAuthCallback();
  if (!wasOAuthCallback) await restoreAndVerifyGithubAuth();
});

async function loadLanguages() {
  try {
    const resp = await fetch(CONFIG.languagesJsonPath);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    LANGUAGES = await resp.json();
  } catch (err) {
    const isNetworkError = err instanceof TypeError;
    setSourceStatus(
      isNetworkError
        ? `Could not load languages.json - "Failed to fetch" usually means this page was opened ` +
          `directly from disk (a file:// URL). Serve it with a local web server instead, e.g. run ` +
          `"python3 -m http.server" and open http://localhost:8000/tools/mod-translator/.`
        : `Could not load languages.json: ${err.message}`,
      "error"
    );
  }
}

function initTabs() {
  document.querySelectorAll(".source-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".source-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".source-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`.source-panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
    });
  });
}

function setSourceStatus(message, kind) {
  const el = document.getElementById("sourceStatus");
  el.textContent = message;
  el.className = "source-status" + (kind ? ` status-${kind}` : "");
}

function initSourceActions() {
  document.getElementById("loadRepoBtn").addEventListener("click", async () => {
    const parsed = parseRepoInput(document.getElementById("repoInput").value);
    if (!parsed) { setSourceStatus("Enter a repo as owner/name or a full GitHub URL.", "error"); return; }
    const branch = document.getElementById("branchInput").value.trim() || null;
    await handleLoadRepo(parsed.owner, parsed.repo, branch);
  });

  document.getElementById("pickLocalBtn").addEventListener("click", () => {
    document.getElementById("localFolderInput").click();
  });

  document.getElementById("localFolderInput").addEventListener("change", async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    document.getElementById("localFolderName").textContent = `${files.length} file(s) selected`;
    setSourceStatus("Scanning folder…", "loading");
    try {
      currentSource = await loadLocalSource(files);
      onSourceLoaded();
    } catch (err) {
      setSourceStatus(err.message, "error");
    }
  });
}

async function handleLoadRepo(owner, repo, branch) {
  setSourceStatus(`Fetching ${owner}/${repo}…`, "loading");
  try {
    currentSource = await loadGithubSource(owner, repo, branch, getGithubToken());
    onSourceLoaded();
  } catch (err) {
    const isNetworkError = err instanceof TypeError;
    setSourceStatus(
      isNetworkError
        ? `Could not reach the GitHub API ("Failed to fetch"). Check your connection, or that this ` +
          `page is being served over http(s):// rather than opened as a file.`
        : err.message,
      "error"
    );
  }
}

function onSourceLoaded() {
  const availableLangs = Object.keys(currentSource.languages).sort();
  if (availableLangs.length === 0) {
    setSourceStatus("Found a Translate folder, but no recognizable language subfolders.", "error");
    return;
  }

  setSourceStatus(`Loaded ${currentSource.label} - found ${availableLangs.length} language folder(s).`, "ok");
  document.getElementById("editorMeta").innerHTML = `<span class="meta-name">${escapeHtml(currentSource.label)}</span>`;

  populateLangSelects(availableLangs);
  document.getElementById("view-editor").classList.remove("hidden");
  document.getElementById("fieldsSection").classList.add("hidden");
  updatePrButtonVisibility();
  document.getElementById("view-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function langOptionLabel(code) {
  const name = LANGUAGES[code];
  return name ? `${code} (${name})` : code;
}

function populateLangSelects(availableLangs) {
  const sourceSelect = document.getElementById("sourceLangSelect");
  const targetSelect = document.getElementById("targetLangSelect");

  sourceSelect.innerHTML = availableLangs.map(l => `<option value="${l}">${escapeHtml(langOptionLabel(l))}</option>`).join("");
  sourceSelect.value = availableLangs.includes(CONFIG.defaultSourceLang) ? CONFIG.defaultSourceLang : availableLangs[0];

  const renderTargets = () => {
    const source = sourceSelect.value;
    const allCodes = Object.keys(LANGUAGES).filter(l => l !== source).sort();
    targetSelect.innerHTML = allCodes.map(l => {
      const has = availableLangs.includes(l);
      const label = langOptionLabel(l) + (has ? " - has existing translation" : "");
      return `<option value="${l}">${escapeHtml(label)}</option>`;
    }).join("");
  };
  sourceSelect.addEventListener("change", renderTargets);
  renderTargets();
}

function initEditorActions() {
  document.getElementById("loadFieldsBtn").addEventListener("click", handleLoadFields);
  document.getElementById("downloadZipBtn").addEventListener("click", handleDownload);
  document.getElementById("createPrBtn").addEventListener("click", handleCreatePR);
}

async function handleLoadFields() {
  if (!currentSource) return;
  const sourceLang = document.getElementById("sourceLangSelect").value;
  const targetLang = document.getElementById("targetLangSelect").value;

  setSourceStatus(`Loading ${sourceLang} → ${targetLang} fields…`, "loading");
  try {
    currentSourceData = await currentSource.readLanguageFiles(sourceLang);
    const targetData = currentSource.languages[targetLang]
      ? await currentSource.readLanguageFiles(targetLang)
      : {};

    renderFields(currentSourceData, targetData);
    document.getElementById("fieldsSection").classList.remove("hidden");
    document.getElementById("fieldsSection").scrollIntoView({ behavior: "smooth", block: "start" });
    setSourceStatus(`Loaded ${Object.keys(currentSourceData).length} file(s) for ${sourceLang} → ${targetLang}.`, "ok");
  } catch (err) {
    setSourceStatus(`Could not load fields: ${err.message}`, "error");
  }
}

async function handleDownload() {
  const targetLang = document.getElementById("targetLangSelect").value;
  await downloadTranslationZip(currentSource.label, targetLang);
}

/** Called by githubAuth.js right before redirecting to GitHub, so the
 *  in-progress repo/language selection survives the round-trip. */
function buildRedirectState() {
  if (!currentSource || currentSource.type !== "repo") return null;
  return {
    owner: currentSource.owner,
    repo: currentSource.repo,
    branch: currentSource.branch,
    sourceLang: document.getElementById("sourceLangSelect").value,
    targetLang: document.getElementById("targetLangSelect").value,
  };
}

/** Called by githubAuth.js after a successful OAuth sign-in. Note: this
 *  re-fetches the repo and re-selects languages, but any text already
 *  typed into translation fields before the redirect is not preserved -
 *  same limitation as reloading the page. */
async function restoreAppStateAfterOAuth(state) {
  document.getElementById("repoInput").value = `${state.owner}/${state.repo}`;
  await handleLoadRepo(state.owner, state.repo, state.branch);
  if (state.sourceLang) document.getElementById("sourceLangSelect").value = state.sourceLang;
  if (state.targetLang) document.getElementById("targetLangSelect").value = state.targetLang;
}

function updatePrButtonVisibility() {
  const btn = document.getElementById("createPrBtn");
  const canOfferPr = currentSource && currentSource.type === "repo" && isGithubSignedIn();
  btn.classList.toggle("hidden", !canOfferPr);
}

/** Called by githubAuth.js whenever sign-in state changes. */
function onGithubAuthChanged() {
  updatePrButtonVisibility();
}

async function handleCreatePR() {
  const btn = document.getElementById("createPrBtn");
  const resultEl = document.getElementById("prResult");
  btn.disabled = true;
  resultEl.innerHTML = "";

  try {
    const sourceLang = document.getElementById("sourceLangSelect").value;
    const targetLang = document.getElementById("targetLangSelect").value;
    const exportData = getExportData();
    const files = Object.entries(exportData).map(([path, data]) => ({
      path: currentSource.translateRoot ? `${currentSource.translateRoot}/${targetLang}/${path}` : path,
      content: JSON.stringify(data, null, 4),
    }));

    const result = await submitTranslationPR({
      owner: currentSource.owner,
      repo: currentSource.repo,
      sourceLang,
      targetLang,
      files,
      token: getGithubToken(),
    });

    const viaNote = result.via_fork ? " (opened via a fork, since this token doesn't have push access to the repo)" : "";
    resultEl.innerHTML = `<span class="pr-success">Pull request opened${viaNote}:</span> <a href="${result.pr_url}" target="_blank" rel="noopener">${escapeHtml(result.pr_url)}</a>`;
  } catch (err) {
    resultEl.innerHTML = `<span class="pr-error">${escapeHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}
