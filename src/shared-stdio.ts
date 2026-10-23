/** Normal stdio entry: a small connector to one automatically managed runtime. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import dotenv from "dotenv";
import { nativeCredentialBackend } from "./auth/credential-store.js";
import { guardServerProcess } from "./utils/process-guard.js";
import { startupPhase } from "./utils/startup-phase.js";

const SERVICE = "brightspace-mcp-server-shared";
const here = dirname(fileURLToPath(import.meta.url));
const optionalFile = (path: string): string => {
  try { return readFileSync(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
};

/** Different versions/settings must never silently share an account or runtime. */
export function sharedAddress(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  dotenv.config({ path: join(cwd, ".env"), quiet: true, processEnv: env });
  const settings = Object.entries(env).filter(([key]) => key.startsWith("D2L_") && !["D2L_HTTP_TOKEN", "D2L_HTTP_PORT"].includes(key)).sort(([a], [b]) => a.localeCompare(b));
  const version = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
  const account = createHash("sha256").update(JSON.stringify({
    version, settings, cwd,
    saved: optionalFile(join(homedir(), ".brightspace-mcp", "config.json")),
  })).digest("hex");
  // A collision fails authentication instead of joining a different runtime.
  const port = 49152 + Number.parseInt(account.slice(0, 4), 16) % 16384;
  return { account, port, url: `http://127.0.0.1:${port}/mcp` };
}

export const publishSharedToken = (account: string, token: string) =>
  nativeCredentialBackend.setPassword(SERVICE, account, token);

export interface SharedConnector {
  protocolVersion?: string;
  ready(): Promise<{ url: string; token: string }>;
}

/** No lock files, services or discovery secrets: exclusive bind elects the owner. */
export function sharedConnector(address = sharedAddress()): SharedConnector {
  let connecting: Promise<{ url: string; token: string }> | undefined;
  async function connect() {
    let started = false;
    let spawnError = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const token = await nativeCredentialBackend.getPassword(SERVICE, address.account);
      if (token) {
        try {
          const response = await fetch(address.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
          await response.body?.cancel();
          if (response.status === 405) return { url: address.url, token };
        } catch { /* Not listening yet, or an idle server just stopped. */ }
      }
      if (!started) {
        started = true;
        const child = spawn(process.execPath, [resolve(here, "index.js"), "http", "--managed"], {
          stdio: "ignore", detached: true, windowsHide: true,
        });
        child.once("error", () => { spawnError = true; });
        child.unref();
      }
      if (spawnError) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error("The shared Brightspace server could not start. Check for a local port conflict or use brightspace-mcp-server stdio to troubleshoot.");
  }
  return { ready() {
    connecting ??= startupPhase("locating the shared runtime", connect).finally(() => { connecting = undefined; });
    return connecting;
  } };
}

/** Forward raw JSON-RPC, including streaming progress, without re-registering tools. */
export async function relayMessage(line: string, connector: SharedConnector, write: (line: string) => void): Promise<void> {
  let message: { id?: unknown; method?: string };
  try { message = JSON.parse(line); }
  catch { write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })); return; }
  let answered = false;
  try {
    const { url, token } = await connector.ready();
    const emit = (data: string) => {
      const reply = JSON.parse(data);
      if (message && message.id !== undefined && reply?.id === message.id && ("result" in reply || "error" in reply)) answered = true;
      if (message?.method === "initialize") {
        const version = reply?.result?.protocolVersion;
        if (typeof version === "string") connector.protocolVersion = version;
      }
      write(data);
    };
    const response = await fetch(url, { method: "POST", headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      ...(connector.protocolVersion ? { "MCP-Protocol-Version": connector.protocolVersion } : {}),
    }, body: line });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Shared server request failed"); }
    if (response.status === 202 || !response.body) {
      if (message && message.id !== undefined) throw new Error("Missing JSON-RPC response");
      return;
    }
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const lines = createInterface({ input: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]) });
      for await (const event of lines) if (event.startsWith("data:")) emit(event.slice(5).trimStart());
    } else emit(await response.text());
    if (message && message.id !== undefined && !answered) throw new Error("Incomplete JSON-RPC response");
  } catch {
    // Never replay a tool call after a possibly partial execution.
    if (message && message.id !== undefined && !answered) write(JSON.stringify({ jsonrpc: "2.0", id: message.id,
      error: { code: -32603, message: "Shared Brightspace server unavailable. Retry the request; its server will start automatically." },
    }));
  }
}

export async function runSharedStdio(): Promise<void> {
  const address = sharedAddress();
  try { await startupPhase("checking the shared runtime credential store", () => nativeCredentialBackend.getPassword(SERVICE, address.account)); }
  catch {
    // Browser-free/headless installs without an OS keyring retain stdio support.
    console.error("Native credential store unavailable; using the direct stdio server.");
    await import("./serve.js");
    return;
  }
  guardServerProcess();
  const connector = sharedConnector(address);
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    if (line.trim()) void relayMessage(line, connector, (data) => { process.stdout.write(data + "\n"); });
  }
}
