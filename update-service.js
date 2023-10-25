/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-var-requires */
console.clear();
const { exec } = require("child_process");
const app = require("express")();

const config = require("./config.json");

const { appsConfig, port } = config;

const apps = {};
const pm2Process = {};
const appsName = [];

appsConfig.forEach((app) => {
  apps[app.name] = () =>
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

  pm2Process[app.name] = () =>
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

app.all("/update/:appName/:pass", async (req, res) => {
  const { appName, pass } = req.params;

  if (pass != config.password) {
    res.send("incorrect credentials");
    return;
  }

  if (!appsName.includes(appName)) {
    res.send("wrong app name");
    return;
  }

  const updateResult = await apps[appName]();
  res.send(updateResult);

  if (updateResult != "Already up to date.") {
    const restartResult = await pm2Process[appName]();
    console.log(restartResult);
  }
});

app.listen(port, () => console.log(`update service is running on ${port}`));
