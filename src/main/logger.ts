// Tiny leveled, scoped, structured logger for the Electron MAIN process.
//
// Zero dependencies and plain-node safe (no electron, only erasable TS) so it
// is importable from every main module — including the type-stripped rpc/omp
// ones. Each line is:
//   <ISO timestamp> <LEVEL> [scope] <message> key=value ...
// debug/info go to stdout; warn/error go to stderr. The active threshold is
// read from OMP_STUDIO_LOG_LEVEL (debug|info|warn|error) on every call so it
// can be flipped at runtime; it defaults to `info`. Logging never throws, and
// never serializes secrets the caller did not hand it.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Derive a child logger that prefixes `[tag]` onto every line. */
  scoped(tag: string): Logger;
}

const WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const DEFAULT_LEVEL: LogLevel = "info";

function threshold(): number {
  const raw = process.env.OMP_STUDIO_LOG_LEVEL?.toLowerCase();
  const level: LogLevel =
    raw && raw in WEIGHT ? (raw as LogLevel) : DEFAULT_LEVEL;
  return WEIGHT[level];
}

// Render a single structured-field value without ever throwing. Errors collapse
// to their message; everything else is JSON-encoded with a String() fallback
// for circular/unserializable values.
function render(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function format(
  level: LogLevel,
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
): string {
  let line = `${new Date().toISOString()} ${level.toUpperCase()} ${scope}${message}`;
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      line += ` ${key}=${render(value)}`;
    }
  }
  return line;
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (WEIGHT[level] < threshold()) return;
  try {
    const line = format(level, scope, message, fields);
    if (level === "warn" || level === "error") console.error(line);
    else console.log(line);
  } catch {
    // A logger must never take down the process it observes.
  }
}

function make(scope: string): Logger {
  return {
    debug: (m, f) => emit("debug", scope, m, f),
    info: (m, f) => emit("info", scope, m, f),
    warn: (m, f) => emit("warn", scope, m, f),
    error: (m, f) => emit("error", scope, m, f),
    scoped: (tag) => make(`${scope}[${tag}] `),
  };
}

/** Root (scopeless) logger. */
export const log: Logger = make("");

/** Build a logger whose every line is prefixed with `[tag]`. */
export function scoped(tag: string): Logger {
  return make(`[${tag}] `);
}
