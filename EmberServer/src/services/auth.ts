import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config";

export interface JwtPayload {
  sub: string; // userID
}

export function signToken(userId: string): string {
  const options: jwt.SignOptions = { expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign({ sub: userId } as JwtPayload, config.jwtSecret, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
