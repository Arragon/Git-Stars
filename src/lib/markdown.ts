// Minimal, safe Markdown renderer for README display (INH-374).
// Strategy: HTML-escape everything first, then apply a small subset of Markdown formatting.
// Because all input is escaped before any tag is inserted, raw <script>/HTML in a README
// can never execute. ponytail: heading/bold/italic/code/link/list subset only; swap in a
// hardened library (marked + DOMPurify) if rich rendering (tables, images) is required.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

export function renderMarkdownSafe(markdown: string): string {
  const escaped = escapeHtml(markdown);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw;
    if (/^```/.test(line.trim())) {
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        closeList();
        out.push(
          '<pre class="bg-gray-100 rounded p-3 overflow-auto text-sm"><code>',
        );
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(`${line}\n`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const sizes = [
        "text-2xl",
        "text-xl",
        "text-lg",
        "text-base",
        "text-base",
        "text-sm",
      ];
      out.push(
        `<h${level} class="font-semibold mt-4 mb-2 ${sizes[level - 1]}">${inline(heading[2])}</h${level}>`,
      );
      continue;
    }
    const listItem = /^\s*[-*]\s+(.*)$/.exec(line);
    if (listItem) {
      if (!inList) {
        out.push('<ul class="list-disc pl-6 my-2">');
        inList = true;
      }
      out.push(`<li>${inline(listItem[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim() === "") {
      out.push('<div class="h-2"></div>');
    } else {
      out.push(`<p class="my-1 leading-relaxed">${inline(line)}</p>`);
    }
  }
  if (inCode) out.push("</code></pre>");
  closeList();
  return out.join("");
}
