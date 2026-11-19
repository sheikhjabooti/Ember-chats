import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",
  breakoutWarningWindowSeconds: parseInt(process.env.BREAKOUT_WARNING_WINDOW_SECONDS ?? "15", 10),
  breakoutDefaultInactivitySeconds: parseInt(process.env.BREAKOUT_DEFAULT_INACTIVITY_SECONDS ?? "1800", 10),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};
