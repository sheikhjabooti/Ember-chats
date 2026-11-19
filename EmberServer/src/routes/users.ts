import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { updateUser } from "../db/usersRepo";

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

  return res.json({
    id: user.id,
    displayName: user.display_name,
    statusMessage: user.status_message,
    tombstoneLoggingEnabled: !!user.tombstone_logging_enabled,
    notificationsEnabled: !!user.notifications_enabled,
  });
});
