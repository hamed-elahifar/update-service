# Secure GitHub Webhook Endpoint for Service Update

## Goal

Restrict the endpoint:

```text
http://103.75.197.213:7777/zayche-html/123123123
```

so that:

- Only **GitHub webhook deliveries** and **you** (via manual calls with the same secret) can successfully trigger it.
- All other requests are rejected.
- The backend is served via **Caddy** on the same host.

We will:

1. Use a **webhook secret** and validate the `X-Hub-Signature-256` header.
2. Keep Caddy as a simple reverse proxy; all security logic lives in the backend (Node.js/NestJS).

---

## 1. GitHub Webhook Setup

In your GitHub repository:

1. Go to: **Settings → Webhooks → Add webhook**.
2. Configure:
   - **Payload URL**:
     ```text
     http://103.75.197.213:7777/zayche-html/123123123
     ```
   - **Content type**: `application/json`
   - **Secret**: generate a high-entropy random string (e.g., 32+ chars).  
     Save this as `YOUR_WEBHOOK_SECRET_HERE`.
   - **Events**: choose what you need (e.g., `push`, `pull_request`).
3. Save the webhook.

You will use this secret in your backend to validate all incoming webhook requests.

---

## 2. Caddy Configuration

Keep Caddy as a simple reverse proxy. Security is enforced in the backend.

### Basic Caddyfile

```caddy
http://103.75.197.213:7777 {
    # Only allow the webhook endpoint
    route /zayche-html/* {
        reverse_proxy http://localhost:8080
    }

    # Everything else on this host
    handle {
        respond "Not found" 404
    }
}
```

---

## 3. Backend: Node.js / NestJS Webhook Handler

### 3.1. Signature Validation Utility

Create a utility file (e.g., `webhook-signature.ts`):

```ts
import { createHmac } from "crypto";

export const WEBHOOK_SECRET = "YOUR_WEBHOOK_SECRET_HERE"; // from GitHub webhook settings

export function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature.startsWith("sha256=")) {
    return false;
  }

  const expected =
    "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  return signature === expected;
}
```

### 3.2. Raw Body Handling (Express)

NestJS's default JSON body parser does not give you the raw string needed for signature validation. For this route, use Express's `raw` body parser.

In your main Express/NestJS bootstrap (e.g., `main.ts` or an Express adapter setup):

```ts
import { json, raw } from "body-parser";
import { Router } from "express";

const webhookRouter = Router();

// Only for the webhook route: use raw body
webhookRouter.post(
  "/zayche-html/:id",
  raw({ type: "application/json" }),
  (req, res) => {
    const payloadStr = req.body.toString(); // raw body as string
    const signature = (req.headers["x-hub-signature-256"] as string) || "";
    const event = (req.headers["x-github-event"] as string) || "";

    // Validate signature
    if (!verifyGitHubSignature(payloadStr, signature, WEBHOOK_SECRET)) {
      return res
        .status(403)
        .json({ error: "Forbidden: invalid GitHub signature" });
    }

    // Optional: restrict to specific events
    if (event !== "push") {
      return res.status(403).json({ error: "Forbidden: unsupported event" });
    }

    // TODO: implement your "update one of my services" logic here
    // Example:
    // await updateYourService(payloadStr);

    return res.status(200).json({ ok: true, event });
  },
);

// Attach to your Express app / NestJS HTTP adapter
// app.use(webhookRouter);
```

If you are using NestJS with Express:

```ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { json, raw } from "body-parser";
import { Router } from "express";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const httpServer = app.getHttpServer(); // Express instance

  const webhookRouter = Router();

  webhookRouter.post(
    "/zayche-html/:id",
    raw({ type: "application/json" }),
    (req, res) => {
      // ... same logic as above
    },
  );

  httpServer.use(webhookRouter);

  await app.listen(8080);
}

bootstrap();
```

This ensures that:

- GitHub webhooks with the correct secret succeed.
- Any other request without a valid signature is rejected with `403 Forbidden`.

You can also manually call this endpoint with the same signature mechanism if you want "only me and GitHub" to use it.

---

## 4. Manual Calls (Optional)

If you want to call the endpoint manually from your own machines, you can use the same secret and compute the signature:

```bash
PAYLOAD='{"action":"update"}'
SECRET='YOUR_WEBHOOK_SECRET_HERE'
SIG="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | xxd -p)"

curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  -H "X-GitHub-Event: push" \
  -d "$PAYLOAD" \
  http://103.75.197.213:7777/zayche-html/123123123
```

This ensures that only:

- GitHub (with the secret configured in the webhook), and
- You (who knows the secret and can compute the signature)

can successfully call the endpoint.

---

## 5. Deliverables for the Coding Agent

The agent should:

1. Update or create the Caddyfile as in section 2.
2. Add the webhook signature validation utility and route handler as in section 3.
3. Ensure:
   - All requests to `/zayche-html/*` require a valid `X-Hub-Signature-256`.
   - Invalid signatures return `403 Forbidden`.
   - Only configured events (e.g., `push`) are accepted.
4. After changes:
   - Restart/reload Caddy.
   - Restart the Node.js/NestJS service.
   - Test with:
     - A real GitHub webhook event.
     - A manual `curl` using the signature.
     - A request without a valid signature (should fail).
