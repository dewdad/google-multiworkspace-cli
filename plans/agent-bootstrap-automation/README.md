# Plan: Agent-Driven End-to-End Bootstrap Automation

## Status: Draft

## Summary

Turn the **entire 90-minute manual session** required to install the
`google-workspace` skill, provision a Google Cloud OAuth client, and authenticate
N user accounts into a **single agent-runnable workflow** — from a clean machine
with nothing but a Node runtime.

The deliverable of *this* plan is a set of agent-facing instructions
(skill + SKILL.md additions + a small `gwcli bootstrap` orchestrator) so that
an LLM agent can autonomously execute steps that today require a human at the
keyboard:

- Click through Google Cloud Console UIs (project, APIs, consent screen, OAuth
  client, secret download).
- Run OAuth flows for multiple Google accounts in sequence.
- Detect "already done" states and skip them (idempotency).
- Recover from common failures (orphan profile, stale secret, missing scopes).

This plan is the *automation spec* — **what** an agent needs to do and **with
which tool**. Implementation of the underlying gwcli/skill changes that make
this automation reliable is in the sibling
[`install-and-bootstrap-fixes`](../install-and-bootstrap-fixes/README.md) plan;
several of those fixes are prerequisites listed below.

## Goals

1. **Zero-touch bootstrap.** A user runs one command (or one slash command in
   their AI CLI) and ends up with M Google accounts authenticated under
   `gwcli`. The user only intervenes for: Google sign-in passwords, 2FA
   challenges, and a single OAuth consent click per account.
2. **Idempotent.** Re-running on a partially-complete machine resumes where it
   left off; never duplicates work, never creates orphans.
3. **Tool-aware.** The agent picks the right tool per step (Playwright for UI
   it must drive, `gcloud` for API tasks, `gwcli` for profile management,
   shell for filesystem). It doesn't browser-drive what `gcloud` can do, and
   it doesn't `gcloud` what only the Console UI exposes.
4. **Failure-explicit.** Every step has a documented failure mode and recovery
   path. Agents never silently retry.

## Non-Goals

- Replacing Google's mandatory consent UI with anything fully unattended.
  Consent (the "Allow" click) **must** be a real human action — agents only
  drive everything around it.
- Workspace-admin-only flows (provisioning users, granting domain-wide delegation).
  This plan targets personal-account and standard-Workspace setups.
- Building a desktop GUI. Output is text + a polled status channel.

## Prerequisite fixes from sibling plan

The automation hinges on these landing first (from
[`install-and-bootstrap-fixes`](../install-and-bootstrap-fixes/README.md)):

| Sibling Issue | Why this plan needs it |
|---|---|
| **#1** npm publish | Single-line `npm install` step replaces fragile "from-source" path |
| **#2** non-TTY auth | Agents run in non-TTY contexts; without this, OAuth always hangs |
| **#3** transactional `add` | Failed flows must not poison `profiles list` |
| **#7** persist `email` | Agent verification step asserts `email` matches expectation |
| **#8** conditional `keep` scope | Personal accounts must not be asked for Keep scope |

Without #2 the automation **cannot work** in agent contexts. Mark this as the
hard blocker.

