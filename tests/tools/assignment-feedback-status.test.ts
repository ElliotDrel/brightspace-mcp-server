import { describe, it, expect } from "vitest";
import { fetchCourseAssignments } from "../../src/tools/get-assignments.js";

const BASE = "https://brightspace.example.edu";
function client(feedback: unknown, failure?: unknown) {
  return {
    le: (course: number, path: string) => `/d2l/api/le/1.0/${course}${path}`,
    get: async (path: string) => {
      if (path.endsWith("/dropbox/folders/")) return [{
        Id: 55, Name: "Essay", IsHidden: false, GroupTypeId: null,
        Assessment: { Rubrics: [{ RubricId: 7, Name: "Writing", Criteria: [{ Id: 1, Name: "Evidence", Levels: [] }] }] },
      }];
      if (path.includes("/feedback/myFeedback/")) {
        if (failure) throw failure;
        return feedback;
      }
      return [];
    },
  };
}

describe("assignment instructor feedback", () => {
  it("preserves plain text, overall rubric and criterion feedback, including a zero score", async () => {
    const [assignment] = await fetchCourseAssignments(client({
      Score: 0, Feedback: { Text: "Revise the argument", Html: "" },
      RubricAssessments: [{ RubricId: 7, OverallScore: 0, OverallFeedback: { Html: "<p>Overall <strong>comment</strong></p>" },
        CriteriaOutcome: [{ CriterionId: 1, Score: 0, Feedback: { Text: "Cite sources" } }] }],
    }) as any, 101, BASE);
    expect(assignment).toMatchObject({ feedbackStatus: "retrieved", feedback: {
      score: 0, feedback: "Revise the argument", rubricAssessments: [{ rubricId: 7, score: 0,
        feedback: "Overall **comment**", criteria: [{ criterionName: "Evidence", score: 0, feedback: "Cite sources" }] }],
    } });
    expect(assignment.feedbackUrl).toContain("ou=101");
  });

  it.each([[403, "restricted"], [404, "unavailable"], [500, "error"]])(
    "reports HTTP %s as %s without asserting no published feedback", async (status, expected) => {
      const [assignment] = await fetchCourseAssignments(client(null, Object.assign(new Error("API error"), { status })) as any, 101, BASE);
      expect(assignment.feedback).toBeNull();
      expect(assignment.feedbackStatus).toBe(expected);
      expect(assignment.feedbackStatusNote).toContain("do not interpret null as no feedback");
    });

  it("reports a null API result as unavailable", async () => {
    const [assignment] = await fetchCourseAssignments(client(null) as any, 101);
    expect(assignment).toMatchObject({ feedbackStatus: "unavailable", feedback: null, feedbackUrl: null });
  });

  it.each([{ Score: 0 }, { Score: 75, Feedback: { Text: "", Html: "<p> </p>" } }])(
    "preserves a score-only record while marking comments unavailable", async (record) => {
      const [assignment] = await fetchCourseAssignments(client(record) as any, 101, BASE);
      expect(assignment.feedback.score).toBe(record.Score);
      expect(assignment.feedback.feedback).toBeNull();
      expect(assignment.feedbackStatus).toBe("retrieved");
      expect(assignment.feedbackCommentsStatus).toBe("unavailable");
      expect(assignment.feedbackStatusNote).toContain("do not interpret null as no feedback");
    });
});
