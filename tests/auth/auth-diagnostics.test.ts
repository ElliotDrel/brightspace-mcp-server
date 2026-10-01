import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authDiagnostic, flushAuthDiagnostics } from "../../src/auth/auth-diagnostics.js";

describe("private authentication diagnostics", () => {
  let directory: string | undefined;
  afterEach(async () => {
    await flushAuthDiagnostics();
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("persists timings and outcomes while dropping secret and arbitrary fields", async () => {
    directory = await mkdtemp(join(tmpdir(), "brightspace-diagnostics-"));
    vi.stubEnv("D2L_DIAGNOSTICS_DIR", directory);
    authDiagnostic("mfa_code_submitted", {
      elapsedMs: 123, method: "code", password: "private-password", code: "123456",
      cookieHeader: "secret-session", stage: "https://user:password@example.edu/?token=secret",
    } as any);
    authDiagnostic("browser_finished", { result: "success" });
    await flushAuthDiagnostics();
    const content = await readFile(join(directory, `auth-${new Date().toISOString().slice(0, 10)}.jsonl`), "utf8");
    expect(content).not.toMatch(/private-password|123456|secret-session|example\.edu/);
    const rows = content.trim().split("\n").map(line => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ event: "mfa_code_submitted", elapsedMs: 123, method: "code" });
    expect(rows[1]).toMatchObject({ event: "browser_finished", result: "success" });
    expect(rows[0].runId).toBe(rows[1].runId);
  });

  it("does not let an unwritable diagnostics destination interrupt authentication", async () => {
    directory = await mkdtemp(join(tmpdir(), "brightspace-diagnostics-"));
    const { writeFile } = await import("node:fs/promises");
    const file = join(directory, "ordinary-file");
    await writeFile(file, "preserved");
    vi.stubEnv("D2L_DIAGNOSTICS_DIR", file);
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      authDiagnostic("browser_started");
      await expect(flushAuthDiagnostics()).resolves.toBeUndefined();
      expect(await readFile(file, "utf8")).toBe("preserved");
    } finally { warning.mockRestore(); }
  });
});
