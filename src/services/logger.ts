type LogContext = Record<string, unknown>;

function log(level: "info" | "warn" | "error", scope: string, message: string, context?: LogContext): void {
  const payload = {
    level,
    scope,
    message,
    ...(context ? { context } : {}),
    timestamp: new Date().toISOString(),
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function createLogger(scope: string) {
  return {
    info(message: string, context?: LogContext): void {
      log("info", scope, message, context);
    },
    warn(message: string, context?: LogContext): void {
      log("warn", scope, message, context);
    },
    error(message: string, context?: LogContext): void {
      log("error", scope, message, context);
    },
  };
}

