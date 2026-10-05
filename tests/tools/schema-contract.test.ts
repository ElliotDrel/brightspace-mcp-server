import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerGetAnnouncements } from "../../src/tools/get-announcements.js";
import { registerGetVideoTranscript } from "../../src/tools/get-video-transcript.js";

describe("advertised archival limits", () => {
  it("exposes the same count, character, and offset bounds enforced at runtime", async () => {
    const server = new McpServer({ name: "schema-contract", version: "1" });
    registerGetAnnouncements(server, {} as any, {} as any);
    registerGetVideoTranscript(server, {} as any);
    const client = new Client({ name: "schema-contract", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const { tools } = await client.listTools();
      const announcements = tools.find((tool) => tool.name === "get_announcements")!.inputSchema.properties!;
      const transcript = tools.find((tool) => tool.name === "get_video_transcript")!.inputSchema.properties!;
      expect(announcements.count).toMatchObject({ type: "integer", minimum: 1, maximum: 50 });
      expect(announcements.offset).toMatchObject({ type: "integer", minimum: 0 });
      expect(transcript.maxChars).toMatchObject({ type: "integer", exclusiveMinimum: 0, maximum: 100000 });
      expect(transcript.offset).toMatchObject({ type: "integer", minimum: 0 });
      const invalid = await client.callTool({ name: "get_announcements", arguments: { count: 51 } });
      expect(invalid.isError).toBe(true);
      const invalidTranscript = await client.callTool({ name: "get_video_transcript", arguments: { maxChars: 100001 } });
      expect(invalidTranscript.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
