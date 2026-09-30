import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com";
export const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"];

export const TIKTOK_PRIVACY_SELF = "SELF_ONLY";

export type FetchFn = typeof fetch;

const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function createCodeVerifier(length = 64): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += VERIFIER_ALPHABET[b % VERIFIER_ALPHABET.length];
  return out;
}

/** TikTok desktop Login Kit expects a hex-encoded SHA256 challenge. */
export function codeChallengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("hex");
}

export function buildTikTokAuthUrl(args: {
  clientKey: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const q = new URLSearchParams({
    client_key: args.clientKey,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: "S256"
  });
  return `${TIKTOK_AUTHORIZE_URL}?${q.toString()}`;
}

export interface TikTokTokens {
  access_token?: string;
  refresh_token?: string;
  /** epoch ms when the access token expires */
  expires_at?: number;
  open_id?: string;
  scope?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function postForm(fetchFn: FetchFn, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchFn(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(`tiktok-token-failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json;
}

export class TikTokAuthStore {
  private clientKey = "";
  private clientSecret = "";
  private redirectUri = "";
  private tokens: TikTokTokens = {};
  private pending: { state: string; verifier: string } | null = null;

  constructor(private fetchFn: FetchFn = fetch) {}

  configure(clientKey: string, clientSecret: string, redirectUri: string): void {
    this.clientKey = clientKey;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  restore(tokens: TikTokTokens): void {
    this.tokens = { ...tokens };
  }

  snapshot(): TikTokTokens {
    return { ...this.tokens };
  }

  isLinked(): boolean {
    return Boolean(this.tokens.refresh_token);
  }

  beginLogin(): { url: string; state: string } {
    if (!this.clientKey) throw new Error("tiktok-not-configured");
    const verifier = createCodeVerifier();
    const state = randomBytes(16).toString("hex");
    this.pending = { state, verifier };
    const url = buildTikTokAuthUrl({
      clientKey: this.clientKey,
      redirectUri: this.redirectUri,
      state,
      challenge: codeChallengeOf(verifier)
    });
    return { url, state };
  }

  async finishLogin(code: string, state: string): Promise<void> {
    if (!this.pending || this.pending.state !== state) throw new Error("tiktok-bad-state");
    const { verifier } = this.pending;
    this.pending = null;
    const json = await postForm(this.fetchFn, {
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      code: decodeURIComponent(code),
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
      code_verifier: verifier
    });
    this.tokens = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + (json.expires_in ?? 86400) * 1000,
      open_id: json.open_id,
      scope: json.scope
    };
  }

  async refreshNow(): Promise<void> {
    if (!this.tokens.refresh_token) throw new Error("tiktok-sign-in-required");
    const json = await postForm(this.fetchFn, {
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.tokens.refresh_token
    });
    this.tokens = {
      access_token: json.access_token,
      // The rotated refresh token must replace the old one.
      refresh_token: json.refresh_token ?? this.tokens.refresh_token,
      expires_at: Date.now() + (json.expires_in ?? 86400) * 1000,
      open_id: json.open_id ?? this.tokens.open_id,
      scope: json.scope ?? this.tokens.scope
    };
  }

  async getAccessToken(): Promise<string> {
    if (this.tokens.access_token && this.tokens.expires_at && this.tokens.expires_at - Date.now() > 60_000) {
      return this.tokens.access_token;
    }
    await this.refreshNow();
    if (!this.tokens.access_token) throw new Error("tiktok-token-refresh-failed");
    return this.tokens.access_token;
  }
}

interface ApiEnvelope<T> {
  data: T;
  error: { code: string; message: string; log_id: string };
}

async function postApi<T>(fetchFn: FetchFn, token: string, path: string, body: unknown): Promise<T> {
  const res = await fetchFn(`${TIKTOK_API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body)
  });
  const json = (await res.json()) as ApiEnvelope<T>;
  if (json.error?.code !== "ok") {
    throw new Error(`tiktok-api-failed: ${path} ${json.error?.code ?? res.status} ${json.error?.message ?? ""}`.trim());
  }
  return json.data;
}

export interface ChunkPlan {
  chunkSize: number;
  totalChunks: number;
}

const MB = 1024 * 1024;

export function chunkPlan(totalBytes: number): ChunkPlan {
  if (totalBytes <= 5 * MB) return { chunkSize: totalBytes, totalChunks: 1 };
  let chunkSize = 10 * MB;
  let totalChunks = Math.ceil(totalBytes / chunkSize);
  if (totalChunks > 1000) {
    chunkSize = Math.ceil(totalBytes / 1000);
    totalChunks = Math.ceil(totalBytes / chunkSize);
  }
  if (totalBytes > 64 * MB && totalChunks < 2) {
    chunkSize = Math.ceil(totalBytes / 2);
    totalChunks = 2;
  }
  return { chunkSize, totalChunks };
}

export function buildCaption(title: string, tags: string[]): string {
  const hashTags = tags
    .map((tag) => tag.replace(/\s+/g, ""))
    .filter((tag) => tag.length > 0)
    .map((tag) => `#${tag}`)
    .join(" ");
  const full = hashTags ? `${title} ${hashTags}` : title;
  // TikTok caption limit: 2200 UTF-16 units.
  return full.slice(0, 2200);
}

export interface TikTokUploadMeta {
  title: string;
  tags: string[];
  privacyLevel: string;
}

export class TikTokUploader {
  readonly name = "tiktok";
  constructor(
    private getToken: () => Promise<string>,
    private fetchFn: FetchFn = fetch,
    private readFile: (path: string) => Buffer = (p) => readFileSync(p),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  async upload(filePath: string, meta: TikTokUploadMeta): Promise<{ publishId: string }> {
    const token = await this.getToken();
    // 1. Preflight: verify the requested privacy level is allowed for this creator.
    const creator = await postApi<{
      creator_username: string;
      privacy_level_options: string[];
    }>(this.fetchFn, token, "/v2/post/publish/creator_info/query/", {});
    if (!creator.privacy_level_options.includes(meta.privacyLevel)) {
      throw new Error(`tiktok-privacy-not-allowed: ${meta.privacyLevel}`);
    }
    // 2. Init direct post.
    const file = this.readFile(filePath);
    const plan = chunkPlan(file.byteLength);
    const init = await postApi<{ publish_id: string; upload_url: string }>(
      this.fetchFn,
      token,
      "/v2/post/publish/video/init/",
      {
        post_info: { title: buildCaption(meta.title, meta.tags), privacy_level: meta.privacyLevel },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: file.byteLength,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunks
        }
      }
    );
    // 3. Upload chunks sequentially.
    for (let i = 0; i < plan.totalChunks; i++) {
      const first = i * plan.chunkSize;
      const last = Math.min(first + plan.chunkSize, file.byteLength) - 1;
      const chunk = file.subarray(first, last + 1);
      const res = await this.fetchFn(init.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${first}-${last}/${file.byteLength}`
        },
        body: chunk as unknown as BodyInit
      });
      if (res.status !== 201 && res.status !== 206) {
        throw new Error(`tiktok-upload-chunk-failed: http ${res.status}`);
      }
    }
    // 4. Poll until published.
    for (let attempt = 0; attempt < 24; attempt++) {
      const status = await postApi<{
        status: string;
        fail_reason?: string;
      }>(this.fetchFn, token, "/v2/post/publish/status/fetch/", { publish_id: init.publish_id });
      if (status.status === "PUBLISH_COMPLETE") return { publishId: init.publish_id };
      if (status.status !== "PROCESSING_UPLOAD" && status.status !== "PROCESSING_DOWNLOAD") {
        throw new Error(`tiktok-publish-failed: ${status.status} ${status.fail_reason ?? ""}`.trim());
      }
      await this.sleep(5000);
    }
    throw new Error("tiktok-publish-timeout");
  }
}
