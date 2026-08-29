// --------------------- // بسم الله الرحمن الرحيم // --------------------- //
console.clear();
const { spawn } = require("child_process");
const http = require("http");
const crypto = require("crypto");
const Sentry = require("@sentry/node");

const config = require("./config.json");

const { apps, port, webhookSecret, sentryDsn } = config;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 0.01, // 1% of transactions — adjust to your needs
    autoSessionTracking: false, // GlitchTip does not support sessions
    // Sends every console.log/info/warn/error/debug call to Sentry as an event
    // (default levels already cover all of them).
    integrations: [Sentry.captureConsoleIntegration()],
  });
}

const streamCommand = (command, args, res, env) => {
  return new Promise((resolve, reject) => {
    console.log(`>>> ${command} ${args.join(" ")}`);

    const result = spawn(command, args, { env: { ...process.env, ...env } });

    result.stdout.on("data", (data) => {
      process.stdout.write(data);
      res.write(data);
    });

    result.stderr.on("data", (data) => {
      process.stderr.write(data);
      res.write(data);
    });

    result.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(`\nCommand exited with code ${code}`);
      }
    });
  });
};

const runAppDeploy = (app, branch, res) => {
  const deployScript = `${app.path}/bin/deploy.sh`;
  const args = branch ? [deployScript, branch] : [deployScript];
  // `env` lets two checkouts of one repo deploy to different targets — the
  // pm2 app name and port live here, not in the shared ecosystem config.
  return streamCommand("bash", args, res, app.env);
};

const verifySignature = (payload, signature) => {
  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);

  return (
    expectedBuf.length === signatureBuf.length &&
    crypto.timingSafeEqual(expectedBuf, signatureBuf)
  );
};

const server = http.createServer((req, res) => {
  const parts = req.url.split("/").filter(Boolean);
  const [appName, urlBranch] = parts;

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks);

    console.log(
      `Received update request for app: ${appName} (${urlBranch || "auto"})`,
    );
    console.log("Headers:", req.headers);
    const clientIp =
      req.headers["cf-connecting-ip"] ||
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket.remoteAddress;
    console.log("IP:", clientIp);
    console.log("Method:", req.method);

    if (!verifySignature(rawBody, req.headers["x-hub-signature-256"])) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: invalid signature");
      return;
    }

    const event = req.headers["x-github-event"];
    if (event === "ping") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ pong: true }));
      return;
    }
    if (event && event !== "push") {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: unsupported event");
      return;
    }

    let pushedBranch = null;
    if (rawBody.length) {
      try {
        const payload = JSON.parse(rawBody.toString("utf8"));
        if (payload.ref) {
          pushedBranch = payload.ref.replace(/^refs\/heads\//, "");
        } else if (payload.branch) {
          pushedBranch = payload.branch;
        }
      } catch {
        // Not JSON (or no body) — nothing to compare the URL branch against.
      }
    }

    let app;
    if (urlBranch) {
      app = apps.find((a) => a.name === appName && a.branch === urlBranch);
    } else {
      const matches = apps.filter((a) => a.name === appName);
      if (matches.length > 1) {
        res.writeHead(409, { "Content-Type": "text/plain" });
        res.end(
          `Ambiguous: multiple copies of '${appName}' exist. Use /${appName}/<branch>.\n`,
        );
        return;
      }
      app = matches[0];
    }

    if (!app) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Wrong app name or branch");
      return;
    }

    // Single-segment requests deploy whatever branch the app's copy is
    // currently on, but a webhook push to another branch is still ignored.
    const effectiveBranch = urlBranch || app.branch;
    if (pushedBranch && pushedBranch !== effectiveBranch) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        `Skipped: push was to '${pushedBranch}', this endpoint watches '${effectiveBranch}'.\n`,
      );
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Content-Type-Options": "nosniff",
    });

    try {
      await runAppDeploy(app, urlBranch, res);
      res.end("\n\nDone.\n");
    } catch (error) {
      res.end("\n\nError during deploy:\n" + error + "\n");
    }
  });
});

server.listen(port, () => console.log(`Update service is running on ${port}`));

process.on("uncaughtException", (ex) => {
  Sentry.captureException(ex);
  console.log("uncaughtException", ex);
});
process.on("unhandledRejection", (ex) => {
  Sentry.captureException(ex);
  console.log("unhandledRejection", ex);
});
