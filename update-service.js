console.clear();
const { spawn } = require("child_process");

const expressApp = require("express")();

const config = require("./config.json");

const { apps, port, password } = config;

const gitPull = {};
const restartPm2Process = {};
const pmInstall = {};
const pmRunBuild = {};
const appsName = [];

apps.forEach((app) => {
  gitPull[app.name] = () =>
    new Promise((resolve, reject) => {
      const command = `git --git-dir='${app.path}/.git' --work-tree=${app.path} pull`;

      const result = spawn(command, { shell: true });

      let allOutput = "";

      result.stdout.on("data", (data) => {
        process.stdout.write(data);
        allOutput += data;
      });

      result.stderr.on("data", (data) => {
        process.stderr.write(data);
        allOutput += data;
      });

      result.on("close", (code) => {
        resolve(allOutput);
      });
    });

  pmInstall[app.name] = () =>
    new Promise((resolve, reject) => {
      const command =
        app.pm === "bun"
          ? `bun install --cwd ${app.path}`
          : app.pm === "npm"
          ? `npm --prefix ${app.path} install`
          : app.pm === "pnpm"
          ? `pnpm --dir ${app.path} install`
          : null;

      const result = spawn(command, { shell: true });

      let allOutput = "";

      result.stdout.on("data", (data) => {
        process.stdout.write(data);
        allOutput += data;
      });

      result.stderr.on("data", (data) => {
        process.stderr.write(data);
        allOutput += data;
      });

      result.on("close", (code) => {
        resolve(allOutput);
      });
    });

  pmRunBuild[app.name] = () =>
    new Promise((resolve, reject) => {
      const command =
        app.pm === "bun"
          ? `bun run build --cwd ${app.path}`
          : app.pm === "npm"
          ? `npm --prefix ${app.path} run build`
          : app.pm === "pnpm"
          ? `pnpm --dir ${app.path} run build`
          : null;

      const result = spawn(command, { shell: true });

      let allOutput = "";

      result.stdout.on("data", (data) => {
        process.stdout.write(data);
        allOutput += data;
      });

      result.stderr.on("data", (data) => {
        process.stderr.write(data);
        allOutput += data;
      });

      result.on("close", (code) => {
        resolve(allOutput);
      });
    });

  restartPm2Process[app.name] = () =>
    new Promise((resolve, reject) => {
      const command = `pm2 restart ${app.name}`;

      const result = spawn(command, { shell: true });

      let allOutput = "";

      result.stdout.on("data", (data) => {
        process.stdout.write(data);
        allOutput += data;
      });

      result.stderr.on("data", (data) => {
        process.stderr.write(data);
        allOutput += data;
      });

      result.on("close", (code) => {
        resolve(allOutput);
      });
    });

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
  allOutput += updateResult;
  allOutput += "\n";

  const pmInstallResult = await pmInstall[appName]();
  allOutput += pmInstallResult;
  allOutput += "\n";

  const appBuildResult = await pmRunBuild[appName]();
  allOutput += appBuildResult;
  allOutput += "\n";

  if (updateResult != "Already up to date.") {
    const restartResult = await restartPm2Process[appName]();
    allOutput += restartResult;
    allOutput += "\n";
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
