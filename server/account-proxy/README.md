# Account proxy

A small Cloudflare Worker that lets the launcher register an account, change a player name or password and read the server launch schedule without shipping any admin credentials to the client.

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

## Launch schedule

The opening time of the server is the `LAUNCH_OPENS_AT` variable in `wrangler.toml`. The value is read as Moscow time (MSK, UTC+3) in the format `YYYY-MM-DD HH:mm`, for example `"2026-12-01 18:00"`. An empty or invalid value means the server is always open.

```
POST /launch/status
{ "username": "...", "accessToken": "...", "clientToken": "..." }
```

The body is optional. The response is `{ "code": "ok", "now": <ms>, "opensAt": <ms or null>, "open": <bool>, "admin": <bool> }`. While the server is closed, the worker validates the access token with the Drasl Yggdrasil API and reports `admin: true` for users that have the admin flag in Drasl. The launcher lets players download and verify the game files at any time, waits with a countdown before starting the game, and starts it right away for admins.

To change the time without a deploy, edit the variable in the Cloudflare dashboard (Workers, Settings, Variables).

The check is a launcher side gate. To keep the game itself closed, enable a whitelist on the game server as well.

## Hardening

Add a Cloudflare rate limiting rule for `/account/update` (for example 10 requests per minute per IP) so `/account/update` cannot be used to guess passwords faster than the Drasl login itself allows. Apply a similar rule to `/account/register` to limit account spam.
