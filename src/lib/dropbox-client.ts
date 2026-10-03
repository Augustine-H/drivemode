import { parseGrokbotBackup, type GrokbotBackup } from "./grokbot-backup.ts";

export const DROPBOX_APP_KEY = "93d0wi1ioc4gkab";
export const DROPBOX_ROOT = "/Grok/grokbot";
const GRANT_KEY = "voice-grok-dropbox-grant";
const FLOW_KEY = "voice-grok-dropbox-flow";
type Grant = { access_token: string; refresh_token: string; expires_at: number };
type Flow = { state: string; verifier: string; redirect: string; started: number };
type Entry = { ".tag": string; path_lower?: string; name: string; rev?: string; size?: number };
type Page = { entries: Entry[]; has_more: boolean; cursor: string };
export type DropboxBatch = { backups: GrokbotBackup[]; errors: string[] };

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class DropboxClient {
  private storage: Storage;
  private session: Storage;
  private request: typeof fetch;
  private refreshing: Promise<string> | null = null;
  private finishing: Promise<boolean> | null = null;
  private generation = 0;
  constructor(storage: Storage, session: Storage, request: typeof fetch = fetch) {
    this.storage = storage;
    this.session = session;
    this.request = request.bind(globalThis);
  }
  connected() {
    return !!this.storage.getItem(GRANT_KEY);
  }
  private grant(): Grant | null {
    try {
      return JSON.parse(this.storage.getItem(GRANT_KEY) ?? "null");
    } catch {
      return null;
    }
  }
  async authorizationUrl(redirect: string) {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    );
    this.session.setItem(
      FLOW_KEY,
      JSON.stringify({ state, verifier, redirect, started: Date.now() }),
    );
    const query = new URLSearchParams({
      client_id: DROPBOX_APP_KEY,
      response_type: "code",
      redirect_uri: redirect,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      token_access_type: "offline",
      scope: "files.metadata.read files.content.read",
    });
    return `https://www.dropbox.com/oauth2/authorize?${query}`;
  }
  async finishAuthorization(url: string) {
    if (this.finishing) return this.finishing;
    this.finishing = this.finish(url).finally(() => {
      this.finishing = null;
    });
    return this.finishing;
  }
  private async finish(url: string) {
    const query = new URL(url).searchParams;
    if (!query.has("code") && !query.has("error")) return false;
    const flow: Flow | null = JSON.parse(this.session.getItem(FLOW_KEY) ?? "null");
    if (!flow || query.get("state") !== flow.state || Date.now() - flow.started > 600_000)
      throw new Error("Dropbox 연결 확인이 만료됐습니다. 다시 연결하세요.");
    this.session.removeItem(FLOW_KEY);
    if (query.has("error")) throw new Error("Dropbox 연결이 취소됐습니다.");
    const generation = this.generation;
    const response = await this.request("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: query.get("code")!,
        client_id: DROPBOX_APP_KEY,
        code_verifier: flow.verifier,
        redirect_uri: flow.redirect,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error("Dropbox 연결을 완료하지 못했습니다. 앱 권한과 접속 주소 등록을 확인하세요.");
    const token = await response.json();
    if (!token.access_token || !token.refresh_token || !Number.isFinite(token.expires_in))
      throw new Error("Dropbox 연결 정보가 올바르지 않습니다.");
    if (generation !== this.generation) throw new Error("Dropbox 연결이 해제됐습니다.");
    this.storage.setItem(
      GRANT_KEY,
      JSON.stringify({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: Date.now() + token.expires_in * 1000,
      }),
    );
    return true;
  }
  async disconnect() {
    this.generation++;
    const grant = this.grant();
    this.storage.removeItem(GRANT_KEY);
    this.session.removeItem(FLOW_KEY);
    if (grant?.access_token) {
      try {
        const token =
          grant.expires_at > Date.now() ? grant.access_token : await this.refresh(grant, false);
        await this.request("https://api.dropboxapi.com/2/auth/token/revoke", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        /* local disconnect is complete; Dropbox settings can revoke remaining permission */
      }
    }
  }
  private async refresh(grant: Grant, persist = true) {
    const generation = this.generation;
    const response = await this.request("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: grant.refresh_token,
        client_id: DROPBOX_APP_KEY,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Dropbox 연결이 만료됐습니다. 다시 연결하세요.");
    const token = await response.json();
    if (!token.access_token || !Number.isFinite(token.expires_in))
      throw new Error("Dropbox 연결을 갱신하지 못했습니다.");
    if (persist) {
      if (generation !== this.generation) throw new Error("Dropbox 연결이 해제됐습니다.");
      this.storage.setItem(
        GRANT_KEY,
        JSON.stringify({
          ...grant,
          access_token: token.access_token,
          expires_at: Date.now() + token.expires_in * 1000,
        }),
      );
    }
    return token.access_token as string;
  }
  private async accessToken() {
    const grant = this.grant();
    if (!grant) throw new Error("먼저 Dropbox를 연결하세요.");
    if (grant.expires_at > Date.now() + 60_000) return grant.access_token;
    if (!this.refreshing)
      this.refreshing = this.refresh(grant).finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
  private async api(endpoint: string, body: unknown) {
    const token = await this.accessToken();
    const response = await this.request(`https://api.dropboxapi.com/2/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Dropbox 연결이 만료됐습니다. 다시 연결하세요."
          : response.status === 429
            ? "Dropbox 요청이 많습니다. 잠시 후 다시 확인하세요."
            : "Dropbox 폴더를 읽지 못했습니다. 경로와 읽기 권한을 확인하세요.",
      );
    return response.json();
  }
  async backups(root: string): Promise<DropboxBatch> {
    const normalized = root.trim().replace(/\/+$/, "").normalize("NFC");
    if (/\.(?:json|md)$/i.test(normalized))
      throw new Error("파일 경로가 아닌 백업 폴더를 입력하세요. 예: /Grok/grokbot");
    if (
      !normalized.startsWith("/") ||
      normalized.includes("\\") ||
      normalized.split("/").includes("..")
    )
      throw new Error("백업 폴더 경로를 /로 시작해서 입력하세요.");
    const entries: Entry[] = [];
    let page: Page = await this.api("files/list_folder", {
      path: normalized,
      recursive: true,
      include_deleted: false,
      limit: 1000,
    });
    let pages = 0;
    while (true) {
      entries.push(...page.entries);
      if (++pages > 20 || entries.length > 10000)
        throw new Error("백업 폴더가 너무 큽니다. 봇 백업 전용 폴더를 선택하세요.");
      if (!page.has_more) break;
      page = await this.api("files/list_folder/continue", { cursor: page.cursor });
    }
    const files = entries
      .filter((entry) => entry[".tag"] === "file" && entry.name.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (files.length > 250)
      throw new Error("한 번에 JSON 파일 250개까지 지원합니다. 백업 폴더를 나누세요.");
    const result: DropboxBatch = { backups: [], errors: [] };
    const seen = new Set<string>();
    for (const file of files) {
      try {
        if (!file.path_lower || !file.path_lower.startsWith(`${normalized.toLowerCase()}/`))
          throw new Error("폴더 밖의 파일입니다.");
        if ((file.size ?? 0) > 10 * 1024 * 1024) throw new Error("파일이 10MB를 넘습니다.");
        const token = await this.accessToken();
        const arg = JSON.stringify({ path: file.path_lower }).replace(
          /[\u007f-\uffff]/g,
          (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
        );
        const response = await this.request("https://content.dropboxapi.com/2/files/download", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": arg },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error("파일 다운로드에 실패했습니다.");
        const text = await response.text();
        if (new TextEncoder().encode(text).length > 10 * 1024 * 1024)
          throw new Error("파일이 10MB를 넘습니다.");
        const backup = parseGrokbotBackup(JSON.parse(text));
        if (!backup) throw new Error("지원하는 봇 JSON 형식이 아닙니다.");
        const parent = file.path_lower.split("/").at(-2);
        if (parent !== backup.bot.toLowerCase()) throw new Error("폴더 이름과 봇 이름이 다릅니다.");
        if (seen.has(backup.source)) {
          result.backups = result.backups.filter((item) => item.source !== backup.source);
          throw new Error("같은 봇·날짜의 파일이 여러 개 있습니다.");
        }
        seen.add(backup.source);
        result.backups.push(backup);
      } catch (error) {
        result.errors.push(
          `${file.name}: ${error instanceof Error ? error.message : "가져오기 실패"}`,
        );
      }
    }
    return result;
  }
}

let client: DropboxClient | null = null;
export function getDropboxClient() {
  return (client ??= new DropboxClient(localStorage, sessionStorage));
}
