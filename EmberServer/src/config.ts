import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";
const DEV_JWT_SECRET = "dev-secret-change-me";
const PLACEHOLDER_SECRETS = new Set([DEV_JWT_SECRET, "change-me-to-a-long-random-string"]);

/**
 * In production a real JWT secret is mandatory: anyone who knows the
 * secret can mint tokens for any user. In development we fall back to a
 * fixed value so `npm run dev` works out of the box, and say so loudly.
 */
function resolveJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (value && !PLACEHOLDER_SECRETS.has(value)) return value;
  if (isProduction) {
    throw new Error("JWT_SECRET must be set to a real random value when NODE_ENV=production");
  }
  if (process.env.NODE_ENV !== "test") {
    console.warn("[config] JWT_SECRET is unset or a placeholder. Fine for local dev, never for a deployment.");
  }
  return value ?? DEV_JWT_SECRET;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return parsed;
}

export const config = {
  isProduction,
  port: Math.trunc(numberFromEnv("PORT", 4000)),
  databaseFile: process.env.DATABASE_FILE ?? "./ember.db",
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",
  breakoutWarningWindowSeconds: numberFromEnv("BREAKOUT_WARNING_WINDOW_SECONDS", 15),
  breakoutDefaultInactivitySeconds: numberFromEnv("BREAKOUT_DEFAULT_INACTIVITY_SECONDS", 1800),
  /**
   * How long a breakout can sit with zero connected participants before
   * the clearance warning starts. Gives people time to switch apps or
   * reconnect after a dropped connection without losing the chat.
   */
  breakoutEmptyGraceSeconds: numberFromEnv("BREAKOUT_EMPTY_GRACE_SECONDS", 60),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};
