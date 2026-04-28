# OAuth Setup — Google + GitHub

AgentPlanner ships with optional Google and GitHub OAuth login. Both
are **off by default**: if you don't set the relevant env vars, the
sign-in pages render with the email/password form only. Setting the
vars makes the buttons appear automatically (driven by
`GET /auth/oauth/providers`).

This doc covers the one-time console setup for each provider, the env
vars to set on the API container, and the redirect URI you need to
whitelist.

---

## Redirect URI

Both providers send the user back to the **same** path after
authorizing — the app distinguishes them with a `state` query param.

| Environment | Redirect URI |
|-------------|--------------|
| Local dev   | `http://localhost:3001/auth/callback` |
| Production  | `https://agentplanner.io/auth/callback` |
| Self-host   | `https://YOUR_DOMAIN/auth/callback` |

Whitelist this exact URI in both Google and GitHub consoles. Mismatches
are the #1 cause of OAuth failures and Google in particular is strict
about the trailing slash.

---

## Google

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Pick (or create) a project, then **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Authorized redirect URIs: add the URI from the table above.
5. Copy the **Client ID** and **Client secret**.
6. Set on the API container:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   GOOGLE_REDIRECT_URI=https://YOUR_DOMAIN/auth/callback
   ```
7. (First time only) On the OAuth consent screen, set the app name,
   support email, and add the `openid email profile` scopes. For
   internal-only deployments you can publish in **Internal** mode.

The login flow uses `openid email profile` scopes — enough for
account creation but no Drive / Gmail / Calendar access.

---

## GitHub

1. Go to <https://github.com/settings/developers> → **OAuth Apps** →
   **New OAuth App** (or use an org-level app at
   `https://github.com/organizations/YOUR_ORG/settings/applications`).
2. Application name + homepage URL (whatever you want).
3. Authorization callback URL: the redirect URI from the table above.
4. Generate a client secret and copy both values.
5. Set on the API container:
   ```
   GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
   GITHUB_CLIENT_SECRET=...
   GITHUB_REDIRECT_URI=https://YOUR_DOMAIN/auth/callback
   ```

The flow requests `read:user user:email` — enough to fetch the user's
primary email and profile, no repo access.

---

## How account linking works

Users are linked first by the stable provider id (Google `sub`,
GitHub user id). If no row matches, the server falls back to email
match — so a user who first signed up with email/password can later
log in with Google using the same email and the OAuth identity will
attach to the existing account. New emails create new accounts.

| User has | Logs in with | Result |
|----------|--------------|--------|
| password account, `alice@x.com` | Google `alice@x.com` | Google linked to the existing account |
| Google account, `sub=12345` | Google `sub=12345` (email changed) | Same account, email updated to new Google email |
| nothing | Google | New account created with no password (OAuth-only) |

OAuth-only accounts have `password_hash = NULL`. They can set a
password later via Settings → Security if they want a fallback method.

---

## Removing a provider

To disable OAuth on a deployment, just unset the env vars. The
`/auth/oauth/providers` endpoint will stop advertising it and the
buttons will disappear from the sign-in pages on next page load.
Existing users with that provider linked can still log in via
email/password if their account has a password set, or via the other
provider if they linked both.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| "redirect_uri_mismatch" from Google | The `GOOGLE_REDIRECT_URI` env var doesn't exactly match what's whitelisted in Google Console (case, trailing slash, scheme) |
| GitHub returns `bad_verification_code` | Authorization codes are single-use and expire in 10 minutes — usually means a stale callback hit |
| Buttons not appearing on `/login` | `/auth/oauth/providers` returned an empty list — env vars probably aren't on the API container; `docker compose exec api env \| grep -E '^(GOOGLE\|GITHUB)_'` to check |
| "Email is not verified" | User's Google account email isn't verified — they need to verify it in their Google account settings first |
