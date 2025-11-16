// --------------------- // بسم الله الرحمن الرحيم // --------------------- //
console.clear();
const { spawn } = require("child_process");

const expressApp = require("express")();

const config = require("./config.json");

const { apps, port, password } = config;

const executeCommand = (command) => {
  return new Promise((resolve, _) => {
    const result = spawn(command, { shell: true });

    let allOutput = "";

    result.stdout.on("data", (data) => {
      process.stdout.write(data);
      allOutput += data + "\n";
    });

    result.stderr.on("data", (data) => {
      process.stderr.write(data);
      allOutput += data + "\n";
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
  const gitDir = `--git-dir='${app.path}/.git' --work-tree=${app.path}`;

  gitPull[app.name] = () => {
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
    const command = `pm2 restart ${app.name}`;
    return executeCommand(command);
  };

  appsName.push(app.name);
});

expressApp.all("/update-service/:appName/:pass", async (req, res) => {
  const { appName, pass } = req.params;
  let allOutput = "";

  console.log(`Received update request for app: ${appName}`);

  if (pass != password) {
    res.send("incorrect credentials");
    return;
  }

  if (!appsName.includes(appName)) {
    res.send("wrong app name");
    return;
  }

  const updateResult = await gitPull[appName]();
  allOutput += updateResult + "\n";

  if (!allOutput.includes("Already up to date.")) {
    const pmInstallResult = await pmInstall[appName]();
    allOutput += pmInstallResult + "\n";

    const appBuildResult = await pmRunBuild[appName]();
    allOutput += appBuildResult + "\n";

    if (updateResult != "Already up to date.") {
      const restartResult = await restartPm2Process[appName]();
      allOutput += restartResult + "\n";
    }
  }

  res.send(allOutput);
});

expressApp.listen(port, () =>
  console.log(`update service is running on ${port}`)
);

process.on("uncaughtException", (ex) => {
  console.log("uncaughtException", ex);
});
process.on("unhandledRejection", (ex) => {
  console.log("unhandledRejection", ex);
});
