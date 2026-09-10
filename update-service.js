// --------------------- // بسم الله الرحمن الرحيم // --------------------- //
console.clear();
const { spawn } = require("child_process");
const http = require("http");
const crypto = require("crypto");
const Sentry = require("@sentry/node");

const config = require("./config.json");

const { apps, port, webhookSecret, sentryDsn } = config;

const selectDeployments = (app, branch) =>
  branch
    ? app.deployments.filter((deployment) => deployment.branch === branch)
    : app.deployments;

if (process.argv.includes("--self-test")) {
  const assert = require("node:assert/strict");
  const app = {
    deployments: [{ branch: "master" }, { branch: "develop" }],
  };

  assert.deepEqual(selectDeployments(app), app.deployments);
  assert.deepEqual(selectDeployments(app, "develop"), [app.deployments[1]]);
  console.log("Self-test passed");
  process.exit(0);
}

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

const runDeployment = (deployment, res) => {
  const deployScript = `${deployment.path}/bin/deploy.sh`;
  const args = [deployScript, deployment.branch];
  // `env` lets two checkouts of one repo deploy to different targets — the
  // pm2 app name and port live here, not in the shared ecosystem config.
  return streamCommand("bash", args, res, deployment.env);
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

    const app = apps.find((candidate) => candidate.name === appName);
    const deployments = app ? selectDeployments(app, urlBranch) : [];

    if (!deployments.length) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Wrong app name or branch");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Content-Type-Options": "nosniff",
    });

    try {
      for (const deployment of deployments) {
        res.write(
          `\n=== ${app.name}:${deployment.branch} (${deployment.path}) ===\n`,
        );
        await runDeployment(deployment, res);
      }
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
