import { describe, expect, it } from "vitest";
import { JpeError, toJpeError } from "../../src/core/errors.js";
import { createLogger } from "../../src/core/logger.js";
import { redactSecrets } from "../../src/core/redact.js";

describe("redactSecrets", () => {
  it("redacts API keys, bearer tokens and key=value secrets", () => {
    const input = 'key sk-abcdefghijklmnop1234 and Bearer abcdefghijkl12345 and password="hunter2222"';
    const out = redactSecrets(input);
    expect(out).not.toContain("abcdefghijklmnop1234");
    expect(out).not.toContain("hunter2222");
    expect(out).toContain("[REDACTED_SECRET_FOUND]");
  });
  it("leaves normal text untouched", () => {
    expect(redactSecrets("hello world")).toBe("hello world");
  });
});

describe("errors", () => {
  it("wraps unknown throwables without leaking their message", () => {
    const err = toJpeError(new Error("db password leaked"));
    expect(err.code).toBe("INTERNAL");
    expect(err.userMessage).not.toContain("password");
  });
  it("passes JpeError through unchanged", () => {
    const original = new JpeError("INVALID_INPUT", "bad");
    expect(toJpeError(original)).toBe(original);
  });
});

describe("logger", () => {
  it("filters below min level and redacts output", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l) }, "warn", () => new Date(0));
    log.log("info", "skipped");
    log.log("error", "boom", { token: "ghp_abcdefghijklmnopqrstuvwx" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("ghp_abcdefghijklmnopqrstuvwx");
  });
});
