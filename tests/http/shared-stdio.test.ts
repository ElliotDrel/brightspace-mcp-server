import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), spawn: vi.fn() }));
vi.mock("../../src/auth/credential-store.js", () => ({ nativeCredentialBackend: { getPassword: mocks.get, setPassword: mocks.set } }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { relayMessage, sharedAddress, sharedConnector } from "../../src/shared-stdio.js";

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const address = { account: "fake-account", port: 50000, url: "http://127.0.0.1:50000/mcp" };

describe("normal shared startup", () => {
  it("separates working directories and settings without disclosing secret inputs", () => {
    const a = sharedAddress({ D2L_BASE_URL: "https://school.test", D2L_PASSWORD: "fake-secret" }, "C:/one");
    expect(a).toEqual(sharedAddress({ D2L_BASE_URL: "https://school.test", D2L_PASSWORD: "fake-secret" }, "C:/one"));
    expect(a.account).not.toBe(sharedAddress({ D2L_BASE_URL: "https://other.test" }, "C:/one").account);
    expect(a.account).not.toBe(sharedAddress({}, "C:/two").account);
    expect(JSON.stringify(a)).not.toContain("fake-secret");
  });

  it("reuses an authenticated listener without spawning", async () => {
    mocks.get.mockResolvedValue("secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 405 })));
    expect(await sharedConnector(address).ready()).toEqual({ url: address.url, token: "secret" });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("coalesces concurrent cold starts and waits for the elected server", async () => {
    let token: string | null = null;
    mocks.get.mockImplementation(async () => token);
    mocks.spawn.mockImplementation(() => {
      token = "new-token";
      return Object.assign(new EventEmitter(), { unref: vi.fn() });
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 405 })));
    const connector = sharedConnector(address);
    const answers = await Promise.all([connector.ready(), connector.ready(), connector.ready()]);
    expect(answers.every((x) => x.token === "new-token")).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ detached: true, windowsHide: true, stdio: "ignore" });
  });

  it("starts a replacement after an idle/crashed server is gone", async () => {
    mocks.get.mockResolvedValue("secret");
    let live = true;
    vi.stubGlobal("fetch", vi.fn(async () => { if (!live) throw Error("gone"); return new Response(null, { status: 405 }); }));
    mocks.spawn.mockImplementation(() => { live = true; return Object.assign(new EventEmitter(), { unref: vi.fn() }); });
    const connector = sharedConnector(address);
    await connector.ready();
    live = false;
    await connector.ready();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
});

describe("transparent JSON-RPC relay", () => {
  const connector = { ready: async () => ({ url: address.url, token: "secret" }) };
  it("returns an error without replay when a stream ends before its response", async () => {
    const progress = { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: 7, progress: 1 } };
    const fetch = vi.fn(async () => new Response(`data: ${JSON.stringify(progress)}\n\n`, { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const write = vi.fn();
    await relayMessage('{"jsonrpc":"2.0","id":9,"method":"tools/call"}', connector, write);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(write.mock.calls.map(([line]) => JSON.parse(line))).toEqual([progress, expect.objectContaining({ id: 9, error: expect.objectContaining({ code: -32603 }) })]);
  });
  it("rejects an empty accepted response to a request without replay", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const write = vi.fn();
    await relayMessage('{"jsonrpc":"2.0","id":9,"method":"tools/call"}', connector, write);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({ id: 9, error: { code: -32603 } });
  });
  it("preserves streaming progress and the final tool response", async () => {
    const progress = { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: 7, progress: 1 } };
    const reply = { jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text: "done" }] } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`data: ${JSON.stringify(progress)}\n\ndata: ${JSON.stringify(reply)}\n\n`, { headers: { "content-type": "text/event-stream" } })));
    const write = vi.fn();
    await relayMessage('{"jsonrpc":"2.0","id":9,"method":"tools/call"}', connector, write);
    expect(write.mock.calls.map(([line]) => JSON.parse(line))).toEqual([progress, reply]);
  });
  it("forwards the negotiated protocol version on subsequent HTTP requests", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const connection = { ...connector };
    await relayMessage('{"jsonrpc":"2.0","id":1,"method":"initialize"}', connection, () => {});
    await relayMessage('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', connection, () => {});
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ "MCP-Protocol-Version": "2025-06-18" });
  });
  it("does not replay a failed tool call", async () => {
    const fetch = vi.fn(async () => { throw Error("connection lost after execution"); });
    vi.stubGlobal("fetch", fetch);
    const write = vi.fn();
    await relayMessage('{"jsonrpc":"2.0","id":4,"method":"tools/call"}', connector, write);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({ id: 4, error: { code: -32603 } });
  });
  it("does not produce responses to notifications", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
    const write = vi.fn();
    await relayMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}', connector, write);
    expect(write).not.toHaveBeenCalled();
  });
});
