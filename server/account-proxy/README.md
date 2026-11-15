# Account proxy

A small Cloudflare Worker that lets the launcher change a player name or password without shipping any admin credentials to the client.

The launcher sends the username and current password to `POST /account/update`. The worker checks them against the Drasl authentication server and only then calls the Drasl admin API with a token that exists solely as a Worker secret.

## Deploy

```
cd server/account-proxy
npx wrangler secret put DRASL_ADMIN_TOKEN
npx wrangler deploy
```

`DRASL_URL` and the route are configured in `wrangler.toml`. The launcher reads the public address from `ACCOUNT_API_URL` in `app/assets/js/apiconstants.js`.

## Request

```
POST /account/update
{ "username": "...", "password": "...", "playerName": "...", "newPassword": "..." }
```

At least one of `playerName` and `newPassword` is required. Responses are JSON of the form `{ "code": "ok" | "wrongPassword" | "rateLimited" | "nameTaken" | "rejected" | "unavailable" }`.

## Hardening

Add a Cloudflare rate limiting rule for `/account/update` (for example 10 requests per minute per IP) so the endpoint cannot be used to guess passwords faster than the Drasl login itself allows.
