import { describe, expect, it } from "vitest";
import { parseCoursePath } from "../../src/utils/course-files.js";

const ORIGIN = "https://school.example";

describe("canonical course-file path boundaries", () => {
  it.each([
    "/content/enforced/tenant-assigned-folder/Notes/handout%20one.pdf",
    "/content/enforced/999-UnrelatedToOrgUnit/Notes/handout%20one.pdf",
    "/content/enforced/tenant-folder/Notes/caf%C3%A9.pdf",
  ])("preserves the complete escaped file path: %s", filePath => {
    expect(parseCoursePath(filePath, 101, ORIGIN)).toBe(filePath);
    expect(parseCoursePath(`${ORIGIN}${filePath}`, 101, ORIGIN)).toBe(filePath);
  });

  it("accepts a root-relative enforced path without an origin but refuses an absolute URL", () => {
    const filePath = "/content/enforced/tenant-folder/a.pdf";
    expect(parseCoursePath(filePath, 101)).toBe(filePath);
    expect(parseCoursePath(`${ORIGIN}${filePath}`, 101)).toHaveProperty("error");
  });

  it.each([
    "/content/enforced/../tenant-folder/a.pdf",
    "/content/enforced/%2e%2e/tenant-folder/a.pdf",
    "/content/enforced/%252e%252e/tenant-folder/a.pdf",
    "/content/enforced/tenant%2ffolder/a.pdf",
    "/content/enforced/tenant%5cfolder/a.pdf",
    "/content/enforced/tenant-folder/Notes/%252fsecret.pdf",
    "/content/enforced/tenant-folder/Notes/%255csecret.pdf",
    "/content/enforced/tenant-folder/Notes/%25252e%25252e/a.pdf",
    "/content/enforced/tenant-folder/Notes/%09a.pdf",
    "/content/enforced/tenant-folder/Notes/%7fa.pdf",
    "/content/enforced/tenant-folder/Notes/./a.pdf",
  ])("rejects unsafe folder and nested file segments before URL normalization: %s", filePath => {
    expect(parseCoursePath(filePath, 101, ORIGIN)).toHaveProperty("error");
    expect(parseCoursePath(`${ORIGIN}${filePath}`, 101, ORIGIN)).toHaveProperty("error");
  });
});
