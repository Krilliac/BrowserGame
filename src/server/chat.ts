import { MAX_CHAT_LENGTH } from '../shared/protocol.js';

/** Matches ASCII control characters (C0 range 0x00-0x1F plus DEL 0x7F). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/**
 * Chat is the first real "gameplay system" (from the SparkGameMMO blueprint). It is mostly
 * transport, so the testable core is just sanitization: never trust client text.
 *
 * Returns a clean, broadcast-safe string, or null if the message is empty after cleaning.
 */
export function sanitizeChat(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  // Collapse control characters (incl. newlines) to spaces so a message can't break
  // layout or log lines, then trim and length-cap.
  const cleaned = text.replace(CONTROL_CHARS, ' ').trim().slice(0, MAX_CHAT_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}
