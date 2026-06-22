const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const requiredFiles = [
  "electron/main.cjs",
  "electron/preload.cjs",
  "src/index.html",
  "src/styles.css",
  "src/renderer.js"
];

for (const file of requiredFiles) {
  const absolute = path.join(__dirname, "..", file);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

for (const file of ["electron/main.cjs", "electron/preload.cjs", "src/renderer.js"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", file)], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`Syntax check failed: ${file}`);
  }
}

console.log("Smoke check passed.");
