/**
 * Outbound adapter: format ACP output for WeChat delivery.
 */

/**
 * Strip markdown formatting for cleaner WeChat display.
 * Preserves code blocks (as they're useful even in plain text).
 */
export function formatForWeChat(text: string): string {
  // Remove image references ![alt](url)
  let out = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[$1]");

  // Convert links [text](url) → text (url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Remove bold/italic markers but keep text
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  out = out.replace(/\*\*(.+?)\*\*/g, "$1");
  out = out.replace(/\*(.+?)\*/g, "$1");
  out = out.replace(/__(.+?)__/g, "$1");
  out = out.replace(/_(.+?)_/g, "$1");

  // Remove heading markers
  out = out.replace(/^#{1,6}\s+/gm, "");

  // Clean up excessive blank lines
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

/**
 * Format agent thinking output for readable WeChat display.
 *
 * Raw thoughts are often stream-of-consciousness text.
 * This function summarizes and structures them for readability:
 *   - Truncates excessively long thoughts
 *   - Adds visual separators
 *   - Strips markdown noise
 */
const THOUGHT_MAX_LEN = 800;

export function formatThoughtsForWeChat(rawThought: string): string {
  let text = rawThought.trim();
  if (!text) return "";

  // Strip markdown formatting
  text = formatForWeChat(text);

  // Collapse runs of whitespace / blank lines
  text = text.replace(/\n{3,}/g, "\n\n");

  // Truncate if very long
  if (text.length > THOUGHT_MAX_LEN) {
    // Try to cut at a sentence or paragraph boundary
    let cutAt = text.lastIndexOf("\n\n", THOUGHT_MAX_LEN);
    if (cutAt < THOUGHT_MAX_LEN * 0.4) {
      cutAt = text.lastIndexOf("。", THOUGHT_MAX_LEN);
    }
    if (cutAt < THOUGHT_MAX_LEN * 0.4) {
      cutAt = text.lastIndexOf(". ", THOUGHT_MAX_LEN);
    }
    if (cutAt < THOUGHT_MAX_LEN * 0.4) {
      cutAt = THOUGHT_MAX_LEN;
    }
    text = text.substring(0, cutAt) + "\n…";
  }

  // Wrap with visual framing
  return `💭 ———— 思考过程 ————\n${text}\n———————————————`;
}
