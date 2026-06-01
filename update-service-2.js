// --------------------- // بسم الله الرحمن الرحيم // --------------------- //
console.clear();
const { spawn } = require("child_process");
const http = require("http");

const config = require("./config.json");

const { apps, port, password } = config;

const streamCommand = (command, res) => {
  return new Promise((resolve, reject) => {
    console.log(`>>> ${command}`);

    const result = spawn(command, { shell: true });

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

const appsName = [];
const runDeploy = {};

apps.forEach((app) => {
  appsName.push(app.name);
  runDeploy[app.name] = (res) => {
    const deployScript = `${app.path}/bin/deploy.sh`;
    return streamCommand(`bash "${deployScript}"`, res);
  };
});

const server = http.createServer(async (req, res) => {
  const parts = req.url.split("/").filter(Boolean);
  const [appName, pass] = parts;

  console.log(`Received update request for app: ${appName}`);
  console.log("Headers:", req.headers);
  console.log("IP:", req.socket.remoteAddress);
  console.log("Method:", req.method);

  if (pass != password) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("Unauthorized!");
    return;
  }

  if (!appsName.includes(appName)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Wrong app name");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Transfer-Encoding": "chunked",
    "X-Content-Type-Options": "nosniff",
  });

  try {
    await runDeploy[appName](res);
    res.end("\n\nDone.\n");
  } catch (error) {
    res.end("\n\nError during deploy:\n" + error + "\n");
  }
});

server.listen(port, () =>
  console.log(`Update service is running on ${port} \npassword: ${password}`),
);

process.on("uncaughtException", (ex) => {
  console.log("uncaughtException", ex);
});
process.on("unhandledRejection", (ex) => {
  console.log("unhandledRejection", ex);
});
