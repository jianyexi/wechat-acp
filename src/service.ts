/**
 * Cross-platform service management for wechat-acp.
 *
 * Supports:
 *   - Windows: Task Scheduler (schtasks) — runs at user logon
 *   - macOS:   launchd (LaunchAgents plist) — runs at user login
 *   - Linux:   systemd user service — runs at login (lingering)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { defaultStorageDir } from "./config.js";

const SERVICE_NAME = "wechat-acp";
const SERVICE_LABEL = "com.wechat-acp.bridge"; // macOS bundle id

export interface ServiceConfig {
  agent: string;
  cwd: string;
  configFile?: string;
  idleTimeout?: number;
  maxSessions?: number;
  showThoughts?: boolean;
}

/** Persisted service configuration file path. */
function serviceConfigPath(): string {
  return path.join(defaultStorageDir(), "service.json");
}

/** Save service config so the auto-start process knows what to run. */
export function saveServiceConfig(cfg: ServiceConfig): void {
  const dir = defaultStorageDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(serviceConfigPath(), JSON.stringify(cfg, null, 2), "utf-8");
}

/** Load persisted service config. */
export function loadServiceConfig(): ServiceConfig | null {
  const p = serviceConfigPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as ServiceConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

type Platform = "windows" | "macos" | "linux";

function detectPlatform(): Platform {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return "linux";
  }
}

// ---------------------------------------------------------------------------
// Build the CLI args that the service should execute
// ---------------------------------------------------------------------------

function buildServiceArgs(cfg: ServiceConfig): string[] {
  const args: string[] = ["--agent", cfg.agent, "--cwd", cfg.cwd];
  if (cfg.configFile) args.push("--config", cfg.configFile);
  if (cfg.idleTimeout !== undefined) args.push("--idle-timeout", String(cfg.idleTimeout));
  if (cfg.maxSessions !== undefined) args.push("--max-sessions", String(cfg.maxSessions));
  if (cfg.showThoughts) args.push("--show-thoughts");
  return args;
}

/** Resolve the absolute path to the wechat-acp binary. */
function resolveBinPath(): string {
  // If running from npx / global install, process.argv[1] is the entry script
  const entry = process.argv[1];
  if (entry) return path.resolve(entry);
  // Fallback: try to find in node_modules/.bin
  return "wechat-acp";
}

// ---------------------------------------------------------------------------
// Windows — Startup folder (no admin required)
// ---------------------------------------------------------------------------

function windowsStartupDir(): string {
  return path.join(
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
    "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
  );
}

function windowsStartupScript(): string {
  return path.join(windowsStartupDir(), `${SERVICE_NAME}.vbs`);
}

function windowsInstall(cfg: ServiceConfig): void {
  const nodePath = process.execPath;
  const binPath = resolveBinPath();
  const args = buildServiceArgs(cfg);
  const logFile = path.join(defaultStorageDir(), "wechat-acp.log");

  // Use a VBScript wrapper to run hidden (no console window flash)
  const command = `"${nodePath}" "${binPath}" ${args.map((a) => `"${a}"`).join(" ")}`;
  const vbs = `' wechat-acp auto-start service
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "${cfg.cwd.replace(/\\/g, "\\\\")}"
WshShell.Run "${command.replace(/"/g, '""')}", 0, False
`;

  const scriptPath = windowsStartupScript();
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, vbs, "utf-8");

  console.log(`✅ Installed auto-start script`);
  console.log(`   Script: ${scriptPath}`);
  console.log(`   Runs at: user logon (Windows Startup folder)`);
  console.log(`   Log: ${logFile}`);
  console.log(`\n   To start now: wechat-acp --agent ${cfg.agent} --daemon`);
}

function windowsUninstall(): void {
  const scriptPath = windowsStartupScript();
  if (fs.existsSync(scriptPath)) {
    fs.unlinkSync(scriptPath);
    console.log(`✅ Removed auto-start script: ${scriptPath}`);
  } else {
    console.log("No auto-start script found");
  }
  cleanupServiceConfig();
}

function windowsStatus(): void {
  const scriptPath = windowsStartupScript();
  if (fs.existsSync(scriptPath)) {
    console.log(`Auto-start: installed (${scriptPath})`);
  } else {
    console.log("Auto-start: not installed");
  }
}

// ---------------------------------------------------------------------------
// macOS — launchd
// ---------------------------------------------------------------------------

function launchdPlistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

function macosInstall(cfg: ServiceConfig): void {
  const nodePath = process.execPath;
  const binPath = resolveBinPath();
  const args = buildServiceArgs(cfg);
  const logFile = path.join(defaultStorageDir(), "wechat-acp.log");
  const errFile = path.join(defaultStorageDir(), "wechat-acp-err.log");

  const programArgs = [nodePath, binPath, ...args];

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(cfg.cwd)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(errFile)}</string>
  <key>ThrottleInterval</key>
  <integer>60</integer>
