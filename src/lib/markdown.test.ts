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

describe("README fidelity (M8-05)", () => {
  const opts = {
    linkBase: "https://github.com/honojs/hono/blob/HEAD/",
    imageBase: "https://raw.githubusercontent.com/honojs/hono/HEAD/",
  };

  it("renders GitHub-style tables", () => {
    const html = renderMarkdownSafe(
      "| Name | Value |\n| --- | --- |\n| a | `1` |\n| b | 2 |",
      opts,
    );
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Name");
    expect(html).toContain("<code>1</code>");
    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2 rows
  });

  it("renders task lists with disabled checkboxes", () => {
    const html = renderMarkdownSafe("- [x] done\n- [ ] todo", opts);
    expect(html).toContain('type="checkbox" disabled checked');
    expect(html).toContain('type="checkbox" disabled');
    expect(html).toContain("todo");
  });

  it("resolves relative links and images against the provider bases", () => {
    const html = renderMarkdownSafe(
      "[docs](docs/guide.md) ![logo](assets/logo.png)",
      opts,
    );
    expect(html).toContain(
      'href="https://github.com/honojs/hono/blob/HEAD/docs/guide.md"',
    );
    expect(html).toContain(
      'src="https://raw.githubusercontent.com/honojs/hono/HEAD/assets/logo.png"',
    );
    expect(html).toContain('loading="lazy"');
  });

  it("does not emit href/src for non-http schemes", () => {
    const html = renderMarkdownSafe("[x](javascript:alert(1))", opts);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("x");
  });

  it("escapes raw HTML inside table cells", () => {
    const html = renderMarkdownSafe(
      "| a |\n| --- |\n| <script>alert(1)</script> |",
      opts,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("generates unique heading anchors", () => {
    const html = renderMarkdownSafe("# Usage\n## Usage", opts);
    expect(html).toContain('id="usage"');
    expect(html).toContain('id="usage-1"');
  });
});
