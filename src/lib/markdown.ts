// Safe Markdown renderer for README display (INH-374, M8-05).
// Strategy: HTML-escape everything first, then apply a Markdown subset. Because all input
// is escaped before any tag is inserted, raw <script>/HTML in a README can never execute.
// The subset now covers tables, images, task lists, ordered lists, heading anchors and
// repo-relative links/images (resolved against a caller-supplied base).

export interface MarkdownOptions {
  /** Base for relative links, e.g. https://github.com/o/r/blob/HEAD/ */
  linkBase?: string;
  /** Base for relative images, e.g. https://raw.githubusercontent.com/o/r/HEAD/ */
  imageBase?: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveUrl(url: string, base: string | undefined): string | null {
  if (/^https?:\/\//i.test(url)) return url;
  if (!base) return null;
  if (/^(javascript|data|vbscript|file):/i.test(url)) return null;
  try {
    const resolved = new URL(url, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function inline(text: string, opts: MarkdownOptions): string {
  let out = text;

  // Images first so the link rule does not consume them.
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, url) => {
    const src = resolveUrl(url, opts.imageBase ?? opts.linkBase);
    if (!src) return match;
    return `<img src="${src}" alt="${alt}" loading="lazy" class="max-w-full my-2 rounded" />`;
  });

  out = out
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
      const href = resolveUrl(url, opts.linkBase);
      if (!href) return label;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

  return out;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

export function renderMarkdownSafe(
  markdown: string,
  opts: MarkdownOptions = {},
): string {
  const escaped = escapeHtml(markdown);
  const lines = escaped.split("\n");
  const out: string[] = [];
  const usedIds = new Map<string, number>();
  let inCode = false;
  let listKind: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  };

  const openList = (kind: "ul" | "ol") => {
    if (listKind === kind) return;
    closeList();
    out.push(
      kind === "ul"
        ? '<ul class="list-disc pl-6 my-2">'
        : '<ol class="list-decimal pl-6 my-2">',
    );
    listKind = kind;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

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

    // Tables: header row followed by a separator row.
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      closeList();
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        rows.push(splitRow(lines[j]));
        j += 1;
      }
      out.push(
        '<div class="overflow-auto my-3"><table class="w-full text-sm border-collapse">',
      );
      out.push(
        `<thead><tr>${header
          .map(
            (cell) =>
              `<th class="text-left font-semibold border-b border-gray-300 py-1 pr-3">${inline(cell, opts)}</th>`,
          )
          .join("")}</tr></thead><tbody>`,
      );
      for (const row of rows) {
        out.push(
          `<tr>${row
            .map(
              (cell) =>
                `<td class="align-top border-b border-gray-200 py-1 pr-3">${inline(cell, opts)}</td>`,
            )
            .join("")}</tr>`,
        );
      }
      out.push("</tbody></table></div>");
      i = j - 1;
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
      const base = slugify(heading[2]) || `section-${level}`;
      const seen = usedIds.get(base) ?? 0;
      usedIds.set(base, seen + 1);
      const id = seen === 0 ? base : `${base}-${seen}`;
      out.push(
        `<h${level} id="${id}" class="font-semibold mt-4 mb-2 scroll-mt-20 ${sizes[level - 1]}">${inline(heading[2], opts)}</h${level}>`,
      );
      continue;
    }

    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      openList("ul");
      const checked = task[1].toLowerCase() === "x" ? " checked" : "";
      out.push(
        `<li class="list-none flex items-start gap-2"><input type="checkbox" disabled${checked} class="mt-1" /><span>${inline(task[2], opts)}</span></li>`,
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      openList("ul");
      out.push(`<li>${inline(bullet[1], opts)}</li>`);
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      openList("ol");
      out.push(`<li>${inline(ordered[1], opts)}</li>`);
      continue;
    }

    closeList();
    if (line.trim() === "") {
      out.push('<div class="h-2"></div>');
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push('<hr class="my-4 border-gray-200" />');
    } else {
      out.push(`<p class="my-1 leading-relaxed">${inline(line, opts)}</p>`);
    }
  }
  if (inCode) out.push("</code></pre>");
  closeList();
  return out.join("");
}
