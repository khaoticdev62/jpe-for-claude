/**
 * A minimal description of the part of Claude Code's plugin interface that JPE's interface module uses.
 *
 * Claude Code writes the full, authoritative declarations (about 27,000 lines, early access, changing between
 * releases) beside any plugin folder it loads. This file is deliberately small: it lets `npm run typecheck` check the
 * module without those generated files, and it names every call the module makes, so a change in the real interface
 * shows up as a failing run of `npm run test:mod` and `claude plugin validate` rather than as a surprise.
 * `docs/DESIGN-SYSTEM.md` explains how to check the module against the full declarations.
 */

declare module "claude-code" {
  export interface PluginState {}

  /** A state value that may have been written by an older version of the module, so it is re-validated on read. */
  export type Shaped<T> = { readonly shaped?: T };

  export interface StateRef {
    readonly plugin: string;
    readonly key: string;
  }
  export interface Atom<T> {
    readonly ref: StateRef;
    readonly initial: T;
  }
  export function atom<T>(ref: StateRef, initial: T, options?: { shape: string }): Atom<T>;
  export function read<T>($: EngineInterface, source: Atom<T>): Promise<T>;
  export function update<T>($: EngineInterface, source: Atom<T>, change: (value: T) => T): Promise<void>;

  export interface PaneOpenArgs {
    id: string;
    title?: string;
    focus?: true;
    closeOnEscape?: true;
  }

  export interface ProcessResult {
    exitCode: number;
    stdout: string;
    stderr: string;
  }

  export type Surface = "terminal" | "desktop" | "vscode" | "mobile";

  export interface RenderEvent {
    surface: Surface;
    props: { title: string; isFocused: boolean; bodyColumns: number; placement: string };
  }

  export interface ElementProps {
    children?: unknown;
    [prop: string]: unknown;
  }
  export type ElementConstructor = (props: ElementProps) => unknown;
  export interface ElementTable {
    Box: ElementConstructor;
    Text: ElementConstructor;
    Button: ElementConstructor;
    Input: ElementConstructor;
    Select: ElementConstructor;
  }

  export interface EngineInterface {
    plugin: { root: string };
    clock: { now(): Promise<number> };
    store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
    process: { run(argv: readonly string[], init?: { cwd?: string; timeoutMs?: number }): Promise<ProcessResult> };
    command: { run(input: { command: string; args?: string }): Promise<unknown> };
    ui: {
      open(pane: PaneOpenArgs): Promise<{ isPlaced: boolean }>;
      status(text: string | undefined): void;
      toast(text: string): void;
      resolve(event: RenderEvent): ElementTable;
    };
  }

  export interface CommandRunInput {
    command: string;
    args: string;
    presentation: { isFullscreen: boolean; columns: number };
  }
  export interface CommandRunResult {
    text?: string;
    isTextDisplayOnly?: true;
  }
  export type Next<E, R> = (event?: E) => Promise<R>;
  export type Hook<E, R> = ($: EngineInterface, event: E, next: Next<E, R>) => Promise<R> | R;

  export interface SessionStartInput {
    cwd: string;
  }
  export type EmptyInput = Record<string, unknown>;

  export interface On {
    (event: "session.start", hook: Hook<SessionStartInput, SessionStartInput>): void;
    (event: "turn.complete", hook: Hook<EmptyInput, EmptyInput>): void;
    (event: "command.run", hook: Hook<CommandRunInput, CommandRunResult>): void;
    (event: "ui.render", matcher: { component: string; requestId: string }, hook: ($: EngineInterface, event: RenderEvent) => Promise<unknown> | unknown): void;
  }
  export type Register = (on: On, options?: Record<string, unknown>) => void;
}

declare function h(type: unknown, props: unknown, ...children: unknown[]): unknown;
declare const Fragment: unique symbol;

declare namespace JSX {
  type Element = unknown;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicAttributes {
    key?: string;
  }
}
