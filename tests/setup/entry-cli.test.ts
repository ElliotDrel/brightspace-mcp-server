import { beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the built entry in a real process, while replacing its startup
// boundaries inside that process. No real config, native store, auth or network.
const entry = resolve(__dirname, "../../build/index.js");
const loader = pathToFileURL(resolve(__dirname, "fixtures/entry-loader.mjs")).href;
const preload = `data:text/javascript,${encodeURIComponent(`import { register } from "node:module"; register(${JSON.stringify(loader)});`)}`;

async function run(...args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "entry-cli-"));
  try {
    const child = spawn(process.execPath, ["--no-deprecation", "--import", preload, entry, ...args], {
      cwd: home,
      env: { SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    // Keep stdin open: falling through to real stdio must not masquerade as a
    // successful exit merely because spawnSync closed stdin immediately.
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 5_000);
    try {
      const status = await new Promise<number | null>((done, fail) => {
        child.once("error", fail);
        child.once("close", done);
      });
      return { status, stdout, stderr, timedOut, homeEntries: readdirSync(home) };
    } finally {
      clearTimeout(timer);
      child.stdin.destroy();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("entry point subcommand routing (real process, mocked startup boundaries)", () => {
  beforeAll(() => {
    expect(existsSync(entry), "Run npm run build before the entry subprocess tests").toBe(true);
  });

  it.each([["htp"], ["htp", "--port", "4000"], ["serve"], ["HTTP"], [""]])(
    "rejects unknown command %j before any startup boundary",
    async (...args) => {
      const result = await run(...args);
      expect(result.timedOut).toBe(false);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`Unknown command: ${args[0]}`);
      expect(result.stderr).toContain("Usage: brightspace-mcp-server [command]");
      for (const command of ["setup", "auth", "doctor", "http", "stdio"]) {
        expect(result.stderr).toContain(`  ${command} `);
      }
      expect(result.stderr).not.toContain("boundary:");
      expect(result.homeEntries).toEqual([]);
    },
  );

  it.each([[], ["--legacy-client-flag"]])("selects the shared default for %j", async (...args) => {
    const result = await run(...args);
    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("boundary:shared-stdio\n");
    expect(result.stdout).toBe("");
  });

  it("preserves explicit direct stdio without selecting the shared connector", async () => {
    const result = await run("stdio");
    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("boundary:direct-stdio\n");
    expect(result.stdout).toBe("");
  });

  it.each(["setup", "auth", "doctor"])("preserves %s routing and forwards its flags", async (command) => {
    const result = await run(command, "--help");
    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe(`boundary:${command === "auth" ? "auth-cli" : command}\nargs:["--help"]\n`);
  });

  it("preserves explicit HTTP startup without opening a real listener", async () => {
    const result = await run("http", "--port", "4000");
    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("boundary:listener\n");
  });
});