## Architecture: phases & tool selection

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Phase Pipeline                               │
├──────────────────────────────────────────────────────────────────────┤
│ 0. Pre-flight       → shell + gwcli preflight (read-only)            │
│ 1. Install          → npm + skillshare (or local repo install)       │
│ 2. GCP Bootstrap    → gcloud (preferred) | Playwright (fallback)     │
│ 3. OAuth Client     → Playwright (only path; gcloud limited here)    │
│ 4. Per-Account Auth → gwcli + visible terminal | --headless mode     │
│ 5. Verification     → gwcli + lightweight API smoke tests            │
│ 6. Cleanup          → gwcli + Playwright (close, dispose secrets)    │
└──────────────────────────────────────────────────────────────────────┘
```

### Tool selection rules

| Task | First choice | Fallback | Rationale |
|---|---|---|---|
| Detect installed binaries | `Get-Command` / `which` | — | Trivial |
| Install gwcli | `npm install -g <pkg>` | `npm install -g github:dewdad/...` | Issue #1 dependency |
| List/enable GCP APIs | `gcloud services list/enable` | Playwright on Console | gcloud is faster, scriptable |
| Manage GCP project | `gcloud projects create/list` | Playwright on Console | Same |
| OAuth consent screen | `gcloud iap oauth-brands` (limited) | Playwright on Console | gcloud doesn't cover all fields |
| Add test users | `gcloud alpha iap` (limited) | Playwright on Console | Manual UI is canonical |
| Create OAuth Desktop client | **Playwright on Console** | `gcloud iap oauth-clients` (Internal-only, doesn't fit Desktop) | Google does not expose Desktop OAuth client creation via gcloud for personal projects |
| Capture client_secret JSON | **Accessibility-tree leak** via Playwright | Manual user paste | See "Secret capture" below |
| OAuth user auth | `gwcli profiles add` (after fix #2) | spawn visible cmd window | Driven from Issue #2 of sibling plan |
| Smoke tests | `gwcli` (gmail.users.getProfile, calendar +agenda) | — | Native |

**Rule:** prefer the lowest-fidelity tool that completes the task. UI driving
is reserved for the cases where Google offers no API. The OAuth Desktop client
creation is the only **mandatory** Playwright step.

## Phase details

### Phase 0 — Pre-flight detection

Goal: collect the world's state, output a JSON delta of work needed.

```bash
gwcli bootstrap status --json
# {
#   "gwcli": { "installed": true,  "version": "2.1.0" },
#   "gws":   { "installed": true,  "version": "0.22.5" },
#   "gcloud":{ "installed": false },
#   "playwright_cli": { "installed": true },
#   "config_dir": "C:\\Users\\…\\AppData\\Roaming\\gwcli",
#   "profiles":  [ /* gwcli profiles list */ ],
#   "client_secret_json": { "exists": false, "path": null },
#   "gcp_project_hint": null,
#   "skill_installed_via_skillshare": true
# }
```

The bootstrap command does no writes. It hands the agent a structured manifest
of next actions. The agent uses that manifest to plan; subsequent phases each
become a no-op if their precondition is already satisfied.

### Phase 1 — Install

```bash
# (after Issue #1 in sibling plan lands)
npm install -g @dewdad/google-workspace-cli   # or whichever final name

# OR for project-pinned installs:
skillshare install dewdad/multi-gws-cli/skill --track
skillshare sync
```

**Idempotency:** check `gwcli --version`; if matches required range, skip.
**Failure:** npm 404 → fall back to GitHub install (`npm install -g github:dewdad/...`).
**Verification:** `gwcli setup --json` returns `{ success: true }`.

### Phase 2 — GCP project bootstrap

Decision tree:

```
Is gcloud installed?
├── YES
│   ├── List projects.
│   ├── Existing project tagged as gws-cli? Use it.
│   ├── No tagged project? Create one: `gcloud projects create gws-cli-${rand}`.
│   ├── Enable APIs: `gcloud services enable gmail.googleapis.com calendar-json...`
│   └── Output: project_id
└── NO
    ├── Open Playwright at console.cloud.google.com.
    ├── Wait for human sign-in (poll URL until !accounts.google.com).
    ├── Drive project picker → "New Project" if none → name "gws-cli".
    ├── Visit /apis/library/<api> for each required API → click Enable.
    └── Output: project_id (read from URL)
