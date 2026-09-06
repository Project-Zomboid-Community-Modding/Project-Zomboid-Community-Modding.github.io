async function ghApiCall(path, token, method = "GET", body = null) {
  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`${resp.status} ${path} - ${text.slice(0, 300)}`);
    err.status = resp.status;
    throw err;
  }
  if (resp.status === 204) return null;
  return resp.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** True if the signed-in user can push directly to owner/repo. */
async function checkPushPermission(owner, repo, token) {
  const info = await ghApiCall(`/repos/${owner}/${repo}`, token);
  return { canPush: !!(info.permissions && info.permissions.push), defaultBranch: info.default_branch };
}

/**
 * Forks owner/repo into the signed-in user's account (or returns the
 * existing fork if one is already there) and waits for it to become usable.
 */
async function ensureFork(owner, repo, token) {
  const me = await ghApiCall("/user", token);
  const forkOwner = me.login;

  try {
    await ghApiCall(`/repos/${forkOwner}/${repo}`, token);
    return forkOwner; // fork already exists
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  await ghApiCall(`/repos/${owner}/${repo}/forks`, token, "POST", {});

  // forking is async on GitHub's side - poll until the new repo is reachable
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(1500);
    try {
      await ghApiCall(`/repos/${forkOwner}/${repo}`, token);
      return forkOwner;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  throw new Error("Fork was created but isn't ready yet - try submitting again in a moment.");
}

/**
 * Commits files to a new branch on writeOwner/repo (either the upstream repo
 * itself, if the user can push, or their fork) and returns the branch name.
 */
async function commitFilesToNewBranch({ writeOwner, repo, baseBranch, files, targetLang, token }) {
  const branchName = `translate/${targetLang.toLowerCase()}`;

  let parentSha, baseTreeSha, isUpdate;
  try {
    const existingRef = await ghApiCall(`/repos/${writeOwner}/${repo}/git/ref/heads/${encodeURIComponent(branchName)}`, token);
    parentSha = existingRef.object.sha;
    const existingCommit = await ghApiCall(`/repos/${writeOwner}/${repo}/git/commits/${parentSha}`, token);
    baseTreeSha = existingCommit.tree.sha;
    isUpdate = true;
  } catch (e) {
    if (e.status !== 404) throw e;
    const refData = await ghApiCall(`/repos/${writeOwner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`, token);
    parentSha = refData.object.sha;
    const baseCommit = await ghApiCall(`/repos/${writeOwner}/${repo}/git/commits/${parentSha}`, token);
    baseTreeSha = baseCommit.tree.sha;
    isUpdate = false;
  }

  const treeEntries = [];
  for (const f of files) {
    const blob = await ghApiCall(`/repos/${writeOwner}/${repo}/git/blobs`, token, "POST", {
      content: f.content,
      encoding: "utf-8",
    });
    treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const newTree = await ghApiCall(`/repos/${writeOwner}/${repo}/git/trees`, token, "POST", {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  const newCommit = await ghApiCall(`/repos/${writeOwner}/${repo}/git/commits`, token, "POST", {
    message: `${isUpdate ? "Update" : "Add"} ${targetLang} translation${files.length > 1 ? "s" : ""}`,
    tree: newTree.sha,
    parents: [parentSha],
  });

  if (isUpdate) {
    await ghApiCall(`/repos/${writeOwner}/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`, token, "PATCH", {
      sha: newCommit.sha,
    });
  } else {
    await ghApiCall(`/repos/${writeOwner}/${repo}/git/refs`, token, "POST", {
      ref: `refs/heads/${branchName}`,
      sha: newCommit.sha,
    });
  }

  return { branchName, isUpdate };
}

/**
 * Full flow: checks push permission, commits to the upstream repo directly
 * if possible, otherwise forks + commits to the fork, then opens a PR back
 * to the upstream repo's default branch either way.
 */
async function submitTranslationPR({ owner, repo, sourceLang, targetLang, files, token }) {
  const { canPush, defaultBranch } = await checkPushPermission(owner, repo, token);
  const baseBranch = defaultBranch;

  let writeOwner = owner;
  if (!canPush) {
    writeOwner = await ensureFork(owner, repo, token);
  }

  let branchName, isUpdate;
  try {
    ({ branchName, isUpdate } = await commitFilesToNewBranch({ writeOwner, repo, baseBranch, files, targetLang, token }));
  } catch (e) {
    if (!canPush && /Resource not accessible by personal access token/i.test(e.message)) {
      throw new Error(
        "GitHub rejected the write to your fork. This is a known gap in fine-grained tokens: " +
        "they can't be used to fork-and-PR a repo you don't already collaborate on, even after " +
        "the fork exists. Sign out and sign in again with a classic token (repo scope) instead: " +
        "https://github.com/settings/tokens/new?scopes=repo"
      );
    }
    throw e;
  }

  const me = await ghApiCall("/user", token);
  const headOwner = canPush ? owner : me.login;
  const head = `${headOwner}:${branchName}`;

  if (isUpdate) {
    const existing = await ghApiCall(`/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(head)}&state=open`, token);
    if (existing.length > 0) {
      return { pr_number: existing[0].number, pr_url: existing[0].html_url, via_fork: !canPush, updated: true };
    }
  }

  const prBody = [
    `Adds/updates the **${targetLang}** translation.`,
    "",
    `Source language: \`${sourceLang}\` · Files changed: ${files.length}`,
  ].join("\n");

  const pr = await ghApiCall(`/repos/${owner}/${repo}/pulls`, token, "POST", {
    title: `Translation: ${targetLang}`,
    head,
    base: baseBranch,
    body: prBody,
  });

  return { pr_number: pr.number, pr_url: pr.html_url, via_fork: !canPush };
}
