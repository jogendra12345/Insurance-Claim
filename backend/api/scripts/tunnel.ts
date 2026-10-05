// Starts the ngrok tunnel that gives Meta's WhatsApp webhook a fixed public
// URL (RUNNING-LOCALLY.md §8). Runs alongside `npm run dev`, not on boot —
// the tunnel is useless without the API behind it.
//
// Looks for ngrok on PATH first, then in winget's install folders: winget
// only updates PATH for terminals opened after the install, so a plain
// `ngrok` fails in any shell that was already open.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ENDPOINT = "claimflow-whatsapp";

function findNgrok(): string | null {
  const onPath = spawnSync("ngrok", ["version"], { stdio: "ignore", shell: true });
  if (onPath.status === 0) return "ngrok";

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const winget = join(localAppData, "Microsoft", "WinGet");
  const link = join(winget, "Links", "ngrok.exe");
  if (existsSync(link)) return link;

  const packages = join(winget, "Packages");
  if (!existsSync(packages)) return null;
  for (const dir of readdirSync(packages)) {
    const exe = join(packages, dir, "ngrok.exe");
    if (dir.startsWith("Ngrok.Ngrok") && existsSync(exe)) return exe;
  }
  return null;
}

const ngrok = findNgrok();
if (!ngrok) {
  console.error(
    "ngrok not found. Install it (winget install Ngrok.Ngrok) and set it up per RUNNING-LOCALLY.md §8.",
  );
  process.exit(1);
}

const child = spawn(ngrok, ["start", ENDPOINT, ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
