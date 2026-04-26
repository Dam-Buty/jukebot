import pino from "pino";

// Read env directly so the logger has no dependency on config.ts validation.
// Tests and tools can import logger without supplying Discord credentials.
const level = process.env.LOG_LEVEL ?? "info";
const isProduction = process.env.NODE_ENV === "production";

export const logger: pino.Logger = pino({
  level,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, ignore: "pid,hostname" },
        },
      }),
});
