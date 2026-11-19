import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 4000;

export const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(5).optional(),
  password: z.string().min(8),
  displayName: z.string().trim().min(1).max(80),
}).refine((v) => v.email || v.phone, { message: "email or phone is required" });

export const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(5).optional(),
  password: z.string().min(1),
}).refine((v) => v.email || v.phone, { message: "email or phone is required" });

export const createChatSchema = z.object({
  kind: z.enum(["direct", "group"]),
  title: z.string().trim().max(80).optional(),
  participantIds: z.array(z.string()).min(1).max(100),
});

const messageText = z.string().trim().min(1, "Message can't be empty").max(MAX_MESSAGE_LENGTH);

export const sendMessageSchema = z.object({
  text: messageText,
  replyToMessageId: z.string().optional(),
});

export const editMessageSchema = z.object({ text: messageText });

/** A single emoji (possibly several code points, like 👍🏽 or a flag). */
export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16).refine((s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s), "Not an emoji"),
});

export const startBreakoutSchema = z.object({
  participantIds: z.array(z.string()).min(1),
});

export const updateChatSchema = z.object({
  title: z.string().trim().max(80).nullable(),
});

export const addParticipantsSchema = z.object({
  userIds: z.array(z.string()).min(1).max(100),
});

export const markReadSchema = z.object({
  /** Read up to this message's timestamp. Defaults to "everything so far". */
  upToMessageId: z.string().optional(),
});

export const keepResponseSchema = z.object({ allow: z.boolean() });
