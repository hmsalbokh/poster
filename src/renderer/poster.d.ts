import type { VideoRow, VideoStatus } from "../shared/types";

export interface QueueVideo extends VideoRow {}

export interface LogEvent {
  id: number;
  video_id: string | null;
  level: string;
  message: string;
  at: string;
}

export interface PosterApi {
  listVideos(): Promise<QueueVideo[]>;
  retryVideo(id: string): Promise<void>;
  listEvents(): Promise<LogEvent[]>;
  getWatchDir(): Promise<string>;
  openFolder(): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  authStatus(): Promise<{ signedIn: boolean }>;
  getClient(): Promise<{ clientId: string; hasSecret: boolean; linked: boolean }>;
  tiktokAuthStatus(): Promise<{ linked: boolean }>;
  getTikTokClient(): Promise<{ clientKey: string; hasSecret: boolean; linked: boolean }>;
  saveTikTokClient(clientKey: string, clientSecret: string): Promise<void>;
  beginTikTokLogin(): Promise<string>;
  saveClient(clientId: string, clientSecret: string): Promise<void>;
  beginLogin(): Promise<string>;
  quotaStatus(): Promise<{ left: number; usedUnits: number }>;
}

declare global {
  interface Window {
    poster: PosterApi;
  }
  // Re-export for screens that import the type only.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type Status = VideoStatus;
}

export {};
