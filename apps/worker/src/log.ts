type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: unknown) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta && typeof meta === "object" ? meta : meta !== undefined ? { meta } : {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (m: string, meta?: unknown) => emit("debug", m, meta),
  info: (m: string, meta?: unknown) => emit("info", m, meta),
  warn: (m: string, meta?: unknown) => emit("warn", m, meta),
  error: (m: string, meta?: unknown) => emit("error", m, meta),
};
