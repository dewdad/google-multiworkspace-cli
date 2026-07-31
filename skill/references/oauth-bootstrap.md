# OAuth Client Bootstrap

## Default: just add a profile

`gwcli` ships with a built-in Desktop OAuth client, so the normal path needs no
Cloud Console setup and no client JSON:

```bash
gwcli profiles add personal
```

This opens a browser for consent against gwcli's built-in client and stores your
tokens under the profile's isolated `gws` config dir. That's the whole flow for
most users — you can stop reading here.

The built-in client can be overridden at runtime (e.g. to ship an org-specific
client) via the `GWCLI_CLIENT_ID` / `GWCLI_CLIENT_SECRET` environment variables,
without rebuilding.

> **Why shipping a client secret is safe:** the built-in client is a
> **Desktop / installed-app** OAuth client. Google classifies desktop client
> secrets as non-confidential — the installed-app flow assumes the secret is
> embedded in distributed code and cannot be kept private. `gcloud`, `gh`, and
> the AWS SAM CLI all embed their client the same way.

## Advanced: bring your own OAuth client

Use your own OAuth client when you want per-account quota isolation, an internal
Workspace consent screen, or full control over the Cloud project. Pass it with
`--client <path>`:

```bash
gwcli profiles add work --client ~/Downloads/client_secret_*.json
```

When `--client` is given, gwcli copies that `client_secret.json` into the
profile's `gws` config dir, and it takes precedence over the built-in client for
that profile.

> **Read this once before creating your own client.** Google has made
> post-creation client-secret retrieval impossible. If you miss the secret in
> the modal that pops up after creation, you must either create a *second*
> client secret or delete and recreate the OAuth client. Multiple users have
> orphaned OAuth clients here — don't be one of them.

### What you need

A Google Cloud project with the OAuth consent screen configured + a Desktop
**OAuth client ID** whose `client_secret` you have captured to a JSON file.

This file is the `--client <path>` argument to `gwcli profiles add`.

### Manual flow (most reliable)

1. **Open the Google Cloud Console** in a real browser (not a headless one —
   see "Why headless automation fails" below):
   <https://console.cloud.google.com/apis/credentials>

2. **Pick or create a project.** Note the project ID; you'll set quota /
   billing on it later if you exceed free-tier API limits.

3. **Configure the OAuth consent screen** (first time only):
   - User type: **External** (Internal is Workspace-admin only).
   - Add yourself (and any other test users) under "Test users".
   - Scopes: leave the default; gws will request the scopes it needs at
     auth-login time. Adding scopes here is for the consent screen UX only.

   > **⚠ Testing-mode ~25-scope cap.** While the app is **unverified** (consent
   > screen in "Testing"), Google limits consent to **~25 OAuth scopes**. Each
   > `gwcli` service maps to several scopes, so the default profile set is
   > already near the ceiling and `gwcli profiles add ... --full` (all scopes
   > incl. Pub/Sub + Cloud Platform) will typically **exceed it and fail
   > consent** — most visibly on personal `@gmail.com` accounts. To grant broad
   > or full access, either narrow with `--scopes`, **verify** the OAuth app, or
   > use an **Internal** Workspace app (exempt from the cap). Also enable each
   > service's API in the project first, or its scopes fail regardless.

4. **Create credentials → OAuth client ID:**
   - Application type: **Desktop app** (this is what `gws` expects — Web
     application or Android won't work).
   - Name: anything, e.g. `gws-cli`.
   - Click **Create**.

5. **Capture the secret IMMEDIATELY.** A modal appears titled "OAuth client
   created". It has a **Download JSON** button. Click it. Save the file to a
   path you'll remember — for example:
   ```text
   ~/.config/gwcli/secrets/google-oauth-client.json   (Linux/Mac)
   %USERPROFILE%\.config\gwcli\secrets\google-oauth-client.json   (Windows)
   ```
   Treat this file like a password. **Do not commit it to git.** It contains
   the only copy of `client_secret` that Google will ever give you.

6. **Add the profile:**
   ```bash
   gwcli profiles add personal --client ~/.config/gwcli/secrets/google-oauth-client.json
   ```
   (Or whatever path you saved it to.) A browser opens, you authenticate, and
   tokens land in your config dir.

### I missed the modal — what now?

Google deprecated post-creation viewing of `client_secret` in 2024. Your
options, in order of preference:

1. **Add a *second* client secret to the existing OAuth client.** Open the
   client in Cloud Console → "Add client secret". You get a new modal with a
   new secret. **Capture it immediately.** Then either:
   - Delete the orphaned (uncaptured) first secret, or
   - Leave both — Google supports up to 2 active secrets per client.

2. **Delete the OAuth client and create a new one.** Cleanest, but you lose
   the OAuth client ID — any tooling that hard-coded it must be updated.

You cannot recover the original secret.

### Why headless automation fails

If you tried to script this with Playwright, Selenium, or
`Start-Process`-style spawns and ended up with the modal opening but no file
landing on disk, here's why: Google's "Download JSON" button triggers a
browser `download` event. Most automation libraries silently ignore download
events unless you explicitly hook them up:

- **Playwright:** browser context must be created with
  `accept_downloads=True`, AND you must `page.expect_download()` around the
  click, AND call `download.save_as(path)`. Without all three, the file is
  generated but discarded.
- **Selenium:** depends on driver — Chrome needs `prefs:
  download.default_directory` set in capabilities, and even then headless
  mode has caveats.
- **PowerShell `Start-Process` with redirected stdio:** doesn't render a real
  browser at all; the OAuth flow can't complete.

The recommendation: do step 5 (capture the JSON) **manually in a real
browser**, exactly once per Google account. Everything else can be scripted.

### Multi-account note

You can reuse the same OAuth client across all your profiles (personal, work,
client-X). The OAuth client identifies the *application*, not the user — each
profile authenticates a distinct *user* against that application. So:

- One OAuth client + one downloaded JSON = enough for all profiles.
- Pass the same `--client <path>` to every `gwcli profiles add` invocation.
- Google's free-tier OAuth quotas are per-client, not per-user.

If you're a Workspace admin managing multiple end users, create one OAuth
client per logical environment (dev / staging / prod) — not per user.

## Verifying

After `profiles add` completes:

```bash
gwcli profiles list --format json
# Should show: "email": "you@gmail.com", "authenticated": true
```

If `email` is `null`, run `gwcli profiles status <name>` — the lazy backfill
will populate it on next read.

## See also

- [`profiles.md`](profiles.md) — full profile management reference.
- [`troubleshooting.md`](troubleshooting.md) — runtime exit codes + common
  failure modes.
- Google's docs on
  [client-secret hashing / retrieval deprecation](https://support.google.com/cloud/answer/15549257#client-secret-hashing).
