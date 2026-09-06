import { describe, expect, it } from "vitest";
import { renderMarkdownSafe } from "./markdown";

// Security evidence for INH-374: the README renderer must neutralize raw HTML/script and
// non-http(s) links (escape-first strategy).

describe("renderMarkdownSafe (INH-374 security)", () => {
  it("escapes raw HTML/script so it cannot execute", () => {
    const html = renderMarkdownSafe(
      "# Hi\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<h1"); // headings still render
  });

  it("does not create javascript: links", () => {
    const html = renderMarkdownSafe("[click](javascript:alert(1))");
    expect(html).not.toContain('href="javascript:');
  });

  it("renders safe https links with rel=noopener", () => {
    const html = renderMarkdownSafe("[ok](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
