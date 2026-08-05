# CDP-Automated OAuth Client Creation (Internal / cap-exempt)

Create a **cap-exempt OAuth client** by driving a real browser over the Chrome
DevTools Protocol (CDP), then hand its `client_secret.json` to
`mgws profiles add … --client`. This is the path for **Workspace (managed
domain) accounts that need broad or `--full` scopes**, where the built-in
client's ~25-scope testing cap makes consent fail.

> **When you need this.** `adamb@yourdomain.com` (managed Workspace) + `--full`
> → the built-in Desktop client cannot grant that many scopes. An **Internal**
> Workspace OAuth app is **exempt from the ~25-scope cap** and needs no
> verification. This page automates creating one. For personal `@gmail.com`
> accounts an Internal app is impossible — narrow `--scopes` instead (see
> [`oauth-bootstrap.md`](oauth-bootstrap.md)).

## What is (and isn't) automated

`scripts/cdp_oauth_client.mjs` owns the **reliable** parts and nothing fragile:

- ✅ Launches Edge / Chrome / Chromium with remote debugging on a **dedicated
  automation profile**, or attaches to one already running.
- ✅ Forces downloads into a known directory and **captures the
  `client_secret.json`** the moment it lands (`Browser.setDownloadBehavior` +
  event/poll), printing `[cdp] CLIENT_SECRET_CAPTURED <path>`.
- ❌ Does **not** click through the Cloud Console. That DOM changes constantly;
  the **agent drives it** with its own browser tools attached to the same
  `--port`, or the **human clicks** in the visible window. The script just
  keeps the plumbing solid underneath.

Zero external dependencies — a minimal RFC 6455 WebSocket client over
`node:net`/`node:crypto`, so it runs on Node ≥18 with nothing to install.

## Prerequisites

- **Workspace admin on a managed domain** — "Internal" user type only appears
  for Google Workspace organizations. Without it, fall back to a **verified**
  External app or a narrowed `--scopes`.
- Node ≥18, and Edge or Chrome/Chromium installed.
- The APIs you need (Gmail, Calendar, Drive, …) enabled in the target Cloud
  project, or their scopes fail regardless of the client.

> **⚠ Chrome 136+ blocks debugging your real profile.** `--remote-debugging-port`
> is refused against the default user-data-dir (an anti-infostealer mitigation;
> `--disable-features=DevToolsDebuggingRestrictions` was patched out by ~Chrome
> 140, and there is no policy to re-enable it). So the **live, in-use profile
> cannot be driven directly.** Two supported options:
>
> 1. **Fresh automation profile** (default) — the script uses a dedicated
>    `--user-data-dir`; you log into Google once inside it.
> 2. **`--copy-profile "<name>"`** — snapshot your *real* Edge/Chrome profile
>    into a throwaway dir and debug the copy, so its **authenticated Google
>    sessions carry over and you skip re-login** (see next section). Same machine
>    only. Never point `--user-data-dir` at your everyday profile — Chrome
>    ignores debugging there anyway.

## Step-by-step

### 1. Launch the browser with debugging + download capture

```bash
# Edge (default: auto-detects, prefers Edge then Chrome). Opens the Cloud
# credentials page and blocks until a client_secret.json is captured.
node multi-gws/scripts/cdp_oauth_client.mjs launch \
  --browser edge \
  --profile-directory "Adam" \
  --user-data-dir ~/.mgws-automation/adam \
  --download-dir ~/.config/mgws/secrets \
  --json
```

The script prints the CDP port (default `9222`). Attach the agent's browser
tools to `http://127.0.0.1:9222` to drive the DOM, **or** just let the human
click in the window that opened.

Already have a debugging browser open? Use `attach` instead of `launch`:

```bash
node multi-gws/scripts/cdp_oauth_client.mjs attach --port 9222 \
  --download-dir ~/.config/mgws/secrets --json
```

#### Reuse your existing login — `--copy-profile` (no re-auth)

To skip signing in again, copy your **real** browser profile (with its live
Google sessions) into the throwaway automation dir and debug that:

```bash
# Copy the Edge "Adam" profile (by its display name) and drive the copy.
# CLOSE Edge first — a live profile copies to a locked/partial state.
node multi-gws/scripts/cdp_oauth_client.mjs launch \
  --browser edge --copy-profile "Adam" \
  --download-dir ~/.config/mgws/secrets --json
```

- **Why a copy and not the live profile:** Chrome/Edge 136+ refuse
  `--remote-debugging-port` on the default profile (see callout above). A copy in
  a non-default dir is debuggable, and because App-Bound Encryption binds the
  cookie key to the **machine + OS user** (not the path), the copied sessions
  still decrypt — **same machine only**.
