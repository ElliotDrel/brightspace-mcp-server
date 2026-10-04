/**
 * Purdue Brightspace MCP Server
 * Copyright (c) 2026 Rohan Muppa. All rights reserved.
 * Licensed under MIT — see LICENSE file for details.
 */

import fs from "node:fs/promises";
import { constants } from "node:fs";
import { DownloadError } from "./download-errors.js";
import path from "node:path";
import { validateDownloadPath, validateFileType, MAX_FILE_SIZE } from "./file-validator.js";
import { log } from "./logger.js";

/**
 * Resolve filename conflicts by appending (1), (2), etc.
 *
 * @param dir - Target directory
 * @param filename - Original filename
 * @returns First available filename (may be original or with suffix)
 */
export async function resolveFilenameConflict(
  dir: string,
  filename: string
): Promise<string> {
  const fullPath = path.join(dir, filename);

  try {
    await fs.access(fullPath);
    // File exists, need to resolve conflict
  } catch {
    // File doesn't exist, use original name
    return filename;
  }

  // Parse filename into name and extension
  const ext = path.extname(filename);
  const basename = path.basename(filename, ext);

  // Try filename(1), filename(2), etc.
  for (let i = 1; i <= 100; i++) {
    const candidate = `${basename}(${i})${ext}`;
    const candidatePath = path.join(dir, candidate);

    try {
      await fs.access(candidatePath);
      // File exists, try next
    } catch {
      // File doesn't exist, use this name
      return candidate;
    }
  }

  throw new Error("Could not resolve filename conflict after 100 attempts");
}

/**
 * Securely download file with validation, conflict resolution, and size limits.
 *
 * @param options - Download configuration
 * @returns Download result with path, size, and detected MIME type
 * @throws Error if validation fails or file system operation fails
 */
export async function secureDownload(options: {
  targetDir: string;
  filename: string;
  data: Buffer;
  allowedTypes?: string[];
}): Promise<{ path: string; size: number; mime: string }> {
  const { targetDir, filename, data, allowedTypes } = options;

  log("DEBUG", `secureDownload: starting download of ${filename} to ${targetDir}`);

  // Validate target directory exists and is a directory
  try {
    const stats = await fs.stat(targetDir);
    if (!stats.isDirectory()) {
      throw new Error(`Target path is not a directory: ${targetDir}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Target directory does not exist: ${targetDir}`);
    }
    throw error;
  }

  // Validate file size
  const size = data.byteLength;
  if (size > MAX_FILE_SIZE) {
    throw new Error(
      `File size (${size} bytes) exceeds maximum allowed (${MAX_FILE_SIZE} bytes)`
    );
  }
  log("DEBUG", `secureDownload: file size ${size} bytes (within limit)`);

  // Validate download path (prevent path traversal) and keep the name it
  // sanitized. validateDownloadPath used to be called for its throw alone while
  // the write below still used the raw filename, so a Brightspace-supplied
  // "../../name.pdf" resolved cleanly through validation and was then written
  // two directories above targetDir. Everything past this point — type
  // detection included — uses the name the file actually gets on disk.
  const validatedPath = validateDownloadPath(targetDir, filename);
  const safeFilename = path.basename(validatedPath);
  log("DEBUG", `secureDownload: path validated as ${validatedPath}`);

  // Validate file type via magic bytes
  // The filename decides which legacy Office format a CFB container is.
  const { mime } = await validateFileType(data, allowedTypes, safeFilename);
  log("DEBUG", `secureDownload: file type validated as ${mime}`);

  // Resolve filename conflicts
  const resolvedFilename = await resolveFilenameConflict(targetDir, safeFilename);
  const finalPath = path.join(targetDir, resolvedFilename);
  log("DEBUG", `secureDownload: resolved filename to ${resolvedFilename}`);

  // Write file to disk
  await fs.writeFile(finalPath, data);
  log("INFO", `Downloaded file to ${finalPath} (${size} bytes, ${mime})`);

  return {
    path: finalPath,
    size,
    mime,
  };
}

/** Disk transfers stream to a temporary file; extraction keeps its smaller buffer cap. */
export const MAX_DISK_FILE_SIZE = 1024 * 1024 * 1024; // 1 GiB

export async function secureDownloadStream(options: {
  targetDir: string;
  filename: string;
  response: Response;
  /** Optional stricter cap; never permits exceeding the disk maximum. */
  maxBytes?: number;
}): Promise<{ path: string; size: number; mime: string }> {
  const { targetDir, filename, response } = options;
  const maximum = options.maxBytes ?? MAX_DISK_FILE_SIZE;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_DISK_FILE_SIZE) throw new Error("Invalid download size limit");
  const safeFilename = path.basename(validateDownloadPath(targetDir, filename));
  const stats = await fs.stat(targetDir);
  if (!stats.isDirectory()) throw new Error(`Target path is not a directory: ${targetDir}`);
  const reported = Number(response.headers.get("Content-Length"));
  if (reported > maximum) {
    await response.body?.cancel();
    throw new DownloadError("tooLargeDisk", `File too large. Maximum disk download: ${maximum / 1024 / 1024}MB`);
  }
  if (!response.body) throw new Error("File download returned an empty body");
  const temporaryDir = await fs.mkdtemp(path.join(targetDir, ".brightspace-download-"));
  const temporaryPath = path.join(temporaryDir, "download.part");
  let size = 0;
  try {
    const handle = await fs.open(temporaryPath, "wx");
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) throw new DownloadError("tooLargeDisk", `File too large. Maximum disk download: ${maximum / 1024 / 1024}MB`);
        let written = 0;
        while (written < value.byteLength) {
          const result = await handle.write(value, written, value.byteLength - written);
          if (result.bytesWritten === 0) throw new Error("Could not write downloaded file");
          written += result.bytesWritten;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await handle.close();
    }
    const { validateFileTypeOnDisk } = await import("./file-validator.js");
    const { mime } = await validateFileTypeOnDisk(temporaryPath, safeFilename);
    const ext = path.extname(safeFilename);
    const basename = path.basename(safeFilename, ext);
    for (let attempt = 0; attempt <= 100; attempt++) {
      const candidate = attempt === 0 ? safeFilename : `${basename}(${attempt})${ext}`;
      const finalPath = path.join(targetDir, candidate);
      try {
        // Exclusive copy prevents a competing download from being overwritten.
        await fs.copyFile(temporaryPath, finalPath, constants.COPYFILE_EXCL);
        return { path: finalPath, size, mime };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new Error("Could not resolve filename conflict after 100 attempts");
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
}

/** Read a small extraction response with a limit even when headers are missing or false. */
export async function readDownloadBuffer(response: Response, maximum = MAX_FILE_SIZE): Promise<Buffer> {
  if (Number(response.headers.get("Content-Length")) > maximum) {
    await response.body?.cancel();
    throw new DownloadError("tooLargeExtraction", `File too large for buffered extraction. Maximum allowed: ${maximum / 1024 / 1024}MB. Use download_file with downloadPath to save it to disk.`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new DownloadError("tooLargeExtraction", `File too large for buffered extraction. Maximum allowed: ${maximum / 1024 / 1024}MB. Use download_file with downloadPath to save it to disk.`);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
