import { serverEnv } from './env';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are never written to logs. */
const REDACT = /secret|token|password|authorization|cookie|api[_-]?key/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
      key,
      REDACT.test(key) ? '[redacted]' : redact(inner, depth + 1),
    ]),
  );
}

function threshold(): number {
  try {
    return ORDER[serverEnv().logLevel];
  } catch {
    return ORDER.info;
  }
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

/** Structured JSON logger. `event` is a stable dotted name, e.g. `crawl.page.fetched`. */
export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};
