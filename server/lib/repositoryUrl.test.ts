import { describe, expect, it } from "vitest";
import { parseRepositoryUrl } from "./repositoryUrl.js";

describe("parseRepositoryUrl (M8-02)", () => {
  it("accepts canonical, .git, sub-path, query and shorthand forms", () => {
    for (const input of [
      "https://github.com/honojs/hono",
      "https://github.com/honojs/hono.git",
      "https://github.com/honojs/hono/tree/main/src",
      "https://github.com/honojs/hono?tab=readme#install",
      "http://www.github.com/honojs/hono",
      " honojs/hono ",
    ]) {
      expect(parseRepositoryUrl(input)).toMatchObject({
        providerType: "github",
        host: "github.com",
        path: "honojs/hono",
      });
    }
  });

  it("rejects other hosts, schemes and malformed input", () => {
    for (const input of [
      "https://gitlab.com/group/proj",
      "https://github.com.evil.com/a/b",
      "javascript:alert(1)",
      "//github.com/a/b",
      "ftp://github.com/a/b",
      "https://github.com/onlyowner",
      "https://github.com/a/b/c/d", // still valid: owner/repo is enough
    ]) {
      const parsed = parseRepositoryUrl(input);
      if (input.endsWith("/a/b/c/d")) {
        expect(parsed?.path).toBe("a/b");
      } else {
        expect(parsed).toBeNull();
      }
    }
  });

  it("rejects non-strings and overlong input", () => {
    expect(parseRepositoryUrl(undefined)).toBeNull();
    expect(parseRepositoryUrl(42)).toBeNull();
    expect(
      parseRepositoryUrl(`https://github.com/${"a".repeat(3000)}/b`),
    ).toBeNull();
  });
});
