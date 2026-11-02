import { describe, expect, it } from "vitest";
import { FOLLOW_SLACK_PX, isAtBottom, nextStick, type ScrollMetrics } from "./follow-scroll";

const at = (scrollTop: number, scrollHeight = 2000, clientHeight = 600): ScrollMetrics => ({ scrollTop, scrollHeight, clientHeight });

describe("isAtBottom", () => {
  it("is true at the very bottom and within the slack", () => {
    expect(isAtBottom(at(1400))).toBe(true);
    expect(isAtBottom(at(1400 - FOLLOW_SLACK_PX))).toBe(true);
  });

  it("is false once the last lines are further away than the slack", () => {
    expect(isAtBottom(at(1400 - FOLLOW_SLACK_PX - 1))).toBe(false);
    expect(isAtBottom(at(0))).toBe(false);
  });

  it("is true when the content is shorter than the window", () => {
    expect(isAtBottom(at(0, 400, 600))).toBe(true);
  });
});

describe("nextStick", () => {
  it("lets go when the reader scrolls up away from the bottom", () => {
    expect(nextStick(true, 1400, at(1100))).toBe(false);
  });

  it("keeps following while new text grows the page under a reader who has not moved", () => {
    // 300px of new text arrived: scrollTop is the same, the bottom is further away, nobody scrolled
    expect(nextStick(true, 1400, at(1400, 2300))).toBe(true);
  });

  it("stays let go while the reader sits above the bottom, even as the page grows", () => {
    expect(nextStick(false, 1100, at(1100, 2300))).toBe(false);
  });

  it("follows again when the reader scrolls back to the bottom", () => {
    expect(nextStick(false, 1100, at(1390))).toBe(true);
  });

  it("does not count a sub-pixel change as scrolling up", () => {
    expect(nextStick(true, 1400.4, at(1400))).toBe(true);
  });

  it("does not let go when the page shrinks and the browser pulls the position up, as long as the bottom is still in reach", () => {
    expect(nextStick(true, 1400, at(1200, 1790))).toBe(true);
  });
});
