// --------------------- // بسم الله الرحمن الرحيم // --------------------- //
// Manually trigger an update, signed the same way GitHub signs its webhooks.
// Usage: node do-update.js <app-name> [host]
const http = require("http");
const crypto = require("crypto");

const config = require("./config.json");

const { port, webhookSecret } = config;

const [, , appName, host = "localhost"] = process.argv;

if (!appName) {
  console.error("Usage: node do-update.js <app-name> [host]");
  process.exit(1);
}

const payload = JSON.stringify({ action: "update", app: appName });
const signature =
  "sha256=" +
  crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");

const req = http.request(
  {
    hostname: host,
    port,
    path: `/${appName}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "X-Hub-Signature-256": signature,
      "X-GitHub-Event": "push",
    },
  },
  (res) => {
    res.pipe(process.stdout);
    res.on("end", () => process.exit(res.statusCode === 200 ? 0 : 1));
  },
);

req.on("error", (err) => {
  console.error("Request failed:", err.message);
  process.exit(1);
});

req.write(payload);
req.end();
