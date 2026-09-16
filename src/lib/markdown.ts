/**
 * Minimal Markdown → HTML converter for event descriptions.
 *
 * Supports a safe subset: paragraphs, line breaks, bold, italic, links,
 * headings (h2/h3), bullet lists and blockquotes. Raw HTML is escaped.
 */

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch] ?? ch);
}

function inlineHtml(text: string): string {
  return (
    escapeHtml(text)
      // Links: [text](url)
      .replace(
        /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>',
      )
      // Bold: **text**
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // Italic: *text* (not inside **)
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
  );
}

export function markdownToHtml(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";

  const rawLines = trimmed.split("\n");
  const blocks: string[] = [];
  let listItems: string[] | null = null;

  function flushList() {
    if (!listItems || listItems.length === 0) return;
    blocks.push(
      `<ul class="ui-list-disc mt-1.5 list-inside space-y-0.5">${listItems.join("")}</ul>`,
    );
    listItems = null;
  }

  for (let rawLine of rawLines) {
    const line = rawLine.trimEnd();
    if (!line) {
      flushList();
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      flushList();
      blocks.push(
        `<blockquote class="border-l-2 border-line pl-3 italic text-muted">${inlineHtml(line.slice(2))}</blockquote>`,
      );
      continue;
    }

    // Bullet list
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!listItems) listItems = [];
      listItems.push(`<li>${inlineHtml(line.slice(2))}</li>`);
      continue;
    }

    flushList();

    // Headings
    if (line.startsWith("## ")) {
      blocks.push(
        `<h2 class="mt-2 text-base font-semibold text-ink">${inlineHtml(line.slice(3))}</h2>`,
      );
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push(
        `<h3 class="mt-2 text-sm font-semibold text-ink">${inlineHtml(line.slice(4))}</h3>`,
      );
      continue;
    }

    // Paragraph
    blocks.push(`<p class="leading-relaxed">${inlineHtml(line)}</p>`);
  }

  flushList();
  return blocks.join("");
}
