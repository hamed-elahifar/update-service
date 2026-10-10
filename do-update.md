# do-update.js

Manually trigger a deploy on the update-service, signed the same way GitHub
signs its webhook deliveries (`X-Hub-Signature-256` HMAC-SHA256 over the
request body, using `webhookSecret` from `config.json`).

## Usage

```bash
node do-update.js <app-name> [branch] [--host=<host>]
```

- `app-name` — must match a `name` under `apps` in `config.json`.
- `branch` — optional. Omit it to run every entry under the app's
  `deployments` array. Pass it to run only the deployment whose `branch`
  matches exactly.
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

Trigger every deployment configured for an app:

```bash
node do-update.js zayche-html --host=103.75.197.213
```

## Output

The endpoint returns `202 Accepted` once the deployment is queued. The deploy
runs in the update-service process; its output and final status appear in the
service logs. The command exits `0` when accepted and `1` on request failure
(invalid signature, unknown app name or branch, or network error).

## Requirements

Run from the `update-service` directory (or anywhere `./config.json` resolves
correctly) — it reads `port` and `webhookSecret` from there.
