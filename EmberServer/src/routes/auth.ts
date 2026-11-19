import { Router } from "express";
import { hashPassword, verifyPassword, signToken } from "../services/auth";
import { registerSchema, loginSchema } from "../services/schemas";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { findByEmailOrPhone, findById, createUser, toPublicUser } from "../db/usersRepo";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, phone, password, displayName } = parsed.data;

  if (findByEmailOrPhone(email, phone)) {
    return res.status(409).json({ error: "Account already exists" });
  }

  const user = createUser({ email, phone, displayName, passwordHash: await hashPassword(password) });
  return res.status(201).json({ token: signToken(user.id), user: toPublicUser(user) });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, phone, password } = parsed.data;

  const user = findByEmailOrPhone(email, phone);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  return res.json({ token: signToken(user.id), user: toPublicUser(user) });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = findById(req.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(toPublicUser(user));
});
