console.clear();
const { exec } = require("child_process");
const expressApp = require("express")();

const config = require("./config.json");

const { apps, port, password } = config;

const gitPull = {};
const restartPm2Process = {};
const appsName = [];

apps.forEach((app) => {
  gitPull[app.name] = () =>
    new Promise((resolve, reject) => {
      exec(
        `git --git-dir='${app.path}/.git' --work-tree=${app.path} pull`,
        (err, stdout, stderr) => {
          if (err) {
            console.log(err);
            reject(err);
          }
          if (stderr) {
            console.log(stderr);
            reject(stderr);
          }
          resolve(stdout);
        }
      );
    });

  restartPm2Process[app.name] = () =>
    new Promise((resolve, reject) => {
      exec(`pm2 restart ${app.name}`, (err, stdout, stderr) => {
        if (err) {
          console.log(err);
          reject(err);
        }
        if (stderr) {
          console.log(stderr);
          reject(stderr);
        }
        console.log(`Project ${app.name} restarted`);
        resolve(stdout);
      });
    });

  appsName.push(app.name);
});

expressApp.all("/update/:appName/:pass", async (req, res) => {
  const { appName, pass } = req.params;

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

  if (updateResult != "Already up to date.") {
    const restartResult = await restartPm2Process[appName]();
    console.log(restartResult);
  }
});

expressApp.listen(port, () => console.log(`update service is running on ${port}`));
