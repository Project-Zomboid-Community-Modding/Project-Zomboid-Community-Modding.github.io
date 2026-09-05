# Mod Translator

A standalone translation tool for Build 42+ Project Zomboid mods. Unlike the
version on Chuckleberry Finn's personal site, this one has **no backend at
all** - no Cloudflare Worker, no GitHub App, no bot to install. Everything
runs as static files and talks to `api.github.com` directly from the
browser, authenticated (when needed) with a token the user brings themselves.

## What it does

1. **Source** - either:
   - **GitHub repo**: paste any `owner/repo` or full URL. Public repos work
     with no sign-in, read straight from the GitHub API.
   - **Local folder**: `<input webkitdirectory>` scan, entirely client-side.
     Same Build 41 workshop-cache exclusion rule as `pz-translator`'s
     `translate.py` (see `pathRules.js`). Download-only - there's nothing on
     GitHub to open a PR against.
2. **Languages** - origin defaults to `EN`, target is any code from
   `languages.json`, shown as e.g. `FR (Francais)`.
3. **Editor** - per-key rows grouped by file, progress bar, "only show
   missing" filter.
4. **Download** - zips the translated files, no sign-in required, works for
   both source types.
5. **Pull request** - only offered for a GitHub-repo source, and only once
   signed in (see below). Opens a real PR using the signed-in user's own
   GitHub identity - no bot involved.

## How sign-in works

There are two ways to sign in, and the tool shows whichever is available:

### One-click "Sign in with GitHub" (preferred)

This is a standard OAuth redirect: click the button, land on GitHub's own
login/authorize page (which already knows if you're logged in - if so it's
just one "Authorize this app?" screen), then bounce straight back signed in.

The one part of OAuth that can't run in a static page is trading the
redirect's `code` for an access token - that step needs a client secret,
and GitHub's token endpoint has no CORS for browser calls anyway. So this
needs exactly one tiny piece of infrastructure: `oauth-worker/`, a
Cloudflare Worker whose only job is that one exchange. It has no idea what
repos exist, holds no GitHub App private key, and manages no installation
or allowlist - compare that to the Chuck's-site version, which needed all
of that. If it's ever compromised, the blast radius is "can trade OAuth
codes for tokens," not "can push to any repo."

**One-time setup** (not per-user):
1. On GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: your tool's URL, e.g.
     `https://project-zomboid-community-modding.github.io/tools/mod-translator/`
   - Authorization callback URL: the same URL
   - Generate a **Client Secret** - copy it now, GitHub only shows it once
2. Deploy `oauth-worker/`:
   ```
   cd tools/mod-translator/oauth-worker
   npx wrangler deploy
   npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET   # paste the secret from step 1
   ```
   Set `GITHUB_OAUTH_CLIENT_ID` and `ALLOWED_ORIGINS` in `wrangler.toml` first.
3. Fill in `config.js`:
   ```js
   oauth: {
     clientId: "<the Client ID from step 1>",
     workerUrl: "<your deployed worker's URL>",
   },
   ```

Until `config.js` has both values, the "Sign in with GitHub" button is
disabled and the tool falls back to the token method below - nothing
breaks if you skip this setup, it's just less seamless.

**Local testing note:** GitHub OAuth Apps only accept one exact callback
URL, so testing on `localhost` needs a second, throwaway OAuth App
registered with a `localhost` callback - swap `config.js` between the two
as needed.

### Manual token (fallback, zero setup)

Click "or use a token instead" to paste a fine-grained personal access
token scoped to the repo, with `Contents: read and write` and
`Pull requests: read and write`. Works with no OAuth App or worker at all.

### Either way

The resulting token:
- is sent only to `api.github.com`, never anywhere else
- lives in `sessionStorage` (cleared when the tab closes) - never
  `localStorage`, never a cookie
- is re-validated against `GET /user` on page load, so a stale/revoked
  token doesn't silently look signed-in

Since the PR is opened as the *user* either way, there's no separate
"is the App installed on this repo with the right permissions?" step to
get wrong - the only permission that matters is whatever GitHub already
grants that user on that repo.

## The PR flow itself (`prFlow.js`)

1. `GET /repos/{owner}/{repo}` with the user's token - checks
   `permissions.push`.
2. **If they can push directly**: commit straight to a new branch on the
   repo itself (create blobs → tree → commit → branch ref), then open a
   same-repo PR.
3. **If they can't** (translating someone else's mod): fork the repo into
   their own account first (or reuse an existing fork), commit the new
   branch there instead, then open a cross-repo PR (`head:
   their-login:branch`, `base: upstream-default-branch`).

Either way nothing lands on the repo's default branch without the repo
owner reviewing and merging the PR - the commit only ever exists on a new,
disposable branch.

## Files

```
tools/mod-translator/
  index.html        page structure
  main.css           matches the site-wide PZMC design tokens
  config.js          languages.json path, default source language, OAuth settings
  languages.json     B42+ language code -> display name map
  pathRules.js       Translate-folder / B41-exclusion path logic
  githubAuth.js       OAuth redirect sign-in + manual-token fallback
  githubSource.js    read repo files via the public/authenticated GitHub API
  localSource.js     scan a local folder for a B42+ Translate layout
  prFlow.js          commit + PR creation, with automatic fork fallback
  editor.js          renders the key/value grid and tracks fill progress
  zipExport.js       client-side .zip download (JSZip via CDN)
  app.js             wires it all together
  oauth-worker/       the one tiny secret-holding piece (see above)
    index.js
    wrangler.toml
```

## Known limitations

- If a repo has more than one `Translate/` root (e.g. a monorepo with
  several mods), the tool picks the one with the most language folders.
- Forking waits up to ~15 seconds for GitHub to finish provisioning the new
  repo before giving up; on a slow fork it may need a second click.
- If you click "Sign in with GitHub" while translation fields are already
  loaded, the repo/language selection survives the redirect round-trip, but
  any text already typed into fields does not - same as if the page were
  reloaded. Sign in before filling fields in to avoid re-typing anything.
