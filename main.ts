#!/usr/bin/env node

const VERSION = "1.0.0";
const PROGRAM = "load-zero-postmortem";
const TITLE = "Load: Zero";
const TAGLINE = "A cautionary operations postmortem";
const ENTRY_LINE =
  "Told to 'reduce server load before the demo', I profiled everything, identified the single heaviest process, and killed it. It was the server. Load: zero. Demo: postponed.";

const MIN_WIDTH = 40;
const MAX_WIDTH = 120;
const FALLBACK_WIDTH = 76;

type OutputMode = "plain" | "fancy" | "json";
type ParseResult =
  | { kind: "run"; options: CliOptions }
  | { kind: "help" }
  | { kind: "version" };

interface CliOptions {
  mode: OutputMode;
  width: number;
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function defaultWidth(): number {
  const columns = process.stdout.columns;
  if (typeof columns === "number" && Number.isFinite(columns)) {
    return clamp(Math.floor(columns), 48, 88);
  }
  return FALLBACK_WIDTH;
}

function usage(): string {
  return `${PROGRAM} ${VERSION}

Print a small, sharp operations postmortem.

Usage:
  node main.ts [options]

Options:
  --plain              render as plain text (default)
  --fancy              render in a Unicode box, with ANSI color on terminals
  --json               render machine-readable JSON
  --width <columns>    set output width, ${MIN_WIDTH}-${MAX_WIDTH} columns
  --width=<columns>    same as --width <columns>
  --version            print the version
  --help, -h           print this help to stderr

Exit codes:
  0  success, help, or version
  2  invalid command line
`;
}

function parseWidth(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new CliError(`--width expects an integer, got '${raw}'`);
  }
  const width = Number(raw);
  if (width < MIN_WIDTH || width > MAX_WIDTH) {
    throw new CliError(`--width must be between ${MIN_WIDTH} and ${MAX_WIDTH}, got ${width}`);
  }
  return width;
}

function parseArgs(argv: string[]): ParseResult {
  let width = defaultWidth();
  let selectedMode: OutputMode | null = null;

  const selectMode = (mode: OutputMode): void => {
    if (selectedMode !== null && selectedMode !== mode) {
      throw new CliError(`options --${selectedMode} and --${mode} cannot be combined`);
    }
    selectedMode = mode;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { kind: "help" };
    }
    if (argument === "--version") {
      return { kind: "version" };
    }
    if (argument === "--plain" || argument === "--fancy" || argument === "--json") {
      selectMode(argument.slice(2) as OutputMode);
      continue;
    }
    if (argument === "--width") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new CliError("--width expects a value");
      }
      width = parseWidth(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--width=")) {
      width = parseWidth(argument.slice("--width=".length));
      continue;
    }
    if (argument === "--") {
      if (index + 1 < argv.length) {
        throw new CliError(`unexpected argument '${argv[index + 1]}'`);
      }
      break;
    }
    if (argument.startsWith("-")) {
      throw new CliError(`unknown option '${argument}'`);
    }
    throw new CliError(`unexpected argument '${argument}'`);
  }

  return {
    kind: "run",
    options: { mode: selectedMode ?? "plain", width },
  };
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > width) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      let rest = word;
      while (rest.length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      current = rest;
      continue;
    }

    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function centerText(text: string, width: number): string {
  if (text.length >= width) {
    return text;
  }
  const left = Math.floor((width - text.length) / 2);
  return " ".repeat(left) + text;
}

function renderPlain(width: number): string {
  const rule = "─".repeat(width);
  const lines = wrapText(ENTRY_LINE, width);
  const footer = centerText("root cause: literal load reduction", width);

  return [
    rule,
    centerText(TITLE.toUpperCase(), width),
    centerText(TAGLINE, width),
    rule,
    "",
    ...lines,
    "",
    footer,
    rule,
  ].join("\n");
}

function colorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  return process.stdout.isTTY === true;
}

function paint(text: string, code: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function visibleLength(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function padEndVisible(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

function boxLine(content: string, innerWidth: number): string {
  return `│ ${padEndVisible(content, innerWidth)} │`;
}

function renderFancy(width: number): string {
  const innerWidth = width - 4;
  const colored = colorEnabled();
  const horizontal = "─".repeat(width - 2);
  const title = paint(TITLE.toUpperCase(), "1;31", colored);
  const tagline = paint(TAGLINE, "2", colored);
  const facts = [
    "Heaviest process identified",
    "It was the server",
    "Load: zero; demo: postponed",
  ];
  const body = wrapText(ENTRY_LINE, innerWidth).map((line) => boxLine(line, innerWidth));
  const notes = facts.flatMap((fact) => {
    const marker = paint("▪", "31", colored);
    return wrapText(fact, innerWidth - 2).map((line, lineIndex) =>
      boxLine(`${lineIndex === 0 ? marker : " "} ${line}`, innerWidth),
    );
  });

  return [
    `╭${horizontal}╮`,
    boxLine(title, innerWidth),
    boxLine(tagline, innerWidth),
    `├${horizontal}┤`,
    ...body,
    `├${horizontal}┤`,
    ...notes,
    `╰${horizontal}╯`,
  ].join("\n");
}

function renderJson(): string {
  const payload = {
    title: TITLE,
    tagline: TAGLINE,
    entry: ENTRY_LINE,
    facts: {
      scopeProfiled: "everything",
      heaviestProcess: "the server",
      resultingLoad: "zero",
      demoStatus: "postponed",
    },
    lesson: "Load reduction without availability is just an outage with metrics.",
  };
  return JSON.stringify(payload, null, 2);
}

function render(options: CliOptions): string {
  if (options.mode === "json") {
    return renderJson();
  }
  if (options.mode === "fancy") {
    return renderFancy(options.width);
  }
  return renderPlain(options.width);
}

function main(argv: string[]): number {
  try {
    const parsed = parseArgs(argv);
    if (parsed.kind === "help") {
      process.stderr.write(usage());
      return 0;
    }
    if (parsed.kind === "version") {
      process.stdout.write(`${PROGRAM} ${VERSION}\n`);
      return 0;
    }
    process.stdout.write(render(parsed.options) + "\n");
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${PROGRAM}: ${error.message}\n`);
      process.stderr.write("Try 'node main.ts --help' for usage.\n");
      return 2;
    }
    throw error;
  }
}

const exitCode = main(process.argv.slice(2));
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
