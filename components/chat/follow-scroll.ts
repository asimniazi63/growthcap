// When an answer streams in, the conversation follows the new text only while the reader is at the bottom. Once they scroll up
// to read something above, it stays where they put it until they come back down or press "Jump to latest".

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

// A few lines of slack: the last line may still be laying out, and a hair of scrolling up should not count as leaving.
export const FOLLOW_SLACK_PX = 32;

export const isAtBottom = (m: ScrollMetrics, slack = FOLLOW_SLACK_PX): boolean => m.scrollHeight - m.scrollTop - m.clientHeight <= slack;

// Whether to keep following after a scroll event. `prevTop` is the scroll position at the previous event. Only the reader moving
// up counts as leaving: text arriving makes the page taller without changing the position, so that must not stop the following.
export function nextStick(stick: boolean, prevTop: number, m: ScrollMetrics, slack = FOLLOW_SLACK_PX): boolean {
  if (isAtBottom(m, slack)) return true;
  if (m.scrollTop < prevTop - 1) return false;
  return stick;
}
