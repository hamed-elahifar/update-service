// --------------------- // بسم الله الرحمن الرحيم // --------------------- //
console.clear();
const { spawn } = require("child_process");
const express = require("express");

const expressApp = express();
expressApp.set("trust proxy", 1);
expressApp.use(require("cors")());
expressApp.use(express.json());
expressApp.use(express.urlencoded({ extended: true }));

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
      reject(allOutput);
    });

    result.on("close", (code) => {
      resolve(allOutput);
    });
  });
};

const gitPull = {};
const restartPm2Process = {};
const pmInstall = {};
const pmRunBuild = {};
const appsName = [];

apps.forEach((app) => {
  gitPull[app.name] = () => {
    const gitDir = `--git-dir='${app.path}/.git' --work-tree=${app.path}`;
    const command =
      `git ${gitDir} reset --hard` +
      ` && ` +
      `git ${gitDir} checkout ${app.branch}` +
      ` && ` +
      `git ${gitDir} pull --all`;
    return executeCommand(command);
  };

  pmInstall[app.name] = () => {
    const command =
      app.pm === "bun"
        ? `bun install --cwd ${app.path}`
        : app.pm === "npm"
          ? `npm --prefix ${app.path} install`
          : app.pm === "pnpm"
            ? `pnpm --dir ${app.path} install`
            : null;
    return executeCommand(command);
  };

  pmRunBuild[app.name] = () => {
    const command =
      app.pm === "bun"
        ? `bun run build --cwd ${app.path}`
        : app.pm === "npm"
          ? `npm --prefix ${app.path} run build`
          : app.pm === "pnpm"
            ? `pnpm --dir ${app.path} run build`
            : null;
    return executeCommand(command);
  };

  restartPm2Process[app.name] = () => {
    const command = `pm2 restart "${app.name}"`;
    return executeCommand(command);
  };

  appsName.push(app.name);
});

expressApp.all("/:appName/:pass", async (req, res) => {
  const { appName, pass } = req.params;
  let allOutput = "";

  console.log(`Received update request for app: ${appName}`);
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);
  console.log("Query:", req.query);
  console.log("IP:", req.ip);
  console.log("Method:", req.method);

  if (pass != password) {
    res.send("Unauthorized!");
    return;
  }

  if (!appsName.includes(appName)) {
    res.send("Wrong app name");
    return;
  }

  try {
    const updateResult = await gitPull[appName]();
    allOutput += updateResult + "\n\n";

    // if (!allOutput.includes("Already up to date.")) {
    const pmInstallResult = await pmInstall[appName]();
    allOutput += pmInstallResult + "\n\n";

    const appBuildResult = await pmRunBuild[appName]();
    allOutput += appBuildResult + "\n\n";

    const restartResult = await restartPm2Process[appName]();
    allOutput += restartResult + "\n\n";
    // }
  } catch (error) {
    allOutput += "Error during update process:\n" + error + "\n\n";
  } finally {
    res.send(allOutput);
  }
});

expressApp.listen(port, () =>
  console.log(`Update service is running on ${port} \npassword: ${password}`),
);

process.on("uncaughtException", (ex) => {
  console.log("uncaughtException", ex);
});
process.on("unhandledRejection", (ex) => {
  console.log("unhandledRejection", ex);
});
