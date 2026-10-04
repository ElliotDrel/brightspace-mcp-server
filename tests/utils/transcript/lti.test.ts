import { describe, it, expect } from "vitest";
import { brightspaceLtiLaunchUrl } from "../../../src/utils/transcript/lti.js";

describe("Brightspace LTI quickLinks", () => {
  it("removes session parameters while preserving the launch destination", () => {
    expect(brightspaceLtiLaunchUrl("/d2l/common/dialogs/quickLink/quickLink.d2l?type=lti&rcode=abc&_=1&d2lSessionVal=secret#lecture"))
      .toBe("/d2l/common/dialogs/quickLink/quickLink.d2l?type=lti&rcode=abc#lecture");
  });
  it.each([
    "javascript:alert(1)",
    "https://user:password@example.edu/d2l/common/dialogs/quickLink/quickLink.d2l?type=lti",
    "http://example.edu/d2l/common/dialogs/quickLink/quickLink.d2l?type=lti",
    "//example.edu/d2l/common/dialogs/quickLink/quickLink.d2l?type=lti",
    "/d2l/common/dialogs/quickLink/quickLink.d2l?type=content",
    "https://example.edu/video?type=lti",
  ])("does not classify unsafe or unrelated URLs: %s", (url) => {
    expect(brightspaceLtiLaunchUrl(url)).toBeNull();
  });
});
