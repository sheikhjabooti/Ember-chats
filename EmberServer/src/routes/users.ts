import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { rateLimit } from "../middleware/rateLimit";
import { updateUser, searchUsers, findById, toProfile, toPublicUser } from "../db/usersRepo";

export const usersRouter = Router();

const updateSettingsSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  statusMessage: z.string().max(200).optional(),
  tombstoneLoggingEnabled: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  fcmToken: z.string().optional(),
});

usersRouter.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = updateUser(req.userId!, parsed.data);
  return res.json(toPublicUser(user));
});

/**
 * GET /users/search?q=...  Find people to start a chat with, by exact
 * email or phone, or by display name prefix. Returns profiles only, no
 * contact details.
 */
usersRouter.get("/search", requireAuth, rateLimit("search", 30, 60), async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (q.trim().length < 2) {
    return res.status(400).json({ error: "Query must be at least 2 characters" });
  }
  return res.json(searchUsers(q, req.userId!).map(toProfile));
});

/** GET /users/:id  Public profile, used to show names instead of ids. */
usersRouter.get("/:userId", requireAuth, async (req: AuthedRequest, res) => {
  const user = findById(String(req.params.userId));
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(toProfile(user));
});