```

**APIs to enable** (default scope set):

```
gmail.googleapis.com           docs.googleapis.com         tasks.googleapis.com
calendar-json.googleapis.com   sheets.googleapis.com       people.googleapis.com
drive.googleapis.com
# keep.googleapis.com  ← only for Workspace identities (see Issue #8)
```

**Idempotency:** `gcloud services list --enabled` is the source of truth;
only enable APIs not already in that list.

**Failure modes:**

- gcloud auth expired → run `gcloud auth login` (browser opens).
- API enable hits billing requirement → emit clear error pointing user to
  enable billing on the project (Google requires it for some APIs even at
  zero usage).
- Playwright path: human never signs in → 5-minute timeout → fail loudly.

### Phase 3 — OAuth consent screen + test users

`gcloud` does **not** cover this for the External / Testing / personal-Gmail
flow we use. Playwright is the only path.

Sequence (drive Console at `/auth/audience?project=<pid>`):

1. Detect publishing status. If `Testing` and User type `External`, skip the
   "configure" step.
2. Add test users from a list provided to the agent. The accessibility tree
   exposes existing test users in the audience grid; diff against the desired
   list, click **Add users**, fill the dialog, save.
3. (Optional) Update branding fields if missing (app name, support email).

**Idempotency:** read existing `<row>` entries in the test-users grid via
snapshot; only add the diff.

**Failure:** if Google moves the UI (this happens — the new "Google Auth
Platform" UI replaced the old "OAuth consent screen" page within the past
year), the snapshot-driven selectors break. Mitigation: pin selectors by
`role + name` text content (which is more stable than DOM positions) and
fail loud when they don't match. Don't silently click the wrong thing.

### Phase 4 — OAuth Desktop client + secret capture

This is the **single trickiest step** in the entire automation. Google
deprecated post-creation client_secret viewing; the secret is only visible:

- in the modal dialog right after **Create OAuth client ID**, or
- in the **Add client secret** dialog (visible inline in the accessibility tree).

Playwright's default download handler swallows the JSON download. We
work around this by leaking the secret through the accessibility tree.

#### Algorithm

```
1. Navigate to /auth/clients/create?project=<pid>
2. Snapshot → find combobox "Application type" → select "Desktop app".
3. Fill name → "gws-cli".
4. Click Create. A modal "OAuth client created" appears.
5. Snapshot the modal:
   - Capture `Client ID` from the <definition> next to <term> "Client ID".
   - Find "Copy to clipboard: <SECRET>" button. The aria-name leaks the secret.
6. If accessibility leak is empty (Google may patch this), fall back to the
   "Add client secret" dialog flow that we used in this session — which also
   leaks the secret in the Copy-button name on the new secret it creates.
7. Write { client_id, client_secret, project_id } into the standard Desktop
   client_secret.json shape at:
       <config_dir>/clients/gws-cli.json
8. Close all dialogs. Confirm by snapshotting that no modal remains.
```

#### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Google patches the aria-leak | Detect (post-create modal: secret button has aria=`Copy to clipboard: ****abcd` — masked). Fall back to "Add client secret" flow. If THAT is patched, fall back to manual: prompt the user to copy/paste the secret. |
| Multiple secrets accumulate | After successful capture, drive the UI to disable the previous secret (we did this in this session). Track via `gwcli bootstrap clean-secrets`. |
| User has no rights to create OAuth clients (Workspace-admin restriction) | Detect 403 in the create response; switch to "Workspace admin path" — direct the user to a different person/script. Out of scope for primary path. |

#### What the JSON shape must be

The standard Google "Desktop app" `installed` shape (matches what we wrote to
`C:\Users\<u>\.gws\client_secret.json` this session):

```json
{
  "installed": {
    "client_id": "<>.apps.googleusercontent.com",
    "project_id": "<gcp-project-id>",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "GOCSPX-...",
    "redirect_uris": ["http://localhost"]
  }
}
```

### Phase 5 — Per-account auth loop

For each account `name` in the agent's input list (e.g.
`["avitalbennatan","avitalidit","haavital"]`):

```
1. If profile already exists AND authenticated AND email matches expected
   email → skip.