</dict>
</plist>`;

  const plistPath = launchdPlistPath();
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, plist, "utf-8");

  // Unload first in case it's already loaded
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "pipe" });
  } catch {
    // Ignore if not loaded
  }
  execSync(`launchctl load "${plistPath}"`, { stdio: "pipe" });

  console.log(`✅ Installed as launchd agent "${SERVICE_LABEL}"`);
  console.log(`   Plist: ${plistPath}`);
  console.log(`   Restart: auto-restart on non-zero exit (60s throttle)`);
  console.log(`   Log: ${logFile}`);
}

function macosUninstall(): void {
  const plistPath = launchdPlistPath();
  if (fs.existsSync(plistPath)) {
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: "pipe" });
    } catch {
      // May already be unloaded
    }
    fs.unlinkSync(plistPath);
    console.log(`✅ Removed launchd agent "${SERVICE_LABEL}"`);
  } else {
    console.log(`No launchd agent "${SERVICE_LABEL}" found`);
  }
  cleanupServiceConfig();
}

function macosStatus(): void {
  try {
    const output = execSync(`launchctl list "${SERVICE_LABEL}"`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(`Agent "${SERVICE_LABEL}" is loaded:\n`);
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) console.log(`  ${trimmed}`);
    }
  } catch {
    const plistPath = launchdPlistPath();
    if (fs.existsSync(plistPath)) {
      console.log(`Agent "${SERVICE_LABEL}" is installed but not loaded`);
    } else {
      console.log(`Agent "${SERVICE_LABEL}" is not installed`);
    }
  }
}

// ---------------------------------------------------------------------------
// Linux — systemd user service
// ---------------------------------------------------------------------------

function systemdUnitDir(): string {
  return path.join(os.homedir(), ".config", "systemd", "user");
}

function systemdUnitPath(): string {
  return path.join(systemdUnitDir(), `${SERVICE_NAME}.service`);
}

function linuxInstall(cfg: ServiceConfig): void {
  const nodePath = process.execPath;
  const binPath = resolveBinPath();
  const args = buildServiceArgs(cfg);
  const execStart = [nodePath, binPath, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");

  const unit = `[Unit]
Description=WeChat ACP Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${cfg.cwd}
Restart=on-failure
RestartSec=60
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

  const unitDir = systemdUnitDir();
  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(systemdUnitPath(), unit, "utf-8");

  execSync("systemctl --user daemon-reload", { stdio: "pipe" });
  execSync(`systemctl --user enable ${SERVICE_NAME}.service`, { stdio: "pipe" });

  // Enable lingering so the service starts even without an active login session
  try {
    execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio: "pipe" });
  } catch {
    console.log("  ⚠️  Could not enable lingering (may need sudo)");
  }

  console.log(`✅ Installed as systemd user service "${SERVICE_NAME}"`);
  console.log(`   Unit: ${systemdUnitPath()}`);
  console.log(`   Restart: on-failure (60s delay)`);
  console.log(`   Start now: systemctl --user start ${SERVICE_NAME}`);
}

function linuxUninstall(): void {
  const unitPath = systemdUnitPath();
  if (fs.existsSync(unitPath)) {
    try {
      execSync(`systemctl --user stop ${SERVICE_NAME}.service`, { stdio: "pipe" });
    } catch {
      // May not be running
    }
    try {
      execSync(`systemctl --user disable ${SERVICE_NAME}.service`, { stdio: "pipe" });
    } catch {
      // May not be enabled
    }
    fs.unlinkSync(unitPath);
    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
    console.log(`✅ Removed systemd user service "${SERVICE_NAME}"`);
  } else {
    console.log(`No systemd service "${SERVICE_NAME}" found`);
  }
  cleanupServiceConfig();
}

function linuxStatus(): void {
  try {
    const output = execSync(`systemctl --user status ${SERVICE_NAME}.service`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(output.trim());
  } catch (err) {
    // systemctl returns non-zero for inactive services but still outputs status
    const output = (err as { stdout?: string }).stdout;
    if (output) {
      console.log(output.toString().trim());
    } else {
      console.log(`Service "${SERVICE_NAME}" is not installed`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function installService(cfg: ServiceConfig): void {
  saveServiceConfig(cfg);
  const platform = detectPlatform();
  switch (platform) {
    case "windows":
      windowsInstall(cfg);
      break;
    case "macos":
      macosInstall(cfg);
      break;
    case "linux":
      linuxInstall(cfg);
      break;
  }
}

export function uninstallService(): void {
  const platform = detectPlatform();
  switch (platform) {
    case "windows":
      windowsUninstall();
      break;
    case "macos":
      macosUninstall();
      break;
    case "linux":
      linuxUninstall();
      break;
  }
}

export function serviceStatus(): void {
  const platform = detectPlatform();
  switch (platform) {
    case "windows":
      windowsStatus();
      break;
    case "macos":
      macosStatus();
      break;
    case "linux":
      linuxStatus();
      break;
  }
  // Also show persisted config
  const cfg = loadServiceConfig();
  if (cfg) {
    console.log(`\nPersisted config: agent="${cfg.agent}", cwd="${cfg.cwd}"`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanupServiceConfig(): void {
  const p = serviceConfigPath();
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}
