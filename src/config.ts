import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required"),
  PLAYLIST_CHANNEL_ID: z.string().min(1, "PLAYLIST_CHANNEL_ID is required"),
  VOICE_CHANNEL_ID: z.string().min(1, "VOICE_CHANNEL_ID is required"),
  IDLE_DISCONNECT_MINUTES: z
    .string()
    .default("15")
    .transform(Number)
    .pipe(z.number().int().positive()),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
});

export type Config = z.infer<typeof envSchema>;

const parseEnv = (): Config => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .filter((i) => i.code === "invalid_type" && i.received === "undefined")
      .map((i) => `  - ${i.path.join(".")}`)
      .join("\n");
    const errors = result.error.issues
      .filter((i) => i.code !== "invalid_type" || i.received !== "undefined")
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    const msg = [
      "━━━ jukebot ─ configuration error ━━━",
      missing ? `Missing required env vars:\n${missing}` : "",
      errors ? `Invalid env vars:\n${errors}` : "",
      "See .env.example for the full list.",
    ]
      .filter(Boolean)
      .join("\n\n");
    console.error(msg);
    process.exit(1);
  }
  return result.data;
};

export const config: Config = parseEnv();
