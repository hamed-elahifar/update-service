# do-update.js

Manually trigger a deploy on the update-service, signed the same way GitHub
signs its webhook deliveries (`X-Hub-Signature-256` HMAC-SHA256 over the
request body, using `webhookSecret` from `config.json`).

## Usage

```bash
node do-update.js <app-name> <branch> [host]
```

- `app-name` + `branch` — must match a `name`/`branch` pair under `apps` in
  `config.json`. This lets you keep multiple copies of the same project on
  the server (e.g. one per branch) and target the right one.
- `host` — optional, defaults to `localhost`. Use this to trigger a deploy on
  a remote server (the service's `port` from `config.json` is used either way).

## Examples

Trigger a deploy on the local machine:

```bash
node do-update.js iEA master
```

Trigger a deploy on a remote server:

```bash
node do-update.js zayche-html staging 103.75.197.213
```

## Output

Deploy output is streamed live to your terminal as it happens (same stream
GitHub webhook deliveries get). The process exits `0` on success (HTTP 200)
or `1` on failure (invalid signature, unknown app name/branch pair, request
error, or a non-zero deploy exit code).

## Requirements

Run from the `update-service` directory (or anywhere `./config.json` resolves
correctly) — it reads `port` and `webhookSecret` from there.
