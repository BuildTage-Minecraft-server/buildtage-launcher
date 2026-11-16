# Account proxy

A small Cloudflare Worker that lets the launcher register an account and change a player name or password without shipping any admin credentials to the client.

The launcher sends the username and current password to `POST /account/update`. The worker checks them against the Drasl authentication server and only then calls the Drasl admin API with a token that exists solely as a Worker secret.

## Deploy

```
cd server/account-proxy
npx wrangler secret put DRASL_ADMIN_TOKEN
npx wrangler deploy
```

`DRASL_URL` and the route are configured in `wrangler.toml`. The launcher reads the public address from `ACCOUNT_API_URL` in `app/assets/js/apiconstants.js`.

## Register

```
POST /account/register
{ "username": "...", "password": "..." }
```

The username must be 3 to 16 letters, digits or underscores and the password at least 8 characters. The worker creates the user through the Drasl admin API and answers `201` with `{ "code": "ok" }`. A taken name returns `409` with `nameTaken`.

## Update

```
POST /account/update
{ "username": "...", "password": "...", "playerName": "...", "newPassword": "..." }
```

At least one of `playerName` and `newPassword` is required.

Responses of both endpoints are JSON of the form `{ "code": "ok" | "wrongPassword" | "rateLimited" | "nameTaken" | "rejected" | "unavailable" }`.

## Hardening

Add a Cloudflare rate limiting rule for `/account/update` (for example 10 requests per minute per IP) so `/account/update` cannot be used to guess passwords faster than the Drasl login itself allows. Apply a similar rule to `/account/register` to limit account spam.