// --------------------- // بسم الله الرحمن الرحيم // --------------------- //
console.clear();
const { spawn } = require("child_process");
const http = require("http");

const config = require("./config.json");

const { apps, port, password } = config;

const executeCommand = (command) => {
  return new Promise((resolve, reject) => {
    console.log(`>>> ${command}`);

    const result = spawn(command, { shell: true });

    let allOutput = "";

    result.stdout.on("data", (data) => {
      process.stdout.write(data + "\n");
      allOutput += data + "\n";
    });

    result.stderr.on("data", (data) => {
      process.stderr.write(data + "\n");
      allOutput += data + "\n";
    });

    result.on("close", (code) => {
      if (code === 0) {
        resolve(allOutput);
      } else {
        reject(allOutput + `\nCommand exited with code ${code}`);
      }
    });
  });
};

const runDeploy = {};
const appsName = [];

apps.forEach((app) => {
  runDeploy[app.name] = () => {
    const deployScript = `${app.path}/bin/deploy.sh`;
    return executeCommand(`bash "${deployScript}"`);
  };

  appsName.push(app.name);
});

const server = http.createServer(async (req, res) => {
  const parts = req.url.split("/").filter(Boolean);
  const [appName, pass] = parts;

  console.log(`Received update request for app: ${appName}`);
  console.log("Headers:", req.headers);
  console.log("IP:", req.socket.remoteAddress);
  console.log("Method:", req.method);

  const send = (text) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(text);
  };

  if (pass != password) {
    send("Unauthorized!");
    return;
  }

  if (!appsName.includes(appName)) {
    send("Wrong app name");
    return;
  }

  let allOutput = "";

  try {
    const deployResult = await runDeploy[appName]();
    allOutput += deployResult + "\n\n";
  } catch (error) {
    allOutput += "Error during deploy:\n" + error + "\n\n";
  } finally {
    send(allOutput);
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
