/**
 * Spawn and manage ACP agent subprocesses.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import packageJson from "../../package.json" with { type: "json" };
import type { WeChatAcpClient } from "./client.js";
import type { McpServerConfig } from "../config.js";

export interface AgentProcessInfo {
  process: ChildProcess;
  connection: acp.ClientSideConnection;
  sessionId: string;
}

/**
 * Convert our simplified McpServerConfig to the ACP SDK's McpServer type.
 */
function toAcpMcpServer(cfg: McpServerConfig): acp.McpServer {
  if ("command" in cfg) {
    // Stdio transport
    return {
      name: cfg.name,
      command: cfg.command,
      args: cfg.args ?? [],
      env: Object.entries(cfg.env ?? {}).map(([name, value]) => ({ name, value })),
    };
  }
  // HTTP or SSE transport
  const headers = Object.entries(cfg.headers ?? {}).map(([name, value]) => ({ name, value }));
  return {
    type: cfg.type,
    name: cfg.name,
    url: cfg.url,
    headers,
  };
}

export async function spawnAgent(params: {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  mcpServers?: McpServerConfig[];
  client: WeChatAcpClient;
  log: (msg: string) => void;
}): Promise<AgentProcessInfo> {
  const { command, args, cwd, env, mcpServers, client, log } = params;

  // On Windows, shell mode avoids EINVAL/ENOENT for command shims like npx/claude/gemini.
  const useShell = process.platform === "win32";

  log(`Spawning agent: ${command} ${args.join(" ")} (cwd: ${cwd}, shell=${useShell})`);

  const proc = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd,
    env: { ...process.env, ...env },
    shell: useShell,
  });

  proc.on("error", (err) => {
    log(`Agent process error: ${String(err)}`);
  });

  proc.on("exit", (code, signal) => {
    log(`Agent process exited: code=${code} signal=${signal}`);
  });

  if (!proc.stdin || !proc.stdout) {
    proc.kill();
    throw new Error("Failed to get agent process stdio");
  }

  const input = Writable.toWeb(proc.stdin);
  const output = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);

  const connection = new acp.ClientSideConnection(() => client, stream);

  // Initialize
  log("Initializing ACP connection...");
  const initResult = await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientInfo: {
      name: packageJson.name,
      title: packageJson.name,
      version: packageJson.version,
    },
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
    },
  });
  log(`ACP initialized (protocol v${initResult.protocolVersion})`);

  // Create session
  const acpMcpServers = (mcpServers ?? []).map(toAcpMcpServer);
  if (acpMcpServers.length > 0) {
    log(`Loading ${acpMcpServers.length} MCP server(s): ${acpMcpServers.map((s) => s.name).join(", ")}`);
  }
  log("Creating ACP session...");
  const sessionResult = await connection.newSession({
    cwd,
    mcpServers: acpMcpServers,
  });
  log(`ACP session created: ${sessionResult.sessionId}`);

  return {
    process: proc,
    connection,
    sessionId: sessionResult.sessionId,
  };
}

export function killAgent(proc: ChildProcess): void {
  if (!proc.killed) {
    proc.kill("SIGTERM");
    // Force kill after 5s if still alive
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 5_000).unref();
  }
}
