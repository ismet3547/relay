import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venv = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python =
  process.env.RELAY_PYTHON ||
  (fs.existsSync(venv)
    ? venv
    : process.platform === "win32"
      ? "python"
      : "python3");
const mode = process.argv[2] || "dev";
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === "win32" && child.pid && child.exitCode === null) {
      // Windows SIGTERM cannot run Python's finally block. Stop FFmpeg descendants too;
      // the next worker recovers the persisted claim and cleans temporary audio.
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false,
      }).on("error", () => child.kill());
    } else child.kill("SIGTERM");
  }
  const timeout = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 6000);
  timeout.unref();
  process.exitCode = code;
}
function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`Could not start ${command}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
if (mode === "download")
  run(python, ["transcription/worker.py", "--download-model"]);
else if (mode === "check") run(python, ["transcription/worker.py", "--check"]);
else if (mode === "test")
  run(python, [
    "-m",
    "unittest",
    "discover",
    "-s",
    "transcription",
    "-p",
    "test_*.py",
  ]);
else if (mode === "worker") run(python, ["transcription/worker.py"]);
else {
  run(python, ["transcription/worker.py"]);
  run(process.execPath, [
    "node_modules/next/dist/bin/next",
    mode === "start" ? "start" : "dev",
    "--hostname",
    "127.0.0.1",
  ]);
}
