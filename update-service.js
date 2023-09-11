/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-var-requires */
console.clear();
const { exec } = require("child_process");
const app = require("express")();

const config = require("./config.json");

const appsConfig = config.apps;
const port = config.port;

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

app.all("/update/:app/:pass", async (req, res) => {
  const app = req.params.app;
  const pass = req.params.pass;

  if (!appsName.includes(app)) {
    res.send("wrong app name");
    return;
  }

  if (pass != config.password) {
    res.send("incorrect password");
    return;
  }

  const updateResult = await apps[app]();
  res.send(updateResult);

  if (updateResult != "Already up to date.") {
    const restartResult = await pm2Process[app]();
    console.log(restartResult);
  }
});

app.listen(port, () => console.log(`update service is running on ${port}`));
