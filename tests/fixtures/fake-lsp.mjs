// A tiny but real Language Server Protocol server used to test the client end to end.
// Behaviour: reports one error for every line containing "BAD", answers symbol/definition/
// reference/hover requests with fixed data, asks the client a question after initialize,
// and exits on "exit". Pass "--crash" to die right after initialize.
let buffer = Buffer.alloc(0);
const crash = process.argv.includes("--crash");

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
}

function onMessage(msg) {
  if (msg.method === "initialize") {
    send({ id: msg.id, result: { capabilities: { textDocumentSync: 1 }, serverInfo: { name: "fake-lsp" } } });
    if (crash) setTimeout(() => process.exit(3), 20);
    return;
  }
  if (msg.method === "initialized") {
    send({ id: 9001, method: "workspace/configuration", params: { items: [{ section: "x" }] } });
    return;
  }
  if (msg.method === "textDocument/didOpen") {
    const { uri, text } = msg.params.textDocument;
    send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
    const diagnostics = text.split("\n").flatMap((line, i) =>
      line.includes("BAD")
        ? [{ range: { start: { line: i, character: line.indexOf("BAD") }, end: { line: i, character: line.indexOf("BAD") + 3 } }, severity: 1, message: "BAD token", code: "E1", source: "fake" }]
        : [],
    );
    setTimeout(() => send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics } }), 100);
    return;
  }
  if (msg.method === "textDocument/documentSymbol") {
    send({ id: msg.id, result: [{ name: "Thing", kind: 5, range: { start: { line: 0, character: 0 } }, selectionRange: { start: { line: 0, character: 6 } }, children: [{ name: "run", kind: 6, selectionRange: { start: { line: 1, character: 2 } } }] }] });
    return;
  }
  if (msg.method === "textDocument/definition") {
    send({ id: msg.id, result: [{ uri: msg.params.textDocument.uri, range: { start: { line: 4, character: 1 } } }] });
    return;
  }
  if (msg.method === "textDocument/references") {
    send({ id: msg.id, result: [
      { uri: "file:///proj/a.ts", range: { start: { line: 0, character: 0 } } },
      { uri: "file:///proj/a.ts", range: { start: { line: 3, character: 0 } } },
      { uri: "file:///proj/b.ts", range: { start: { line: 1, character: 2 } } },
    ] });
    return;
  }
  if (msg.method === "textDocument/hover") {
    send({ id: msg.id, result: { contents: { kind: "markdown", value: "```ts\nfunction run(): void\n```" } } });
    return;
  }
  if (msg.method === "shutdown") {
    send({ id: msg.id, result: null });
    return;
  }
  if (msg.method === "exit") process.exit(0);
  if (msg.id !== undefined && msg.method === undefined) return; // reply to our own question
  if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end === -1) return;
    const len = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + len) return;
    const body = buffer.subarray(end + 4, end + 4 + len).toString("utf8");
    buffer = buffer.subarray(end + 4 + len);
    onMessage(JSON.parse(body));
  }
});
