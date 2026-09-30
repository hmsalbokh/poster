import { google } from "googleapis";
import { createReadStream } from "node:fs";
import type { UploaderPlugin, UploadMeta } from "./types";

export interface InsertBody {
  snippet: { title: string; description: string; tags: string[]; categoryId: string; defaultLanguage: string };
  status: {
    privacyStatus: "private";
    publishAt: string;
    madeForKids: boolean;
    selfDeclaredMadeForKids: boolean;
  };
}

export function buildInsertBody(meta: {
  title: string;
  description: string;
  tags: string[];
  publishAt: string;
  madeForKids?: boolean;
  language?: string;
  categoryId?: string;
}): InsertBody {
  return {
    snippet: {
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      categoryId: meta.categoryId ?? "22",
      defaultLanguage: meta.language ?? "ar"
    },
    status: {
      privacyStatus: "private",
      publishAt: meta.publishAt,
      madeForKids: meta.madeForKids ?? false,
      selfDeclaredMadeForKids: meta.madeForKids ?? false
    }
  };
}

export function quotaErrorOf(err: unknown): boolean {
  const e = err as { code?: number; errors?: Array<{ reason?: string }> };
  return (
    e?.code === 403 && (e.errors ?? []).some((x) => x.reason === "quotaExceeded" || x.reason === "dailyLimitExceeded")
  );
}

export class YouTubeUploader implements UploaderPlugin {
  readonly name = "youtube";
  constructor(private getToken: () => Promise<string>) {}
  async upload(filePath: string, meta: UploadMeta): Promise<{ videoId: string }> {
    const token = await this.getToken();
    const youtube = google.youtube({ version: "v3", headers: { Authorization: `Bearer ${token}` } });
    const body = buildInsertBody(meta);
    const res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: body,
      media: { body: createReadStream(filePath) }
    });
    const id = res.data.id;
    if (!id) throw new Error("upload-no-video-id");
    return { videoId: id };
  }
}
