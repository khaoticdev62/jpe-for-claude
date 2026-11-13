import { JpeError } from "../../core/errors.js";
import type { DocProvider, ProviderContext } from "../types.js";

export interface McpTool {
  name: string;
  inputSchema?: { properties?: Record<string, unknown> } | undefined;
}

/**
 * A connection to a running MCP server that offers documentation tools (such as Context7).
 * Tool names are never assumed: they are discovered from what the server advertises.
 */
export interface McpToolCaller {
  listTools(): Promise<McpTool[]>;
  /** Calls a tool and returns its text output. */
  callTool(name: string, args: Record<string, string>): Promise<string>;
}

export interface Context7Tools {
  resolve: { name: string; libraryProp: string; topicProp?: string };
  query: { name: string; idProp: string; topicProp?: string };
}

const props = (tool: McpTool): string[] => Object.keys(tool.inputSchema?.properties ?? {});
const findProp = (tool: McpTool, pattern: RegExp): string | undefined => props(tool).find((p) => pattern.test(p));

/** Picks the two tools by their advertised parameters: one takes a library NAME, the other a library ID plus a question. */
export function discoverContext7Tools(tools: readonly McpTool[]): Context7Tools | undefined {
  let resolve: Context7Tools["resolve"] | undefined;
  let query: Context7Tools["query"] | undefined;
  for (const tool of tools) {
    const nameProp = findProp(tool, /^(library|package).*name$|^libraryName$/i);
    const idProp = findProp(tool, /^(library|context7).*id$|^libraryId$/i);
    const topicProp = findProp(tool, /^(query|topic|question)$/i);
    if (idProp && !query) query = { name: tool.name, idProp, ...(topicProp ? { topicProp } : {}) };
    else if (nameProp && !resolve) resolve = { name: tool.name, libraryProp: nameProp, ...(topicProp ? { topicProp } : {}) };
  }
  return resolve && query ? { resolve, query } : undefined;
}

/** The first "/org/project" style identifier in the resolver's text output. */
export function extractLibraryId(text: string): string | undefined {
  return /(?:^|[\s"'`(])(\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)(?=[\s"'`),.]|$)/.exec(text)?.[1];
}

/**
 * Context7-compatible provider. It talks to an MCP server through the injected caller, so it
 * never invents tool names. Results do not state which library version they describe, so version
 * matching stays "unversioned" instead of pretending to be exact.
 */
export function createContext7Provider(caller: McpToolCaller): DocProvider {
  return {
    name: "context7",
    needsNetwork: true,
    async fetch(request, _ctx: ProviderContext) {
      const tools = discoverContext7Tools(await caller.listTools());
      if (!tools) return { results: [], notes: ["The connected documentation server does not offer the expected resolve/query tools."] };

      const resolveArgs: Record<string, string> = { [tools.resolve.libraryProp]: request.library };
      if (tools.resolve.topicProp) resolveArgs[tools.resolve.topicProp] = request.topic;
      const id = extractLibraryId(await caller.callTool(tools.resolve.name, resolveArgs));
      if (!id) return { results: [], notes: [`The documentation server did not recognise "${request.library}".`] };

      const topic = request.version ? `${request.topic} (for version ${request.version})` : request.topic;
      const queryArgs: Record<string, string> = { [tools.query.idProp]: id };
      if (tools.query.topicProp) queryArgs[tools.query.topicProp] = topic;
      const content = await caller.callTool(tools.query.name, queryArgs);
      if (content.trim() === "") throw new JpeError("PROVIDER_FAILED", "The documentation server returned nothing for that question.");
      return {
        results: [{ provider: "context7", kind: "reference", title: `${request.library} documentation (${id})`, content, trust: "third-party" }],
        notes: request.version ? ["This documentation index does not state which library version it describes; confirm against the installed version."] : [],
      };
    },
  };
}
