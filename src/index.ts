#!/usr/bin/env node
// Keep the normal connector light: no API, browser or tool imports per chat.
const command = process.argv[2];
const COMMANDS = ["setup", "auth", "doctor", "http", "stdio"];

// Preserve flags-only client launches while rejecting positional typos before
// importing either startup path (including the native credential store).
if (command !== undefined && !command.startsWith("-") && !COMMANDS.includes(command)) {
  process.stderr.write(
    `Unknown command: ${command}\n\n` +
    "Usage: brightspace-mcp-server [command]\n\n" +
    "Commands:\n" +
    "  (none)   run the stdio connector, automatically sharing a runtime\n" +
    "  http     run one shared MCP server on localhost\n" +
    "  stdio    run the direct MCP server on stdio\n" +
    "  setup    configure your school and sign-in\n" +
    "  auth     sign in to Brightspace now\n" +
    "  doctor   check the install and configuration\n",
  );
  process.exit(2);
}

if (command === "setup") await import("./setup.js");
else if (command === "auth") await import("./auth-cli.js");
else if (command === "doctor") await import("./doctor.js");
else if (command === "http" || command === "stdio") await import("./serve.js");
else {
  const { runSharedStdio } = await import("./shared-stdio.js");
  await runSharedStdio();
}
export {};
