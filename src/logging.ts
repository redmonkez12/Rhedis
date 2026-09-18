import { configureSync, getConsoleSink, getJsonLinesFormatter, isLogLevel } from "@logtape/logtape";

let configured = false;

export function configureLogging(): void {
  if (configured) return;

  const level = process.env.LOG_LEVEL ?? "info";
  if (!isLogLevel(level)) {
    throw new Error("LOG_LEVEL must be trace, debug, info, warning, error, or fatal");
  }

  configureSync({
    sinks: { console: getConsoleSink({ formatter: getJsonLinesFormatter() }) },
    loggers: [
      { category: ["redis-practice"], lowestLevel: level, sinks: ["console"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    ],
  });
  configured = true;
}