2. If profile exists but unauthenticated → choose between:
     a. `gwcli profiles auth <name> --scopes <csv>`  (after Issue #2 lands)
     b. (legacy) spawn visible terminal for `gwcli profiles auth <name>`,
        poll status every 5 s.
3. If profile doesn't exist → `gwcli profiles add <name> --client <client.json>
   --scopes <csv> --no-auth`, then step 2.
4. After auth completes:
     - Backfill email via userinfo (Issue #7).
     - Run smoke test: `gwcli --profile <name> gmail users getProfile
       --params '{"userId":"me"}'`. Assert non-error response and email
       matches.
5. If first profile and no default set, `gwcli profiles set-default <name>`.
```

#### Polling pattern (until Issue #2 lands)

```powershell
# spawn visible OAuth window
$p = Start-Process cmd.exe `
     -ArgumentList "/k","title gwcli OAuth - $name && gwcli profiles auth $name && timeout /t 5" `
     -PassThru

# poll
for ($i=1; $i -le 60; $i++) {
  Start-Sleep -Seconds 5
  $j = (gwcli profiles list --format json | ConvertFrom-Json) `
     | Where-Object name -eq $name
  if ($j.authenticated) { break }
  if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { break }
}
```

Once Issue #2 is fixed, this collapses to:

```bash
gwcli profiles auth $name --scopes gmail,calendar,drive,docs,sheets,tasks --non-interactive
# blocks until OAuth callback or timeout, exits cleanly
```

#### Scope handling

The agent must compute the scope list per profile based on the OAuth
identity's hosted domain (per Issue #8 in sibling plan):

```
default = [gmail, calendar, drive, docs, sheets, tasks]
if hd is workspace_domain:
    default += [keep]
if user explicitly asked for scopes via --services flag:
    use those (intersection with supported)
```

### Phase 6 — Verification

After all profiles are authenticated:

```bash
gwcli preflight --json
# expect: { "ok": true, "profileCount": N }

gwcli profiles status --format json
# expect: { allAuthenticated: true, count: N, profiles: [...] }

# Per profile:
for each name:
    gwcli --profile $name gmail users getProfile --params '{"userId":"me"}'
    # assert: 200, emailAddress field present
    gwcli --profile $name calendar +agenda --days 7 --format json
    # assert: 200, "events" key present (count may be 0)
```

Output a per-profile health table to the user:

```
Profile          Email                       Gmail msgs  7d events  Status
─────────────────────────────────────────────────────────────────────────
avitalbennatan   avital.bennatan@gmail.com   285,697     56         ✅ ok
avitalidit       avitalidit@gmail.com         15,516     11         ✅ ok
haavital         ha.avital@gmail.com         113,740      9         ✅ ok
```

### Phase 7 — Cleanup

- Disable any OAuth client secret on the `gws-cli` client that was created but
  is not referenced in `<config_dir>/clients/gws-cli.json`. Drives Console UI
  via Playwright (we did this manually in this session for `****pwGs`).
- Close persistent Playwright browser sessions.
- Remove temporary Playwright artifact directories under
  `.playwright-cli/` if they leak `account: …` or `client_id` strings.
- Keep `client_secret.json` on disk; document its sensitivity in
  `references/oauth-bootstrap.md` (per Issue #6 of sibling plan).

## Skill instruction surface

What the agent sees in `SKILL.md` after this lands. Add a new top-level section
after Step 0a:

```markdown
## Step 0b — One-shot bootstrap (recommended for new installs)

If this is a fresh install or you want to add multiple accounts at once:

    gwcli bootstrap --accounts avitalbennatan,avitalidit,haavital

This orchestrates: project creation, API enablement, OAuth client creation,
secret capture, and per-account auth — invoking your default browser only
where Google requires a real human action (sign-in, consent click).

Bootstrap is idempotent. If half-completed, re-running picks up where it
left off.

Pass `--dry-run` to print the plan without acting.
Pass `--use-gcloud=auto|always|never` to control gcloud usage.
Pass `--no-cleanup` to keep persistent browser sessions for debugging.
```

The agent then has a single deterministic command to call instead of
threading through 11 SKILL.md steps.

### `gwcli bootstrap` subcommand surface (proposed)

```
gwcli bootstrap status          → JSON manifest of world state, no writes
gwcli bootstrap plan             → JSON of actions that would be taken
gwcli bootstrap install          → installs gwcli (when invoked via npx)
gwcli bootstrap gcp [--project]  → project + APIs + consent screen + test users
gwcli bootstrap oauth-client     → create + capture client_secret.json
gwcli bootstrap auth <name>...   → per-account loop
gwcli bootstrap verify           → smoke tests
gwcli bootstrap clean            → orphan secrets, stale profiles
gwcli bootstrap                  → runs all of the above end-to-end
```

Each subcommand exits with a JSON summary line on stdout (last line),
suitable for agent consumption:

```json
{"phase":"oauth-client","ok":true,"client_id":"...","project_id":"..."}
```

Earlier output (banner, progress) goes to stderr. Stdout is structured.

## Agent-facing instructions in SKILL.md

After the implementation lands, add this section to `skill/SKILL.md`:

```markdown
## Bootstrap as an agent (multi-account, unattended)

