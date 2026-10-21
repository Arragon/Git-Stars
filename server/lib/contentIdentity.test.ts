import { describe, expect, it } from "vitest";
import { sha256Hex } from "./contentIdentity.js";

// M8-05: the README content digest must be a stable SHA-256 of the raw source so
// clients can compare cached copies against fresh responses.
describe("sha256Hex", () => {
  it("returns the SHA-256 hex digest of the content", () => {
    // echo -n "hello" | shasum -a 256
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is stable for unicode content and differs across contents", () => {
    const a = sha256Hex("# 标题\n\n内容");
    expect(sha256Hex("# 标题\n\n内容")).toBe(a);
    expect(sha256Hex("# 标题\n\n内容!")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
