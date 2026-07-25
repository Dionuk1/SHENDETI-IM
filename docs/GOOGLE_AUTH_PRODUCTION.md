# Existing Google authentication in production

This phase preserves the current Google Identity Services ID-token flow. It does
not migrate active authentication to Appwrite Auth.

## Verified flow

1. The browser loads Google Identity Services.
2. The backend exposes the public `GOOGLE_CLIENT_ID` through
   `GET /api/auth/google-config`.
3. The browser sends the Google credential to `POST /api/auth/google`.
4. Express validates the ID token, audience, verified email, account status, and
   account-linking rules, then returns the existing application JWT.

There is no implemented OAuth redirect callback route and no Google client
secret is used by this flow. Do not invent a redirect URI.

## Google Cloud Console

For the OAuth 2.0 **Web application** client:

- Authorized JavaScript origins:
  - `https://shendeti-im.me`
  - the exact Appwrite Sites preview origin used for staging
  - `http://localhost:5500` for the existing local full-stack app
  - the exact local static frontend origin used during development
- Authorized redirect URIs:
  - none for the current ID-token callback flow

Set `GOOGLE_CLIENT_ID` only in the Render environment. It is returned to the
browser by design, but it should still be managed centrally. Do not configure or
expose a Google client secret because the current code does not use one.

The future Appwrite Auth OAuth configuration remains documented separately in
`APPWRITE_BACKEND_MIGRATION_PLAN.md`.
