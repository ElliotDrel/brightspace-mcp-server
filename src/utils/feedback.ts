/** Public instructor feedback only; never substitute private comments. */
import { convertHtmlToMarkdown } from "./html-converter.js";

export interface FeedbackText {
  Text?: string | null;
  Html?: string | null;
}

export function feedbackText(value?: FeedbackText | null): string | null {
  if (!value) return null;
  const markdown = value.Html ? convertHtmlToMarkdown(value.Html).markdown : null;
  if (markdown?.trim()) return markdown;
  return value.Text?.trim() ? value.Text : null;
}

export const FEEDBACK_UNAVAILABLE_NOTE =
  "Brightspace did not return instructor comments through this API. Published feedback may still " +
  "be available in Brightspace; do not interpret null as no feedback. Check the source URL.";