- `--copy-profile` accepts the **display name** ("Adam") or the on-disk dir
  ("Default", "Profile 1"); it resolves via the browser's `Local State`.
- **Security:** the copy holds live session cookies, so it is **deleted on
  exit** (including Ctrl-C / errors). Pass `--keep-profile` to retain it for
  repeated runs, or `--force-copy` to bypass the running-browser guard (risks a
  locked copy).
- It's a **point-in-time snapshot** — logins you do in the copy don't flow back
  to your real profile. Cache/GPU dirs are skipped, so the copy is small.

### 2. Sign in (first run only, unless you used `--copy-profile`)

In the automation profile, log into the Google **admin** account for the
managed domain. The profile persists, so later runs skip password + 2FA. With
`--copy-profile` you're already signed in — the account picker shows your
session — so you can skip straight to the consent screen.

### 3. Configure the consent screen as **Internal**

Cloud Console → **APIs & Services → OAuth consent screen**:

- **User type: Internal** ← this is the whole point; it lifts the ~25-scope cap
  and needs no verification. (If "Internal" is greyed out, the account isn't a
  Workspace admin on a managed domain — you cannot use this path.)
- Fill app name + support email; scopes here are UX only, gws requests the real
  ones at auth time.

### 4. Create the OAuth client

**APIs & Services → Credentials → Create Credentials → OAuth client ID**:

- **Application type: Desktop app** (gws requires Desktop — not Web/Android).
- Name it anything (e.g. `mgws-adam`), click **Create**.

### 5. Download JSON → automatic capture

The "OAuth client created" modal has a **Download JSON** button. Click it. The
script detects the file in `--download-dir`, waits for the size to settle, and
prints:

```
[cdp] CLIENT_SECRET_CAPTURED /home/you/.config/mgws/secrets/client_secret_….json
```

With `--json` it also emits `{ "success": true, "clientSecretPath": "…",
"next": "mgws profiles add <name> --client \"…\" --full" }` on stdout — branch
on `success` and reuse `clientSecretPath` directly.

> **Google gives the secret exactly once.** If you miss the modal you must add a
> second client secret or recreate the client — see
> [`oauth-bootstrap.md`](oauth-bootstrap.md#i-missed-the-modal--what-now).

### 6. Hand off to mgws

```bash
mgws profiles add adam --client ~/.config/mgws/secrets/client_secret_….json --full \
  --display-name "Adam (adamb@yourdomain.com)"
```

Because the client is Internal (cap-exempt), `--full` now succeeds where the
built-in client tripped `SCOPE_CAP_EXCEEDED`. This opens the normal OAuth
consent round-trip — drive it per SKILL.md § "the shared-CDP flow".

## Agent-driven DOM notes

- Attach your browser toolset to the **same** `--port` the script exposes; both
  share one browser. Do the clicking there while the script owns download capture.
- The Cloud Console DOM is dynamic and localized — prefer **text/role-based**
  clicks ("Create Credentials", "OAuth client ID", "Desktop app", "Create",
  "Download JSON") over brittle CSS/XPath selectors.
- If nothing downloads, check Chrome's **"Ask where to save each file before
  downloading"** setting — with it on, the click opens a native Save dialog CDP
  can't see. The script sets `Browser.setDownloadBehavior: allow`, which
  overrides it for the debugged session; if a native dialog still appears, the
  human must pick the `--download-dir`.

## Verify

```bash
mgws profiles list --format json          # adam present, authenticated: true
mgws --profile adam agenda --days 1        # real API call succeeds
```

## Pitfalls

- **Internal ≠ available everywhere.** Personal `@gmail.com` and un-privileged
  Workspace users can't create Internal apps. Use verified External or narrow
  scopes.
- **Enable the APIs first.** An Internal client still fails a scope whose API
  isn't enabled in the project.
- **One dedicated automation dir per identity.** Reusing your real profile is
  blocked by Chrome 136; reusing one automation dir for two Google accounts
  mixes their sessions — pass distinct `--user-data-dir` / `--profile-directory`.
- **Download settle.** The script waits for the file size to stabilize before
  reporting, so partial `.crdownload` files never leak through.

## See also

- [`oauth-bootstrap.md`](oauth-bootstrap.md) — client-secret capture rules, the
  cap gate, and the manual (non-CDP) fallback.
- [`profiles.md`](profiles.md) — `profiles add --client` and scope semantics.
- SKILL.md § "Re-authenticating expired tokens (the shared-CDP flow)" — the
  consent round-trip after the client exists.
