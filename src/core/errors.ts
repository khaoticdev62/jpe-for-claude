/** Stable machine-readable error categories. User-facing text lives in `userMessage`. */
export type JpeErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CONFIG"
  | "PATH_REJECTED"
  | "PROVIDER_FAILED"
  | "TOOL_UNAVAILABLE"
  | "TIMEOUT"
  | "NOT_PERMITTED"
  | "INTERNAL";

export class JpeError extends Error {
  readonly code: JpeErrorCode;
  /** Safe, plain-English message that may be shown to the user. */
  readonly userMessage: string;

  constructor(code: JpeErrorCode, userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = "JpeError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function isJpeError(value: unknown): value is JpeError {
  return value instanceof JpeError;
}

/** Converts anything thrown into a JpeError without leaking internals to the user. */
export function toJpeError(value: unknown): JpeError {
  if (isJpeError(value)) return value;
  return new JpeError("INTERNAL", "Something unexpected went wrong inside JPE.", { cause: value });
}