When asked to "set up gwcli for these accounts" or similar, follow this
sequence. **Do not improvise. Do not skip the pre-flight check.**

1. Run `gwcli bootstrap status --json`. Parse the manifest.
2. For each missing prerequisite (gwcli, gws, client_secret.json):
   - If installable via `npm` or `skillshare`, install it.
   - If it requires Google Cloud Console interaction, drive the browser via
     **playwright-cli** (or Playwright MCP if available).
3. Detect: does the user have `gcloud` installed and authenticated?
   - If yes: prefer `gcloud` for project + API + consent-screen tasks.
   - If no: use Playwright to drive console.cloud.google.com.
4. For OAuth client creation, **always** use Playwright. Capture the secret
   from the Copy-button accessible name (see references/oauth-bootstrap.md).
   Do not download the JSON file — Playwright swallows the download.
5. For per-account auth, prefer `gwcli profiles auth <n> --scopes <csv>
   --non-interactive`. If on an older gwcli without --non-interactive, spawn
   a visible terminal window via `Start-Process cmd /k …` (Windows) or
   `osascript -e 'tell app "Terminal"…'` (macOS) or `xterm -e …` (Linux).
6. Poll `gwcli profiles list --format json` every 5 s. Mark a profile done
   when `authenticated == true`. Run a smoke test before declaring success.
7. After all profiles are done, run `gwcli bootstrap verify` and emit the
   per-profile table to the user.
8. Run `gwcli bootstrap clean` unless the user passed --no-cleanup.

Keep the user in the loop only for: account selection (which Google account
to sign in as), 2FA, the OAuth "Allow" click. Everything else is automated.

