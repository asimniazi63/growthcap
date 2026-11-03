import { describe, expect, it } from "vitest";
import { repairInstruction } from "./prompt";

// The one message the loop sends when the number checker finds a figure it cannot match: the figures, in quotes, and the way out. Every
// route that runs the agent (the chat, the playbooks, the weekly brief, the audit) shares it, so it is pinned here as it stands.

describe("repairInstruction", () => {
  it("lists the figures the checker could not find, in quotes, and asks for a rewrite from the tool results", () => {
    const message = repairInstruction(["$108,707", "40%"]);
    expect(message).toContain('these figures in your tool results: "$108,707", "40%".');
    expect(message).toContain("Write the answer again using only values from the tool results.");
    expect(message).toContain("Call a tool if you need a figure you don't have, and leave out any figure you can't source.");
    expect(message).toContain("Do not mention this check.");
  });

  it("names a single figure the same way", () => {
    expect(repairInstruction(["0.25"])).toContain('these figures in your tool results: "0.25". Write the answer again');
  });
});
