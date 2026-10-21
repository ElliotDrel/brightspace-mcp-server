#!/usr/bin/env node
// Keep the normal connector light: no API, browser or tool imports per chat.
const command = process.argv[2];
if (command === "setup") await import("./setup.js");
else if (command === "auth") await import("./auth-cli.js");
else if (command === "doctor") await import("./doctor.js");
else if (command === "http" || command === "stdio") await import("./serve.js");
else if (command === undefined) {
  const { runSharedStdio } = await import("./shared-stdio.js");
  await runSharedStdio();
} else {
  console.error("Usage: brightspace-mcp-server [setup|auth|doctor|http|stdio]");
  process.exitCode = 1;
}
export {};
