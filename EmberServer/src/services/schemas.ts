import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(5).optional(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(80),
}).refine((v) => v.email || v.phone, { message: "email or phone is required" });

export const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(5).optional(),
  password: z.string().min(1),
}).refine((v) => v.email || v.phone, { message: "email or phone is required" });

export const createChatSchema = z.object({
  kind: z.enum(["direct", "group"]),
  title: z.string().optional(),
  participantIds: z.array(z.string()).min(1),
});

export const sendMessageSchema = z.object({
  text: z.string().min(1).max(4000).optional(),
  replyToMessageId: z.string().optional(),
}).refine((v) => !!v.text, { message: "text is required (attachments not yet wired)" });

export const startBreakoutSchema = z.object({
  participantIds: z.array(z.string()).min(1),
});
