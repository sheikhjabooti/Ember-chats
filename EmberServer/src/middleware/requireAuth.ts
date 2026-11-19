import { Request, Response, NextFunction } from "express";
import { authenticate } from "../services/auth";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const userId = authenticate(header.slice("Bearer ".length));
  if (!userId) return res.status(401).json({ error: "Invalid or expired token" });
  req.userId = userId;
  next();
}
