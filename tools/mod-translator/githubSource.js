function parseRepoInput(raw) {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  s = s.replace(/\.git$/i, "").replace(/\/$/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

async function ghApiGet(path, token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(`https://api.github.com${path}`, { headers });
  if (!resp.ok) {
    if (resp.status === 403) {
      throw new Error("GitHub API rate limit reached - try again in a few minutes, or sign in with a token to raise the limit.");
    }
    if (resp.status === 404) {
      throw new Error("Repository not found (it may be private - sign in with a token that can access it - or misspelled).");
    }
    throw new Error(`GitHub API error (${resp.status})`);
  }
  return resp.json();
}

async function fetchRepoInfo(owner, repo, token) {
  return ghApiGet(`/repos/${owner}/${repo}`, token);
}

async function fetchRepoFileList(owner, repo, branch, token) {
  const data = await ghApiGet(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
  if (data.truncated) {
    console.warn("Repo tree was truncated by the GitHub API; some files may be missed.");
  }
  return (data.tree || []).filter(e => e.type === "blob").map(e => e.path);
}

async function fetchRawFile(owner, repo, branch, path, token) {
  // raw.githubusercontent.com only serves public content, so private repos
  // fall back to the authenticated contents API.
  if (!token) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const resp = await fetch(url);
    if (resp.ok) return resp.text();
  }
  const data = await ghApiGet(`/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, token);
  if (data.encoding === "base64") {
    return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
  }
  throw new Error(`Could not fetch ${path}`);
}

/**
 * Loads a GitHub repo source: locates the Translate/ root, lists available
 * languages, and returns a handle with the same shape as localSource.js's.
 * `token` is optional - public repos work without one.
 */
async function loadGithubSource(owner, repo, branchInput, token) {
  const info = await fetchRepoInfo(owner, repo, token);
  const branch = branchInput || info.default_branch;
  const filePaths = await fetchRepoFileList(owner, repo, branch, token);
  const jsonPaths = filePaths.filter(p => /\.json$/i.test(p));

  const roots = findTranslateRoots(jsonPaths, /* applyB41Filter */ false);
  if (roots.length === 0) {
    throw new Error("No Translate/<LANG>/*.json folder found in this repo.");
  }
  roots.sort((a, b) => Object.keys(b.languages).length - Object.keys(a.languages).length);
  const chosen = roots[0];

  return {
    type: "repo",
    owner,
    repo,
    branch,
    translateRoot: chosen.translateRoot,
    languages: chosen.languages,
    label: `${owner}/${repo}`,
    canWrite: !!token, // actual push permission is checked lazily in prFlow.js

    async readLanguageFiles(langCode) {
      const relPaths = chosen.languages[langCode] || [];
      const out = {};
      for (const relPath of relPaths) {
        const fullPath = `${chosen.translateRoot}/${relPath}`;
        const withinLangPath = relPath.split("/").slice(1).join("/");
        try {
          const text = await fetchRawFile(owner, repo, branch, fullPath, token);
          out[withinLangPath] = JSON.parse(text);
        } catch (e) {
          console.warn(`Skipping ${fullPath}: ${e.message}`);
        }
      }
      return out;
    },
  };
}
