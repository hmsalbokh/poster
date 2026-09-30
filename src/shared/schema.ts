import { z } from "zod";

export const targetSchema = z.enum(["youtube", "tiktok"]);

export const tiktokPrivacySchema = z.enum([
  "SELF_ONLY",
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR"
]);

export const sidecarSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(5000).default(""),
  tags: z.array(z.string().max(30)).max(30).default([]),
  publishAt: z.string().datetime({ offset: true }),
  madeForKids: z.boolean().default(false),
  language: z.enum(["ar", "en"]).default("ar"),
  categoryId: z.string().default("22"),
  targets: z.array(targetSchema).min(1).default(["youtube"]),
  tiktokPrivacy: tiktokPrivacySchema.default("SELF_ONLY")
});

export type Sidecar = z.infer<typeof sidecarSchema>;

export function parseSidecar(json: unknown): Sidecar {
  return sidecarSchema.parse(json);
}
