import { describe, expect, it } from "vitest";

import { inferSpeakerRoles } from "@/src/speaker/role-inference";

describe("speaker role inference", () => {
  it("marks the confirming speaker as waiter when a strong marker exists", () => {
    const turns = inferSpeakerRoles([
      { speaker: "A", text: "Voor mij de steak saignant." },
      { speaker: "B", text: "Dus één steak saignant, goed?" },
      { speaker: "A", text: "Ja." },
    ]);
    expect(turns.map((turn) => turn.speaker)).toEqual(["customer", "waiter", "customer"]);
  });

  it("keeps roles unknown instead of guessing without evidence", () => {
    const turns = inferSpeakerRoles([{ speaker: "A", text: "Een koffie." }]);
    expect(turns[0].speaker).toBe("unknown");
  });
});
