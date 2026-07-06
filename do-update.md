# do-update.js

Manually trigger a deploy on the update-service, signed the same way GitHub
signs its webhook deliveries (`X-Hub-Signature-256` HMAC-SHA256 over the
request body, using `webhookSecret` from `config.json`).

## Usage

```bash
node do-update.js <app-name> [branch] [--host=<host>]
```

- `app-name` — must match a `name` under `apps` in `config.json`.
- `branch` — optional. If the app name has multiple copies configured (e.g.
  one per branch), pass the branch to target the right one — this must match
  a `name`/`branch` pair exactly. If the app name has exactly **one** copy
  configured, you can omit `branch` entirely: the service deploys whatever
  branch that copy's working directory is currently checked out to (via
  `deploy.sh`'s own `git rev-parse --abbrev-ref HEAD` fallback).
- `--host=<host>` — optional, defaults to `localhost`. Use this to trigger a
  deploy on a remote server (the service's `port` from `config.json` is used
  either way).

## Examples

Trigger a deploy on the local machine:

```bash
node do-update.js iEA master
```

Trigger a deploy on a remote server, targeting a specific branch copy:

```bash
node do-update.js tickado-new staging --host=103.75.197.213
```

Trigger a deploy on a remote server for an app with only one copy configured,
deploying whatever branch it's currently on:

```bash
node do-update.js zayche-html --host=103.75.197.213
```

## Output

Deploy output is streamed live to your terminal as it happens (same stream
GitHub webhook deliveries get). The process exits `0` on success (HTTP 200)
or `1` on failure (invalid signature, unknown/ambiguous app name or branch,
request error, or a non-zero deploy exit code).

## Requirements

Run from the `update-service` directory (or anywhere `./config.json` resolves
correctly) — it reads `port` and `webhookSecret` from there.
