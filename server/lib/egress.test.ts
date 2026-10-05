import { describe, expect, it } from "vitest";
import { assertEgressUrl, EgressBlockedError } from "./egress.js";

describe("assertEgressUrl", () => {
  it("allows https URLs to public DNS hosts", () => {
    expect(assertEgressUrl("https://api.github.com/user").hostname).toBe(
      "api.github.com",
    );
    expect(
      assertEgressUrl("https://github.com/login/oauth/access_token").hostname,
    ).toBe("github.com");
    // Trailing-dot absolute FQDN form is accepted.
    expect(() => assertEgressUrl("https://gitlab.com./api/v4")).not.toThrow();
  });

  it("rejects non-https protocols", () => {
    expect(() => assertEgressUrl("http://api.github.com")).toThrow(
      EgressBlockedError,
    );
    expect(() => assertEgressUrl("file:///etc/passwd")).toThrow(
      EgressBlockedError,
    );
  });

  it("rejects loopback and private-network hostnames", () => {
    for (const url of [
      "https://localhost/api",
      "https://localhost.localdomain/api",
      "https://foo.localhost/api",
      "https://printer.local/api",
      "https://db.internal/api",
      "https://host.home.arpa/api",
    ]) {
      expect(() => assertEgressUrl(url)).toThrow(EgressBlockedError);
    }
  });

  it("rejects raw IP literals (IPv4 and IPv6)", () => {
    for (const url of [
      "https://127.0.0.1/api",
      "https://10.1.2.3/api",
      "https://192.168.1.1/api",
      "https://169.254.169.254/latest/meta-data",
      "https://8.8.8.8/api",
      "https://[::1]/api",
      "https://[fe80::1]/api",
    ]) {
      expect(() => assertEgressUrl(url)).toThrow(EgressBlockedError);
    }
  });

  it("rejects unparsable URLs", () => {
    expect(() => assertEgressUrl("not a url")).toThrow(EgressBlockedError);
  });
});
