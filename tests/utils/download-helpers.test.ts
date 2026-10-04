import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { secureDownload, resolveFilenameConflict, secureDownloadStream, readDownloadBuffer } from "../../src/utils/download-helpers.js";
import { DownloadError } from "../../src/utils/download-errors.js";

/**
 * secureDownload is the only thing standing between a filename Brightspace
 * chose and a write to disk. It called validateDownloadPath and then wrote to
 * path.join(targetDir, rawFilename) anyway, so the validated path was never the
 * path used and a "../../" name escaped the download directory entirely.
 */

function pdfBuffer(): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(512)]);
}

let root: string;
let targetDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "secure-download-"));
  targetDir = path.join(root, "a", "b");
  await fs.mkdir(targetDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const inside = (p: string) =>
  path.resolve(p).startsWith(path.resolve(targetDir) + path.sep);

describe("secureDownload: path containment", () => {
  it("never writes above the target directory", async () => {
    const result = await secureDownload({
      targetDir,
      filename: "../../pwned.pdf",
      data: pdfBuffer(),
    }).catch((e) => e);

    if (result instanceof Error) {
      expect(result).toBeInstanceOf(DownloadError);
    } else {
      expect(inside(result.path)).toBe(true);
    }
    await expect(fs.access(path.join(root, "pwned.pdf"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "a", "pwned.pdf"))).rejects.toThrow();
  });

  it("never writes above the target directory for a percent-encoded traversal", async () => {
    const result = await secureDownload({
      targetDir,
      filename: "..%2F..%2Fencoded.pdf",
      data: pdfBuffer(),
    }).catch((e) => e);

    if (result instanceof Error) {
      expect(result).toBeInstanceOf(DownloadError);
    } else {
      expect(inside(result.path)).toBe(true);
    }
    await expect(fs.access(path.join(root, "encoded.pdf"))).rejects.toThrow();
  });

  it("never writes into a subdirectory the filename asked for", async () => {
    const result = await secureDownload({
      targetDir,
      filename: "sub/nested.pdf",
      data: pdfBuffer(),
    });

    expect(path.dirname(result.path)).toBe(targetDir);
  });

  it("refuses an absolute filename rather than aiming outside", async () => {
    const result = await secureDownload({
      targetDir,
      filename: path.join(root, "absolute.pdf"),
      data: pdfBuffer(),
    }).catch((e) => e);

    if (result instanceof Error) {
      expect(result).toBeInstanceOf(DownloadError);
    } else {
      expect(inside(result.path)).toBe(true);
    }
    await expect(fs.access(path.join(root, "absolute.pdf"))).rejects.toThrow();
  });
});

describe("secureDownload: ordinary downloads still work", () => {
  it("writes the file and reports its path, size and type", async () => {
    const data = pdfBuffer();
    const result = await secureDownload({ targetDir, filename: "Lecture 7.pdf", data });

    expect(result.path).toBe(path.join(targetDir, "Lecture 7.pdf"));
    expect(result.size).toBe(data.byteLength);
    expect(result.mime).toBe("application/pdf");
    expect(await fs.readFile(result.path)).toEqual(data);
  });

  it("decodes a percent-encoded name instead of saving the escape literally", async () => {
    const result = await secureDownload({
      targetDir,
      filename: "Lecture%207.pdf",
      data: pdfBuffer(),
    });

    expect(path.basename(result.path)).toBe("Lecture 7.pdf");
  });

  it("keeps a bare percent in a name usable", async () => {
    const result = await secureDownload({
      targetDir,
      filename: "100% Final.pdf",
      data: pdfBuffer(),
    });

    expect(path.basename(result.path)).toBe("100% Final.pdf");
  });

  it("resolves a conflict rather than overwriting", async () => {
    await fs.writeFile(path.join(targetDir, "notes.pdf"), "already here");

    const result = await secureDownload({
      targetDir,
      filename: "notes.pdf",
      data: pdfBuffer(),
    });

    expect(path.basename(result.path)).toBe("notes(1).pdf");
    expect(await fs.readFile(path.join(targetDir, "notes.pdf"), "utf-8")).toBe(
      "already here"
    );
  });

  it("still refuses a type that is not on the allowlist", async () => {
    // A legacy .doc container under an installer's extension.
    const cfb = Buffer.alloc(2048);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(cfb, 0);

    await expect(
      secureDownload({ targetDir, filename: "setup.msi", data: cfb })
    ).rejects.toBeInstanceOf(DownloadError);
    expect(await fs.readdir(targetDir)).toEqual([]);
  });

  it("still resolves a legacy Office container by its extension", async () => {
    const cfb = Buffer.alloc(2048);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(cfb, 0);

    const result = await secureDownload({ targetDir, filename: "Essay.doc", data: cfb });
    expect(result.mime).toBe("application/msword");
  });
});

describe("resolveFilenameConflict", () => {
  it("returns the original name when nothing is in the way", async () => {
    expect(await resolveFilenameConflict(targetDir, "fresh.pdf")).toBe("fresh.pdf");
  });

  it("counts up past several existing files", async () => {
    for (const name of ["x.pdf", "x(1).pdf", "x(2).pdf"]) {
      await fs.writeFile(path.join(targetDir, name), "x");
    }
    expect(await resolveFilenameConflict(targetDir, "x.pdf")).toBe("x(3).pdf");
  });
});

describe("secureDownloadStream", () => {
  it("streams a file above 150MB without reading arrayBuffer", async () => {
    const chunk = Buffer.alloc(1024 * 1024);
    let count = 0;
    const response = new Response(new ReadableStream({ pull(controller) {
      if (count === 151) return controller.close();
      const bytes = count === 0 ? Buffer.from(chunk) : chunk;
      if (count === 0) bytes.write("%PDF-1.4\n");
      count++;
      controller.enqueue(bytes);
    } }));
    response.arrayBuffer = async () => { throw new Error("must stream"); };
    const result = await secureDownloadStream({ targetDir, filename: "large.pdf", response });
    expect(result.size).toBe(151 * 1024 * 1024);
    expect((await fs.stat(result.path)).size).toBe(result.size);
    expect(result.mime).toBe("application/pdf");
    expect(await fs.readdir(targetDir)).toEqual(["large.pdf"]);
  }, 30_000); // Includes writing and copying 151 MiB on Windows CI disks.
  it.each([undefined, "1"])("enforces actual bytes with Content-Length %s and cleans partial files", async (reported) => {
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(pdfBuffer()); controller.close();
    } }), { headers: reported ? { "Content-Length": reported } : {} });
    await expect(secureDownloadStream({ targetDir, filename: "over.pdf", response, maxBytes: 32 })).rejects.toThrow("File too large");
    expect(await fs.readdir(targetDir)).toEqual([]);
  });
  it("cleans interrupted streams", async () => {
    let sent = false;
    const response = new Response(new ReadableStream({ pull(controller) {
      if (!sent) { sent = true; controller.enqueue(pdfBuffer()); }
      else controller.error(new Error("connection lost"));
    } }));
    await expect(secureDownloadStream({ targetDir, filename: "partial.pdf", response })).rejects.toThrow("connection lost");
    expect(await fs.readdir(targetDir)).toEqual([]);
  });
  it("contains traversing filenames and preserves concurrent download collisions", async () => {
    const results = await Promise.all([0, 1].map(() => secureDownloadStream({ targetDir, filename: "../../safe.pdf", response: new Response(pdfBuffer()) })));
    expect(results.every(result => inside(result.path))).toBe(true);
    expect(new Set(results.map(result => result.path)).size).toBe(2);
    expect(await fs.readdir(targetDir)).toHaveLength(2);
  });
  it("refuses binary and invalid UTF8 content without leaving files", async () => {
    for (const bytes of [Buffer.from([0, 1]), Buffer.from([128, 129, 130])]) {
      await expect(secureDownloadStream({ targetDir, filename: "bad.txt", response: new Response(bytes) })).rejects.toThrow();
      expect(await fs.readdir(targetDir)).toEqual([]);
    }
  });
});


describe("readDownloadBuffer", () => {
  it("limits real bytes when Content-Length lies", async () => {
    const response = new Response(Buffer.alloc(64), { headers: { "Content-Length": "1" } });
    await expect(readDownloadBuffer(response, 32)).rejects.toThrow("File too large");
  });
  it("reads bounded bytes without arrayBuffer", async () => {
    const response = new Response(Buffer.from("hello"));
    response.arrayBuffer = async () => { throw new Error("must stream"); };
    expect(await readDownloadBuffer(response, 32)).toEqual(Buffer.from("hello"));
  });
});
