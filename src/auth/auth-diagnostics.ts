import { appendFile, mkdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

type Event = "recovery_started" | "recovery_pending" | "recovery_finished"
  | "browser_started" | "browser_state_loaded" | "playwright_loaded" | "browser_launched"
  | "page_stage" | "microsoft_method_requested" | "microsoft_response"
  | "mfa_wait" | "mfa_method_selected" | "mfa_code_submitted" | "mfa_manual_required"
  | "browser_verified" | "browser_finished" | "token_mint_started" | "token_mint_finished"
  | "assignment_source_failed";

interface Fields {
  elapsedMs?: number;
  childPid?: number;
  status?: number;
  automatic?: boolean;
  headless?: boolean;
  restoredState?: boolean;
  codeConfigured?: boolean;
  stage?: "brightspace" | "microsoft" | "purdue" | "other";
  method?: "code" | "other" | "push" | "unknown";
  result?: "success" | "failed" | "sessionExpired" | "transport";
  reason?: "busy" | "cooldown" | "unsupported" | "secureStorage" | "transport" | "timeout" | "failed" | "mfaPending";
  source?: "dropbox" | "quizzes" | "gradebook" | "content";
}

const runId = randomUUID();
const MAX_BYTES = 5 * 1024 * 1024;
let pending = Promise.resolve();
let warned = false;

/** Opt-in, allowlisted diagnostics. Never persist arbitrary errors, URLs or browser data. */
export function authDiagnostic(event: Event, fields: Fields = {}): void {
  const directory = process.env.D2L_DIAGNOSTICS_DIR;
  if (!directory) return;
  const timestamp = new Date().toISOString();
  const record: Record<string, unknown> = { timestamp, runId, pid: process.pid, event };
  for (const key of ["elapsedMs", "childPid", "status"] as const) {
    if (typeof fields[key] === "number" && Number.isFinite(fields[key])) record[key] = fields[key];
  }
  for (const key of ["automatic", "headless", "restoredState", "codeConfigured"] as const) {
    if (typeof fields[key] === "boolean") record[key] = fields[key];
  }
  const allowed = {
    stage: ["brightspace", "microsoft", "purdue", "other"],
    method: ["code", "other", "push", "unknown"],
    result: ["success", "failed", "sessionExpired", "transport"],
    reason: ["busy", "cooldown", "unsupported", "secureStorage", "transport", "timeout", "failed", "mfaPending"],
    source: ["dropbox", "quizzes", "gradebook", "content"],
  };
  for (const key of ["stage", "method", "result", "reason", "source"] as const) {
    const value = fields[key];
    if (value && allowed[key].includes(value)) record[key] = value;
  }
  const line = JSON.stringify(record) + "\n";
  const file = join(directory, `auth-${timestamp.slice(0, 10)}.jsonl`);
  pending = pending.then(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const size = await stat(file).then(value => value.size, error => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });
    // Bound each day's output and preserve all existing files.
    if (size + Buffer.byteLength(line) > MAX_BYTES) return;
    await appendFile(file, line, { mode: 0o600 });
  }).catch(() => {
    if (!warned) {
      warned = true;
      console.error("[WARN] Authentication diagnostics could not be saved; sign-in continues.");
    }
  });
}

export async function flushAuthDiagnostics(): Promise<void> {
  await pending;
}
