import { describe, it, expect } from "vitest";
import { feedbackText } from "../../src/utils/feedback.js";

describe("public feedback rich text", () => {
  it("normalizes HTML and falls back to text for blank markup", () => {
    expect(feedbackText({ Html: "<p><em>Useful</em></p>", Text: "Useful" })).toBe("_Useful_");
    expect(feedbackText({ Html: "<p> </p>", Text: "Useful" })).toBe("Useful");
    expect(feedbackText({ Text: "Plain" })).toBe("Plain");
    expect(feedbackText({ Html: "<p> </p>", Text: " " })).toBeNull();
    expect(feedbackText(null)).toBeNull();
  });
});
