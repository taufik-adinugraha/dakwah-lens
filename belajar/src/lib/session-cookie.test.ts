import { describe, expect, it } from "vitest";

import { hasSessionCookie } from "./session-cookie";

describe("hasSessionCookie", () => {
  it("accepts the secure, plain and chunked Auth.js session cookies", () => {
    expect(hasSessionCookie("__Secure-authjs.session-token=abc")).toBe(true);
    expect(hasSessionCookie("a=1; authjs.session-token=abc")).toBe(true);
    expect(hasSessionCookie("x=y; __Secure-authjs.session-token.0=abc")).toBe(true);
  });

  it("ignores other Auth.js cookies and look-alikes", () => {
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("__Host-authjs.csrf-token=abc")).toBe(false);
    expect(hasSessionCookie("__Secure-authjs.callback-url=x")).toBe(false);
    expect(hasSessionCookie("myauthjs.session-token=abc")).toBe(false);
  });
});
