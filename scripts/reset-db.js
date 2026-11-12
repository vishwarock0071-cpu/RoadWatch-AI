#!/usr/bin/env node
// Deletes the database and uploaded photos so the next start re-creates
// everything from scratch (with demo data unless SEED_DEMO=false).
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const config = require("../server/config");

function reset() {
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(config.dbFile + ext, { force: true });
  fs.rmSync(config.uploadDir, { recursive: true, force: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  console.log("Database and uploaded photos deleted. Start the app to create a fresh database.");
}

if (process.argv.includes("--yes")) reset();
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("This deletes ALL cases, users you created and uploaded photos. Type 'yes' to continue: ", (a) => {
    rl.close();
    if (a.trim().toLowerCase() === "yes") reset(); else console.log("Cancelled.");
  });
}