If a Google UI changes and a snapshot-driven selector fails, **stop and
report**. Do not click anywhere you didn't expect.
```

## Failure-handling matrix

| Failure | Detection | Recovery |
|---|---|---|
| `npm install` 404 | `npm` exits non-zero with `E404` | Fall back to GitHub install path |
| gcloud not installed | `Get-Command gcloud` returns null | Use Playwright path for Phase 2 |
| User aborts Google sign-in | URL stays on `accounts.google.com` past 5 min | Re-emit instructions, wait another 5 min, then fail |
| OAuth consent screen UI changed | `playwright-cli snapshot` selector by-name fails | Stop, report, request manual completion |
| Playwright swallows download | `Get-ChildItem Downloads` shows no new file 5 s after click | Switch to accessibility-tree leak path |
| `client_secret.json` shape rejected by gws | `gwcli setup` prints validation error | Re-emit JSON from captured fields, validate locally first |
| OAuth callback timeout | `gws` exits with non-zero from `auth login` | Retry once with `--prompt select_account+consent`; on second failure, report |
| Smoke test 403 (wrong scope) | API call returns `insufficient_scope` | If profile is `@gmail.com` and scope is `keep` → known limitation, mark non-fatal. Else: re-auth with the missing scope |
| Profile says authenticated but token expired | `gmail getProfile` returns 401 | `gwcli profiles auth <name>` to refresh |
| Two OAuth clients with same name | Console blocks creation | Suffix with timestamp: `gws-cli-<unix>` |
| Orphaned profile from earlier run | exists in `profiles list` but `authenticated == false` AND > 1 h old | Auto-remove with `--force`, log to user |

## Implementation phases for THIS plan

Building the agent automation itself, in landing order:

1. **`gwcli bootstrap status` + `plan`** — read-only manifest. Cheap to ship,
   immediately useful even before the rest is done. Lets agents make
   decisions today against the current install.
2. **`gwcli bootstrap auth <names…>` (loop wrapper)** — depends on Issue #2 of
   sibling plan landing. Replaces the visible-terminal workaround.
3. **`gwcli bootstrap verify`** — wraps the per-profile smoke tests we did
   manually. Pure UX win.
4. **`gwcli bootstrap gcp` (gcloud path)** — only the gcloud branch. Quick,
   unblocks the population that has gcloud installed.
5. **`gwcli bootstrap gcp` (Playwright path)** — the harder branch. Needs the
   `references/oauth-bootstrap.md` doc (sibling Issue #6) to land first or
   in the same PR.
6. **`gwcli bootstrap oauth-client` (Playwright + secret capture)** — the
   final non-trivial piece. Capture-via-accessibility-leak with fallbacks.
7. **`gwcli bootstrap clean`** — orphan secret disable, stale profile prune.
8. **`gwcli bootstrap` (full pipeline)** — composes all of the above. Last to
   land because it depends on everything.

Each phase ships behind a feature flag so partial functionality is shippable.

## Verification matrix for THIS plan

A clean Windows / macOS / Linux machine, with Node 18+ and a default browser,
must achieve all of these from a single user prompt:

- [ ] `npm install -g <package>` succeeds (Issue #1)
- [ ] `gwcli bootstrap status` outputs accurate manifest, no writes
- [ ] `gwcli bootstrap` end-to-end on a new GCP project, with **no** existing
      OAuth client, completes for 1 account in ≤ 5 min of human time
      (sign-in + consent only)
- [ ] Same machine, second run with `--accounts a,b,c`: skips done work,
      adds 2 new accounts, total time ≤ 3 min (per-account OAuth only)
- [ ] Mid-run kill (Ctrl+C after Phase 2, before Phase 4): re-run picks up
      cleanly, no duplicate projects/clients
- [ ] Same flow on a machine **with** `gcloud` already authenticated:
      Phase 2 takes < 30 s (gcloud path), Phase 3 still uses Playwright
- [ ] Agent-driven (no human at the keyboard except for the OAuth consent
      click): runs to completion under an `opencode` / `claude-code` agent
      with no `[BLOCKED]` events except the consent prompt

## Out of scope / Future work

- **Workspace admin domain-wide delegation** — different OAuth flow (service
  account + admin console). Tracked separately if/when needed.
- **Token rotation / scheduled refresh.** gws already refreshes; we don't
  need to schedule it.
- **Cross-machine config sync.** A user with `gwcli bootstrap`-generated
  state on machine A should be able to copy it to machine B. Today the
  encrypted credentials are bound to the local keyring backend; this would
  need a `gwcli profiles export/import` first.
- **Multi-tenant / multi-project.** This plan assumes one GCP project per
  install. Supporting `--project` per-profile is a small extension on top.
- **Fully unattended consent.** Not possible with personal accounts. With
  Workspace + admin-installed apps, the OAuth consent click can be skipped
  via internal-app + DwD; out of scope here.

## References

- Live session that motivated this plan: opencode session `2026-05-19/20`
- Sibling plan with prerequisite fixes:
  [`plans/install-and-bootstrap-fixes/README.md`](../install-and-bootstrap-fixes/README.md)
- Existing design doc:
  [`plans/gws-multiprofile/README.md`](../gws-multiprofile/README.md)
- Skill source:
  [`skill/SKILL.md`](../../skill/SKILL.md)
- Skill troubleshooting:
  [`skill/references/troubleshooting.md`](../../skill/references/troubleshooting.md)
- `playwright-cli` skill:
  [`~/.config/opencode/skills/playwright-cli/SKILL.md`](file:///C:/Users/avita_n145/.config/opencode/skills/playwright-cli/SKILL.md)
- `gws` upstream: https://github.com/googleworkspace/cli
- gcloud OAuth client API limitations:
  https://cloud.google.com/iap/docs/programmatic-oauth-clients
- OAuth client_secret hashing (post-creation viewing deprecation):
  https://support.google.com/cloud/answer/15549257#client-secret-hashing
