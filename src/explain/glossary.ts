export interface GlossaryEntry {
  /** The accurate technical term, kept in parentheses in explanations. */
  term: string;
  /** Other spellings that should match the same entry. */
  aliases?: readonly string[];
  /** Everyday-English meaning. Must be accurate, not merely friendly. */
  plain: string;
  /** A short phrase to use in place of the term: "a saved copy kept for speed (cache)". */
  phrase: string;
}

/** Plain-English glossary. Each entry keeps the real term so learners can search for it later. */
export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: "async/await", aliases: ["async", "await"], phrase: "waiting for slow work without freezing everything else (async/await)", plain: "A way to start slow work (a download, a database call) and let the program keep doing other things until the answer arrives; `await` marks the point where the code pauses for that one answer." },
  { term: "promise", aliases: ["promises"], phrase: "an IOU for a result that will arrive later (promise)", plain: "An object that stands for a value that is not ready yet. It later becomes either a finished result or a failure." },
  { term: "callback", aliases: ["callbacks"], phrase: "a function you hand over to be called when something finishes (callback)", plain: "A function passed to other code so that code can call it back when it is done or when an event happens." },
  { term: "closure", aliases: ["closures"], phrase: "a function that remembers the variables around where it was written (closure)", plain: "A function that keeps access to the variables that existed where it was created, even after that surrounding code has finished." },
  { term: "cache", aliases: ["caching", "cached"], phrase: "a saved copy kept nearby so it does not have to be fetched again (cache)", plain: "A stored copy of something expensive to get or compute, reused to make later requests faster. The risk is that the copy can go stale." },
  { term: "middleware", phrase: "a step that every request passes through on the way in (middleware)", plain: "Code that sits between a request arriving and the code that handles it, doing shared jobs such as logging or checking who you are." },
  { term: "ORM", phrase: "a layer that lets you work with database rows as normal objects (ORM)", plain: "Object-Relational Mapper: a library that translates between database tables and objects in your code, so you write less raw SQL." },
  { term: "race condition", aliases: ["race conditions"], phrase: "a bug where the result depends on which of two things happens to finish first (race condition)", plain: "A bug caused by two operations running at overlapping times where the outcome changes depending on timing." },
  { term: "deadlock", aliases: ["deadlocks"], phrase: "a standoff where two tasks each wait for the other forever (deadlock)", plain: "A situation where tasks are stuck because each holds something the other needs, so none can continue." },
  { term: "null pointer", aliases: ["null reference", "null dereference"], phrase: "using a value that turned out to be 'nothing' (null pointer)", plain: "An error that happens when code tries to use a value that is actually empty (null), as if it were a real thing." },
  { term: "undefined", phrase: "a variable that exists but was never given a value (undefined)", plain: "In JavaScript, the value of something that has not been assigned. Reading a property of it causes an error." },
  { term: "type inference", phrase: "the compiler working out a type for you without being told (type inference)", plain: "When the language figures out the type of a value from how it is used, so you do not have to write it out." },
  { term: "generics", aliases: ["generic", "generic type"], phrase: "code written once that works for many types, like a labelled box that can hold anything (generics)", plain: "A way to write functions or types that work with different kinds of data while still keeping the type checking." },
  { term: "dependency injection", phrase: "handing a piece of code the helpers it needs instead of letting it build them itself (dependency injection)", plain: "Passing in the things a component depends on from outside, which makes the component easy to test and swap." },
  { term: "idempotent", phrase: "safe to repeat: doing it twice has the same effect as once (idempotent)", plain: "An operation that gives the same end result no matter how many times you run it." },
  { term: "endpoint", aliases: ["endpoints", "route handler"], phrase: "a specific address a program can send requests to (endpoint)", plain: "One URL path on a server that accepts requests and returns a response." },
  { term: "API", phrase: "a menu of things one piece of software lets another piece ask it to do (API)", plain: "Application Programming Interface: the defined set of functions or requests that one program exposes for others to use." },
  { term: "REST", phrase: "a common style for web APIs built around addresses and standard actions like GET and POST (REST)", plain: "A convention for web APIs in which each thing has an address and you use standard HTTP actions to read or change it." },
  { term: "JSON", phrase: "a plain-text way of writing structured data (JSON)", plain: "JavaScript Object Notation: a text format for data made of named fields, lists, numbers, strings and true/false values." },
  { term: "serialization", aliases: ["serialize", "serializing", "deserialization", "deserialize"], phrase: "turning data into text or bytes so it can be saved or sent, and back again (serialization)", plain: "Converting in-memory data to a storable or sendable form (serialize), and the reverse (deserialize)." },
  { term: "parse", aliases: ["parsing", "parser"], phrase: "reading text and turning it into structured data the program can use (parsing)", plain: "Analysing text according to a format's rules and converting it into a structure the program can work with." },
  { term: "regex", aliases: ["regular expression", "regular expressions"], phrase: "a compact pattern for finding text (regular expression)", plain: "A short pattern language for matching and extracting pieces of text." },
  { term: "recursion", aliases: ["recursive"], phrase: "a function that solves a problem by calling itself on a smaller piece (recursion)", plain: "A technique where a function calls itself with simpler input until it reaches a case simple enough to answer directly." },
  { term: "memoization", aliases: ["memoize"], phrase: "remembering a function's answers so repeat questions are instant (memoization)", plain: "Caching the result of a function for given inputs so it is not recomputed." },
  { term: "hash map", aliases: ["hashmap", "dictionary", "hash table"], phrase: "a lookup table that finds a value quickly from its key (hash map)", plain: "A data structure that stores values under keys and can retrieve one without scanning everything." },
  { term: "index", aliases: ["database index", "indexes"], phrase: "a table of contents that lets the database find rows fast (index)", plain: "An extra structure the database keeps so searches on certain columns do not need to read every row. It speeds reads and slows writes slightly." },
  { term: "transaction", aliases: ["transactions"], phrase: "a group of database changes that either all happen or none do (transaction)", plain: "A set of operations treated as one unit: if any step fails, all of them are undone." },
  { term: "migration", aliases: ["migrations"], phrase: "a recorded step that changes the database's structure (migration)", plain: "A versioned script that updates a database schema (or data) from one shape to the next." },
  { term: "schema", phrase: "the blueprint describing what shape data is allowed to have (schema)", plain: "A formal description of the fields and types that data must follow." },
  { term: "mutex", aliases: ["lock", "locks"], phrase: "a key that only one task can hold at a time (mutex)", plain: "A lock that lets only one task use a shared resource at once, preventing them from stepping on each other." },
  { term: "thread", aliases: ["threads", "multithreading"], phrase: "one of several streams of work running side by side inside a program (thread)", plain: "A separate path of execution within a process that can run alongside others." },
  { term: "event loop", phrase: "the cycle that picks up the next waiting task and runs it (event loop)", plain: "The mechanism in JavaScript runtimes that repeatedly takes the next queued task or callback and runs it, one at a time." },
  { term: "stream", aliases: ["streams", "streaming"], phrase: "handling data piece by piece as it arrives instead of all at once (stream)", plain: "A way to process data in chunks, so large or endless data does not have to fit in memory." },
  { term: "call stack", aliases: ["stack trace"], phrase: "the list of functions that were in progress when something happened (call stack)", plain: "The ordered record of which function called which. A stack trace prints it when an error occurs, so you can follow the path to the problem." },
  { term: "garbage collection", aliases: ["garbage collector"], phrase: "automatic cleanup of memory nothing uses anymore (garbage collection)", plain: "The runtime's process of finding and freeing memory that the program can no longer reach." },
  { term: "memory leak", aliases: ["memory leaks"], phrase: "a program slowly holding on to memory it no longer needs (memory leak)", plain: "A bug where memory that should be released stays in use, so usage grows over time." },
  { term: "interface", aliases: ["interfaces"], phrase: "a promise about what an object can do, without saying how (interface)", plain: "A description of the properties and functions something must have, so different implementations can be used interchangeably." },
  { term: "polymorphism", phrase: "different kinds of things responding to the same request in their own way (polymorphism)", plain: "Using one interface to work with values of different types, each behaving appropriately." },
  { term: "inheritance", phrase: "a class borrowing the abilities of another class (inheritance)", plain: "A way for one class to reuse and extend the properties and behaviour of another." },
  { term: "refactor", aliases: ["refactoring"], phrase: "reorganising code to be cleaner without changing what it does (refactor)", plain: "Restructuring code while keeping its observable behaviour the same." },
  { term: "linter", aliases: ["lint", "linting"], phrase: "a tool that reads your code looking for likely mistakes and style problems (linter)", plain: "A program that analyses source code without running it and reports suspicious patterns." },
  { term: "compiler", aliases: ["compile", "compiling"], phrase: "the tool that turns your code into something the computer can run (compiler)", plain: "A program that translates source code into machine code or another lower-level form, and reports errors it finds on the way." },
  { term: "bundler", aliases: ["bundle", "bundling"], phrase: "a tool that packs many source files into a few files ready to ship (bundler)", plain: "A build tool that combines your modules and their dependencies into optimised output files." },
  { term: "CI/CD", aliases: ["CI", "continuous integration"], phrase: "an automatic pipeline that tests and ships your code on every change (CI/CD)", plain: "Continuous Integration / Continuous Delivery: automation that builds, tests and optionally releases code whenever it changes." },
  { term: "webhook", aliases: ["webhooks"], phrase: "a message another service sends to your server when something happens (webhook)", plain: "An HTTP request that one service sends to a URL you provide as soon as an event occurs." },
  { term: "JWT", aliases: ["JSON Web Token"], phrase: "a signed digital pass that proves who you are (JWT)", plain: "JSON Web Token: a compact, signed token carrying claims such as a user id. Anyone can read it; only the signature proves it was not altered." },
  { term: "OAuth", phrase: "a standard way to let one app act on your behalf at another without sharing your password (OAuth)", plain: "An authorization framework in which you grant an app limited access to your account via tokens instead of your password." },
  { term: "CORS", phrase: "browser rules about which websites may call your server (CORS)", plain: "Cross-Origin Resource Sharing: headers that tell a browser whether a page from one site may read responses from another." },
  { term: "CSRF", phrase: "a trick where another site makes your browser send a request you did not intend (CSRF)", plain: "Cross-Site Request Forgery: an attack that abuses the fact that browsers automatically attach your login cookies to requests." },
  { term: "XSS", aliases: ["cross-site scripting"], phrase: "an attack where someone's text gets run as code in other visitors' browsers (XSS)", plain: "Cross-Site Scripting: injecting script into a page so it executes in another user's browser." },
  { term: "SQL injection", phrase: "an attack where typed text is run as database commands (SQL injection)", plain: "Inserting SQL through input that the program pastes directly into a query. Parameterised queries prevent it." },
  { term: "sanitize", aliases: ["sanitization", "sanitise", "escaping"], phrase: "cleaning or neutralising input so it cannot do harm (sanitizing)", plain: "Removing or neutralising dangerous characters from input before using it." },
  { term: "mock", aliases: ["mocks", "stub", "stubs"], phrase: "a stand-in that fakes a real part so a test can run in isolation (mock)", plain: "A fake version of a dependency used in tests to control its behaviour and observe how it is used." },
  { term: "unit test", aliases: ["unit tests"], phrase: "a small automatic check of one piece of code (unit test)", plain: "A test that exercises a single function or class in isolation and checks its result." },
  { term: "regression", aliases: ["regressions"], phrase: "something that used to work and broke after a change (regression)", plain: "A bug in functionality that worked before a recent change." },
  { term: "semver", aliases: ["semantic versioning"], phrase: "the MAJOR.MINOR.PATCH numbering that signals how risky an upgrade is (semver)", plain: "Semantic Versioning: a major bump may break compatibility, a minor adds features compatibly, a patch only fixes bugs." },
  { term: "lockfile", phrase: "a file that pins the exact versions installed so everyone gets the same ones (lockfile)", plain: "A generated file recording the exact version of every dependency, making installs reproducible." },
  { term: "environment variable", aliases: ["env var", "env vars", "environment variables"], phrase: "a setting passed to a program from outside its code (environment variable)", plain: "A named value in the program's surroundings, often used for configuration and secrets so they stay out of source code." },
  { term: "debounce", phrase: "waiting until things go quiet before acting (debounce)", plain: "Delaying an action until a burst of triggers has stopped for a short time, such as waiting for typing to pause." },
  { term: "throttle", phrase: "allowing an action at most once per time window (throttle)", plain: "Limiting how often an action can run, no matter how often it is triggered." },
  { term: "lazy loading", phrase: "fetching something only when it is first needed (lazy loading)", plain: "Deferring the loading of a resource until the moment it is actually used." },
  { term: "singleton", phrase: "a thing that is only ever created once and shared (singleton)", plain: "An object designed so that only one instance exists and everyone uses that same one." },
  { term: "immutable", aliases: ["immutability"], phrase: "never changed after it is created; you make a new copy instead (immutable)", plain: "A value that cannot be modified once made. Changes produce a new value." },
  { term: "pure function", aliases: ["pure functions"], phrase: "a function whose answer depends only on its inputs and which changes nothing else (pure function)", plain: "A function with no side effects that always returns the same output for the same input." },
  { term: "side effect", aliases: ["side effects"], phrase: "something a function does besides returning a value, like writing a file (side effect)", plain: "Any change a function makes outside itself: modifying a variable, writing to disk, sending a request." },
  { term: "boilerplate", phrase: "repetitive setup code that has to be there but is not the interesting part (boilerplate)", plain: "Standard code that must be written in many places with little variation." },
  { term: "AST", aliases: ["abstract syntax tree"], phrase: "the tree-shaped structure a tool builds from your code in order to understand it (AST)", plain: "Abstract Syntax Tree: a structured representation of source code used by compilers and tooling." },
  { term: "LSP", aliases: ["language server", "language server protocol"], phrase: "a helper program that understands your code and answers editor questions about it (language server)", plain: "Language Server Protocol: a standard way for tools to ask a language-aware server for errors, definitions, references and types." },
  { term: "ownership", aliases: ["borrow checker", "borrowing"], phrase: "Rust's rule that each value has exactly one owner at a time (ownership)", plain: "In Rust, every value has a single owner; others may borrow it under strict rules the compiler (the borrow checker) enforces, preventing many memory bugs." },
  { term: "goroutine", aliases: ["goroutines"], phrase: "a very lightweight task that Go runs alongside others (goroutine)", plain: "A function running concurrently in Go, managed by the Go runtime rather than the operating system." },
  { term: "pointer", aliases: ["pointers"], phrase: "a note saying where a value lives, rather than the value itself (pointer)", plain: "A variable holding the memory address of another value." },
  { term: "exception", aliases: ["exceptions"], phrase: "an error that interrupts normal flow and must be caught or it stops the program (exception)", plain: "A signal raised when something goes wrong, which unwinds the call stack until some code handles it." },
  { term: "optional chaining", phrase: "safely reaching into something that might be missing (optional chaining)", plain: "The `?.` syntax: stops and gives undefined instead of throwing if a value along the path is null or undefined." },
  { term: "destructuring", phrase: "unpacking pieces of an object or list into separate variables (destructuring)", plain: "Syntax for extracting several values from an object or array in one statement." },
  { term: "scope", phrase: "the part of the code where a name is visible (scope)", plain: "The region of a program in which a variable or function can be referenced." },
  { term: "hoisting", phrase: "JavaScript quietly moving declarations to the top of their scope (hoisting)", plain: "In JavaScript, declarations are processed before code runs, so some names can be used before the line that defines them." },
  { term: "type guard", aliases: ["type narrowing", "narrowing"], phrase: "a check that tells the type system what kind of value you now have (type guard)", plain: "A condition that lets TypeScript narrow a value to a more specific type within a branch." },
  { term: "union type", aliases: ["union"], phrase: "a type that says 'one of these several possibilities' (union type)", plain: "A type that can be any one of a listed set of types." },
  { term: "enum", aliases: ["enumeration"], phrase: "a fixed list of named choices (enum)", plain: "A type with a small, fixed set of named values." },
];

const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const escapeRegex = (s: string): string => s.replace(ESCAPE, "\\$&");

interface Matcher {
  entry: GlossaryEntry;
  pattern: RegExp;
}

const MATCHERS: readonly Matcher[] = GLOSSARY.map((entry) => {
  const names = [entry.term, ...(entry.aliases ?? [])].map(escapeRegex).join("|");
  return { entry, pattern: new RegExp(`(?<![A-Za-z0-9_])(?:${names})(?![A-Za-z0-9_])`, "i") };
});

/** Glossary entries whose terms occur in the text (each at most once, in glossary order). */
export function findJargon(text: string): GlossaryEntry[] {
  return MATCHERS.filter(({ pattern }) => pattern.test(text)).map(({ entry }) => entry);
}

/** Looks up one term (or alias), case-insensitively. */
export function lookupTerm(term: string): GlossaryEntry | undefined {
  const t = term.trim().toLowerCase();
  return GLOSSARY.find((e) => e.term.toLowerCase() === t || e.aliases?.some((a) => a.toLowerCase() === t));
}

/** "plain (technical)" phrase for a term, or the term itself when it is not in the glossary. */
export function plainPhrase(term: string): string {
  return lookupTerm(term)?.phrase ?? term;
}
