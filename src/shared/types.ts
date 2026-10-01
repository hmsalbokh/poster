export function appName(): string {
  return "poster";
}

export type VideoStatus = "pending" | "uploading" | "scheduled" | "uploaded" | "published" | "failed" | "needs-metadata";

export interface VideoRow {
  id: string;
  file_path: string;
  title: string;
  description: string;
  tags: string;
  publishAt: string | null;
  lang: string;
  status: VideoStatus;
  youtube_video_id: string | null;
  tiktok_publish_id: string | null;
  targets: string;
  tiktok_privacy: string | null;
  error: string | null;
  attempts: number;
}
