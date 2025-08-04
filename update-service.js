console.clear();
const { exec, spawn } = require("child_process");

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
        app.pm === "npm"
          ? `npm --prefix ${app.path} install`
          : `pnpm --dir ${app.path} install`;

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
        app.pm === "npm"
          ? `npm --prefix ${app.path} run build`
          : `pnpm --dir ${app.path} run build`;

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

expressApp.all("/update/:appName/:pass", async (req, res) => {
  const { appName, pass } = req.params;

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
  res.send(updateResult);

  const pmInstallResult = await pmInstall[appName]();
  console.log(pmInstallResult);

  const appBuildResult = await pmRunBuild[appName]();
  console.log(appBuildResult);

  if (updateResult != "Already up to date.") {
    const restartResult = await restartPm2Process[appName]();
    console.log(restartResult);
  }
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
