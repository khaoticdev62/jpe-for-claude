import { createContext } from "./context.js";
import { runCli } from "./main.js";

runCli(process.argv.slice(2), createContext()).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write("jpe: fatal error\n");
    process.exitCode = 2;
  },
);
