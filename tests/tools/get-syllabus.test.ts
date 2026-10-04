import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../../src/api/index.js";
import { registerGetSyllabus } from "../../src/tools/get-syllabus.js";

vi.mock("../../src/utils/pdf-extractor.js", () => ({
  extractPdfText: vi.fn(async () => ({ text: "Syllabus PDF text", totalPages: 2 })),
}));

function setup(options: { overview?: unknown; overviewError?: Error; attachment?: Response; attachmentError?: Error } = {}) {
  const apiClient = {
    le: (courseId: number, path: string) => `/d2l/api/le/1.0/${courseId}${path}`,
    get: vi.fn(async () => {
      if (options.overviewError) throw options.overviewError;
      return options.overview ?? { Description: { Html: "", Text: "" } };
    }),
    getRaw: vi.fn(async () => {
      if (options.attachmentError) throw options.attachmentError;
      return options.attachment ?? new Response(null, { status: 404 });
    }),
  };
  let handler: (args: unknown) => Promise<any>;
  registerGetSyllabus({ registerTool: (_name: string, _metadata: unknown, fn: typeof handler) => { handler = fn; } } as any, apiClient as any);
  return { call: async () => handler!({ courseId: 101 }), apiClient };
}

describe("get_syllabus source reporting (#153)", () => {
  it("reports an empty legacy overview without declaring that the course has no syllabus", async () => {
    const { call } = setup();
    const result = await call();
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({ courseId: 101, description: "", hasAttachment: false,
      sourceScope: "brightspace_overview", externalSyllabusSourcesChecked: false,
      reasonCode: "overview_syllabus_not_retrieved",
      sourcesChecked: [{ source: "brightspace_overview", status: "available" },
        { source: "brightspace_overview_attachment", status: "not_found" }],
    });
    expect(body.message).toMatch(/Simple Syllabus/);
    expect(body.message).toMatch(/not queried/);
    expect(result.isError).toBeUndefined();
  });

  it("still checks the attachment when the overview endpoint is missing", async () => {
    const { call, apiClient } = setup({
      overviewError: new ApiError(404, "/overview", "Not found"),
      attachment: new Response("pdf bytes", { headers: { "Content-Disposition": 'attachment; filename="syllabus.pdf"' } }),
    });
    const body = JSON.parse((await call()).content[0].text);
    expect(apiClient.getRaw).toHaveBeenCalledOnce();
    expect(body.syllabusText).toBe("Syllabus PDF text");
    expect(body.sourcesChecked[0].status).toBe("not_found");
    expect(body.sourcesChecked[1].status).toBe("available");
    expect(body).not.toHaveProperty("reasonCode");
  });

  it("distinguishes a failed attachment read from a missing attachment", async () => {
    const { call } = setup({ attachmentError: new ApiError(403, "/overview/attachment", "Forbidden") });
    const body = JSON.parse((await call()).content[0].text);
    expect(body.sourcesChecked[1].status).toBe("unavailable");
    expect(body.message).toMatch(/No syllabus text or attachment was retrieved/i);
  });

  it("reports incomplete retrieval when an attachment body fails after successful headers", async () => {
    const attachment = new Response(new ReadableStream({
      start(controller) { controller.error(new Error("connection interrupted")); },
    }));
    const { call } = setup({ attachment });
    const body = JSON.parse((await call()).content[0].text);
    expect(body.hasAttachment).toBe(true); // Endpoint advertised an attachment.
    expect(body.attachmentRetrieved).toBe(false);
    expect(body.sourcesChecked[1].status).toBe("unavailable");
    expect(body.reasonCode).toBe("overview_syllabus_not_retrieved");
  });

  it("preserves known syllabus links in overview HTML without claiming the external source was read", async () => {
    const { call } = setup({ overview: { Description: { Text: "Syllabus", Html: '<a href="/d2l/le/nav/101/customlinks/external/1?d2lSessionVal=secret">Simple Syllabus</a>' } } });
    const body = JSON.parse((await call()).content[0].text);
    expect(body.description).toBe("[Simple Syllabus](/d2l/le/nav/101/customlinks/external/1)");
    expect(body.externalSyllabusSourcesChecked).toBe(false);
    expect(body).not.toHaveProperty("reasonCode");
  });

  it("uses an overview plain-text description when HTML is absent", async () => {
    const { call } = setup({ overview: { Description: { Text: "Course requirements", Html: " " } } });
    expect(JSON.parse((await call()).content[0].text).description).toBe("Course requirements");
  });

  it("propagates overview permission failures instead of implying no syllabus exists", async () => {
    const { call, apiClient } = setup({ overviewError: new ApiError(403, "/overview", "Forbidden") });
    const result = await call();
    expect(result.isError).toBe(true);
    expect(apiClient.getRaw).not.toHaveBeenCalled();
  });
});
