import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildTikTokAuthUrl,
  buildCaption,
  chunkPlan,
  codeChallengeOf,
  createCodeVerifier,
  TIKTOK_SCOPES,
  TikTokAuthStore,
  TikTokUploader
} from "../../src/main/tiktok";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("tiktok pkce + auth url", () => {
  it("derives a hex sha256 challenge", () => {
    const v = createCodeVerifier();
    expect(v.length).toBe(64);
    expect(codeChallengeOf("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
  });
  it("builds a desktop authorize url with scopes and S256", () => {
    const url = buildTikTokAuthUrl({
      clientKey: "key123",
      redirectUri: "http://127.0.0.1:53683/callback",
      state: "s1",
      challenge: "c1"
    });
    expect(url).toContain("tiktok.com/v2/auth/authorize");
    expect(url).toContain("client_key=key123");
    expect(url).toContain("code_challenge_method=S256");
    for (const scope of TIKTOK_SCOPES) expect(url).toContain(encodeURIComponent(scope).slice(0, 8));
  });
});

describe("TikTokAuthStore", () => {
  it("exchanges a code for tokens and reports linked", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ access_token: "act", refresh_token: "rft", expires_in: 3600 }));
    const auth = new TikTokAuthStore(fetchFn as unknown as typeof fetch);
    auth.configure("k", "s", "http://127.0.0.1:53683/callback");
    expect(auth.isLinked()).toBe(false);
    const { state } = auth.beginLogin();
    await auth.finishLogin("code123", state);
    expect(auth.isLinked()).toBe(true);
    expect(auth.snapshot().refresh_token).toBe("rft");
    // posts form-urlencoded to the token endpoint
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v2/oauth/token/");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init.body)).toContain("grant_type=authorization_code");
  });
  it("rejects a mismatched state", async () => {
    const auth = new TikTokAuthStore((async () => jsonResponse({})) as unknown as typeof fetch);
    auth.configure("k", "s", "http://x/cb");
    auth.beginLogin();
    await expect(auth.finishLogin("code", "wrong")).rejects.toThrow("tiktok-bad-state");
  });
  it("refreshes an expired access token and rotates the refresh token", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ access_token: "act2", refresh_token: "rft2", expires_in: 3600 })
    );
    const auth = new TikTokAuthStore(fetchFn as unknown as typeof fetch);
    auth.configure("k", "s", "http://x/cb");
    auth.restore({ refresh_token: "rft1", expires_at: Date.now() - 1000 });
    const token = await auth.getAccessToken();
    expect(token).toBe("act2");
    expect(auth.snapshot().refresh_token).toBe("rft2");
    expect(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body)).toContain("grant_type=refresh_token");
  });
  it("reuses a valid cached access token without network", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));
    const auth = new TikTokAuthStore(fetchFn as unknown as typeof fetch);
    auth.restore({ access_token: "cached", refresh_token: "r", expires_at: Date.now() + 3600_000 });
    await expect(auth.getAccessToken()).resolves.toBe("cached");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("chunkPlan", () => {
  it("uploads small files in one chunk", () => {
    expect(chunkPlan(1024)).toEqual({ chunkSize: 1024, totalChunks: 1 });
    expect(chunkPlan(5 * 1024 * 1024)).toEqual({ chunkSize: 5 * 1024 * 1024, totalChunks: 1 });
  });
  it("splits large files and forces multi-chunk above 64MB", () => {
    const p = chunkPlan(100 * 1024 * 1024);
    expect(p.totalChunks).toBeGreaterThan(1);
    expect(p.chunkSize * p.totalChunks).toBeGreaterThanOrEqual(100 * 1024 * 1024);
  });
  it("caps at 1000 chunks for huge files", () => {
    const total = 20 * 1024 * 1024 * 1024;
    const p = chunkPlan(total);
    expect(p.totalChunks).toBeLessThanOrEqual(1000);
  });
});

describe("buildCaption", () => {
  it("appends tags as hashtags within the limit", () => {
    expect(buildCaption("مرحبا", ["قصص", "كتب"])).toBe("مرحبا #قصص #كتب");
    expect(buildCaption("x".repeat(3000), [])).toHaveLength(2200);
  });
});

describe("TikTokUploader", () => {
  const ok = (data: unknown) => ({ data, error: { code: "ok", message: "", log_id: "1" } });
  function happyFetch() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("creator_info/query")) {
        return jsonResponse(ok({ creator_username: "me", privacy_level_options: ["SELF_ONLY"] }));
      }
      if (url.includes("video/init")) {
        return jsonResponse(ok({ publish_id: "pub1", upload_url: "https://upload.example/up" }));
      }
      if (url.includes("upload.example")) {
        return new Response("", { status: 201 });
      }
      if (url.includes("status/fetch")) {
        return jsonResponse(ok({ status: "PUBLISH_COMPLETE" }));
      }
      throw new Error(`unexpected ${url}`);
    };
    return { fetchFn, calls };
  }
  it("runs creator preflight, init, chunk PUT and status poll", async () => {
    const { fetchFn, calls } = happyFetch();
    const file = Buffer.alloc(2048, 7);
    const up = new TikTokUploader(
      async () => "tok",
      fetchFn as unknown as typeof fetch,
      () => file,
      async () => undefined
    );
    const res = await up.upload("/v.mp4", { title: "t", tags: ["a"], privacyLevel: "SELF_ONLY" });
    expect(res.publishId).toBe("pub1");
    const put = calls.find((c) => c.url.includes("upload.example"));
    expect(put?.init?.headers).toMatchObject({
      "Content-Type": "video/mp4",
      "Content-Range": "bytes 0-2047/2048"
    });
  });
  it("refuses a privacy level the creator cannot use", async () => {
    const { fetchFn } = happyFetch();
    const up = new TikTokUploader(
      async () => "tok",
      fetchFn as unknown as typeof fetch,
      () => Buffer.alloc(8),
      async () => undefined
    );
    await expect(up.upload("/v.mp4", { title: "t", tags: [], privacyLevel: "PUBLIC_TO_EVERYONE" })).rejects.toThrow(
      "tiktok-privacy-not-allowed"
    );
  });
  it("surfaces publish fail reasons", async () => {
    const base = happyFetch();
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url.includes("status/fetch")) {
        return jsonResponse({ data: { status: "FAILED", fail_reason: "spam_risk" }, error: { code: "ok", message: "", log_id: "1" } });
      }
      return base.fetchFn(url, init);
    };
    const up = new TikTokUploader(
      async () => "tok",
      fetchFn as unknown as typeof fetch,
      () => Buffer.alloc(8),
      async () => undefined
    );
    await expect(up.upload("/v.mp4", { title: "t", tags: [], privacyLevel: "SELF_ONLY" })).rejects.toThrow("spam_risk");
  });
});
