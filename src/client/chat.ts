/**
 * True if the chat log is scrolled to (or within `threshold` px of) the bottom.
 *
 * Used to decide whether an incoming message should auto-scroll into view: if the reader has
 * scrolled up to read history, leave them where they are; if they're at the bottom, follow the
 * newest line. The threshold absorbs sub-pixel rounding and "close enough" positions. Logs too
 * short to overflow count as pinned (there is nothing above to scroll to).
 */
export function isPinnedToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 24,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}
