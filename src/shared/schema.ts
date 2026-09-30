import { z } from "zod";

export const sidecarSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(5000).default(""),
  tags: z.array(z.string().max(30)).max(30).default([]),
  publishAt: z.string().datetime({ offset: true }),
  madeForKids: z.boolean().default(false),
  language: z.enum(["ar", "en"]).default("ar"),
  categoryId: z.string().default("22")
});

export type Sidecar = z.infer<typeof sidecarSchema>;

export function parseSidecar(json: unknown): Sidecar {
  return sidecarSchema.parse(json);
}
