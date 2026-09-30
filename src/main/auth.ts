import { OAuth2Client } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl"
];

export function buildAuthUrl(clientId: string, redirectUri: string): string {
  const c = new OAuth2Client(clientId, undefined, redirectUri);
  return c.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
}

export class AuthStore {
  private oauth: OAuth2Client | null = null;
  private tokens: { refresh_token?: string; access_token?: string; expiry_date?: number } = {};

  configure(clientId: string, clientSecret: string, redirectUri: string): void {
    this.oauth = new OAuth2Client(clientId, clientSecret, redirectUri);
    if (this.tokens.refresh_token) this.oauth.setCredentials(this.tokens);
  }
  restore(tokens: { refresh_token?: string; access_token?: string; expiry_date?: number }): void {
    this.tokens = tokens;
    if (this.oauth) this.oauth.setCredentials(tokens);
  }
  snapshot(): { refresh_token?: string; access_token?: string; expiry_date?: number } {
    return { ...this.tokens };
  }
  isSignedIn(): boolean {
    return Boolean(this.tokens.refresh_token);
  }
  loginUrl(redirectUri: string, clientId: string): string {
    return buildAuthUrl(clientId, redirectUri);
  }
  async finishLogin(code: string): Promise<void> {
    if (!this.oauth) throw new Error("auth-not-configured");
    const { tokens } = await this.oauth.getToken(code);
    // NOTE: persist tokens.encrypted via safeStorage in electron/main wiring (Task 8), never plain.
    this.tokens = {
      refresh_token: tokens.refresh_token ?? undefined,
      access_token: tokens.access_token ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined
    };
    this.oauth.setCredentials(tokens);
  }
  async getAccessToken(): Promise<string> {
    if (!this.oauth) throw new Error("auth-not-configured");
    if (!this.tokens.refresh_token) throw new Error("sign-in-required");
    const { token } = await this.oauth.getAccessToken();
    if (!token) throw new Error("token-refresh-failed");
    return token;
  }
}
