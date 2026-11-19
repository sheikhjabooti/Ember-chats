import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config";
import { db } from "../db/database";

export interface JwtPayload {
  sub: string; // user id
  /** Must match users.token_version, bumping it signs the user out everywhere. */
  ver: number;
}

export function signToken(userId: string, tokenVersion: number): string {
  const options: jwt.SignOptions = { expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign({ sub: userId, ver: tokenVersion } satisfies JwtPayload, config.jwtSecret, options);
}

/**
 * Checks the signature and expiry, then that the user still exists and
 * hasn't signed out everywhere since the token was issued. Returns the
 * user id, or null if the token should be rejected.
 */
export function authenticate(token: string): string | null {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    return null;
  }
  const row = db.prepare("SELECT token_version FROM users WHERE id = ?").get(payload.sub) as { token_version: number } | undefined;
  if (!row || row.token_version !== (payload.ver ?? 0)) return null;
  return payload.sub;
}

/** Invalidates every token issued so far for this user. Returns the new version. */
export function revokeAllTokens(userId: string): number {
  db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(userId);
  return (db.prepare("SELECT token_version FROM users WHERE id = ?").get(userId) as { token_version: number }).token_version;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
