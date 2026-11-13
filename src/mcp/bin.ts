import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// stdout carries the protocol; anything else must go to stderr.
createServer()
  .connect(new StdioServerTransport())
  .catch((error: unknown) => {
    process.stderr.write(`jpe-mcp: failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
