import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nasAccess } from './nas-access.ts';

export const WORKSPACE_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
} as const;
type Session = { accessToken?: string; refreshToken?: string; expiresAt?: number; scopes?: string[]; pending?: { state: string; verifier: string; expires: number } };
type Config = { clientId: string; clientSecret: string; origin: string; directory: string };
class WorkspaceError extends Error {
  code:string; status:number;
  constructor(code: string, status = 400) { super(code); this.code=code;this.status=status; }
}
const messages: Record<string,string> = {
  nas_only: 'NAS 앱과 Tailscale 계정으로 접속하세요.', origin: '앱 주소를 확인하세요.', setup: '앱 전용 Google OAuth 설정이 필요합니다.',
  disconnected: 'Google 계정을 연결하세요.', consent: '선택한 서비스의 읽기 권한을 승인하세요.', expired: 'Google 연결이 만료되었습니다. 다시 연결하세요.',
  state: '연결 요청이 만료되었거나 이미 사용되었습니다. 다시 연결하세요.', upstream: 'Google 요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.',
  disabled: 'Google Cloud에서 해당 서비스 API를 사용 설정하세요.', unsupported: '이 파일은 앱에서 텍스트로 미리 볼 수 없습니다.', size: '미리보기는 1MB 이하의 텍스트만 지원합니다.',
};
const json = (value: unknown, status = 200) => Response.json(value, {status, headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});

export class WorkspaceStore {
  private directory:string;
  constructor(directory: string) {this.directory=directory;}
  private async key() {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const path = join(this.directory,'key');
    try { await writeFile(path,randomBytes(32),{flag:'wx',mode:0o600}); } catch (e) { if((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const key = await readFile(path); if(key.length !== 32) throw new Error('invalid_store'); return key;
  }
  async read(): Promise<Session> {
    let data: Buffer;
    try { data = await readFile(join(this.directory,'oauth.enc')); } catch(e) { if((e as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw e; }
    const decrypt = createDecipheriv('aes-256-gcm',await this.key(),data.subarray(0,12));
    decrypt.setAAD(Buffer.from('voice-grok-google-v1')); decrypt.setAuthTag(data.subarray(12,28));
    return JSON.parse(Buffer.concat([decrypt.update(data.subarray(28)),decrypt.final()]).toString());
  }
  async write(value: Session) {
    const key = await this.key(), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(Buffer.from('voice-grok-google-v1'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    const tmp = join(this.directory,`oauth-${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(tmp,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{mode:0o600});
    await rename(tmp,join(this.directory,'oauth.enc'));
  }
}

export class GoogleWorkspace {
  private config:Config; private store:Pick<WorkspaceStore,'read'|'write'>; private request:typeof fetch;
  constructor(config: Config, store: Pick<WorkspaceStore,'read'|'write'>, request: typeof fetch = fetch) {this.config=config;this.store=store;this.request=request;}
  private redirectUri() { return new URL('/api/google-workspace/callback',this.config.origin).href; }
  async status() {
    const session = await this.store.read();
    return { configured:!!this.config.clientId && !!this.config.clientSecret, connected:!!session.refreshToken, expiresAt:session.expiresAt ?? null,
      services:Object.fromEntries(Object.entries(WORKSPACE_SCOPES).map(([name,scope])=>[name,(session.scopes ?? []).includes(scope)])) };
  }
  async connect() {
    if(!this.config.clientId || !this.config.clientSecret) throw new WorkspaceError('setup',503);
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const session = await this.store.read(); session.pending={state,verifier,expires:Date.now()+600000}; await this.store.write(session);
    const query = new URLSearchParams({client_id:this.config.clientId,redirect_uri:this.redirectUri(),response_type:'code',access_type:'offline',prompt:'consent',
      scope:Object.values(WORKSPACE_SCOPES).join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return {url:`https://accounts.google.com/o/oauth2/v2/auth?${query}`};
  }
  async callback(code: string, state: string, denied = false) {
    const session = await this.store.read(), pending = session.pending;
    if(!pending || pending.expires < Date.now() || Buffer.byteLength(state) !== Buffer.byteLength(pending.state) || !timingSafeEqual(Buffer.from(state),Buffer.from(pending.state))) throw new WorkspaceError('state');
    delete session.pending; await this.store.write(session);
    if(denied) return;
    if(!code || code.length > 4096) throw new WorkspaceError('state');
    const tokens = await this.token({grant_type:'authorization_code',code,redirect_uri:this.redirectUri(),code_verifier:pending.verifier});
    // Do not retain an earlier account's refresh token after switching accounts.
    if(!tokens.refresh_token || typeof tokens.scope !== 'string') throw new WorkspaceError('expired',401);
    await this.store.write({accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt:Date.now()+tokens.expires_in*1000,scopes:tokens.scope.split(' ')});
  }
  private async token(parameters: Record<string,string>) {
    const response = await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({...parameters,client_id:this.config.clientId,client_secret:this.config.clientSecret}),signal:AbortSignal.timeout(15000),redirect:'error'});
    const data = await response.json();
    if(!response.ok) throw new WorkspaceError(data.error === 'invalid_grant' ? 'expired':'upstream',data.error === 'invalid_grant' ? 401:502);
    if(typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) throw new WorkspaceError('upstream',502);
    return data as {access_token:string;refresh_token?:string;expires_in:number;scope:string};
  }
  private refresh: Promise<Session> | null = null;
  private async access(service: keyof typeof WORKSPACE_SCOPES) {
    let session = await this.store.read();
    if(!session.refreshToken) throw new WorkspaceError('disconnected',401);
    if(!session.scopes?.includes(WORKSPACE_SCOPES[service])) throw new WorkspaceError('consent',403);
    if(!session.accessToken || (session.expiresAt ?? 0) < Date.now()+60000) {
      if(!this.refresh) this.refresh=(async()=> {
        const saved = await this.store.read();
        try {
          const data = await this.token({grant_type:'refresh_token',refresh_token:saved.refreshToken!});
          const updated = {...saved,accessToken:data.access_token,expiresAt:Date.now()+data.expires_in*1000,scopes:data.scope?.split(' ') ?? saved.scopes};
          await this.store.write(updated); return updated;
        } catch(e) { if(e instanceof WorkspaceError && e.code === 'expired') await this.store.write({}); throw e; }
      })().finally(()=>{this.refresh=null;});
      session = await this.refresh;
      if(!session.scopes?.includes(WORKSPACE_SCOPES[service])) throw new WorkspaceError('consent',403);
    }
    return session.accessToken!;
  }
  private async get(service: keyof typeof WORKSPACE_SCOPES, url: string) {
    const token = await this.access(service);
    const response = await this.request(url,{method:'GET',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok) {
      const error = await response.json().catch(()=>({}));
      const reason = error.error?.details?.find((d:{reason?:string})=>d.reason)?.reason;
      if(response.status === 401) { await this.store.write({}); throw new WorkspaceError('expired',401); }
      throw new WorkspaceError(reason === 'SERVICE_DISABLED' ? 'disabled' : response.status === 403 ? 'consent':'upstream',response.status === 403 ? 403:502);
    }
    return response;
  }
  async calendars() { return (await this.get('calendar','https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100&fields=items(id,summary,primary)')).json(); }
  async verify() {
    const results=[];
    for(const [service,url] of [
      ['calendar','https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1&fields=items(id)'],
      ['drive','https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)'],
      ['gmail','https://gmail.googleapis.com/gmail/v1/users/me/labels?fields=labels(id)'],
    ] as const) {
      try {const response=await this.get(service,url);await response.body?.cancel();results.push({service,ok:true});}
      catch(error){results.push({service,ok:false,error:error instanceof WorkspaceError?messages[error.code]:messages.upstream});}
    }
    return {results,checkedAt:new Date().toISOString()};
  }
  async events(calendarId: string, query: string, page: string) {
    const now = new Date(), end = new Date(now.getTime()+30*86400000);
    const params = new URLSearchParams({timeMin:now.toISOString(),timeMax:end.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'30',fields:'items(id,summary,start,end,location,description),nextPageToken'});
    if(query) params.set('q',query); if(page) params.set('pageToken',page);
    return (await this.get('calendar',`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params}`)).json();
  }
  async files(query: string, page: string) {
    const escaped = query.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const params = new URLSearchParams({q:`trashed = false${query ? ` and name contains '${escaped}'`:''}`,pageSize:'30',orderBy:'modifiedTime desc',fields:'files(id,name,mimeType,modifiedTime,size),nextPageToken'});
    if(page) params.set('pageToken',page);
    return (await this.get('drive',`https://www.googleapis.com/drive/v3/files?${params}`)).json();
  }
  async file(id: string) {
    if(!/^[\w-]{1,200}$/.test(id)) throw new WorkspaceError('unsupported');
    const base=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`;
    const meta = await (await this.get('drive',`${base}?fields=id,name,mimeType,size`)).json();
    const doc = meta.mimeType === 'application/vnd.google-apps.document';
    if(!doc && !/^text\//.test(meta.mimeType)) throw new WorkspaceError('unsupported');
    if(Number(meta.size) > 1048576) throw new WorkspaceError('size');
    const response = await this.get('drive',`${base}${doc ? '/export?mimeType=text%2Fplain':'?alt=media'}`);
    const reader=response.body!.getReader(); let size=0; const chunks:Uint8Array[]=[];
    try { while(true) { const part=await reader.read(); if(part.done) break; size+=part.value.length; if(size>1048576) throw new WorkspaceError('size'); chunks.push(part.value); } } finally { await reader.cancel(); }
    return {name:meta.name,text:Buffer.concat(chunks).toString('utf8')};
  }
  async messages(query: string, page: string) {
    const params = new URLSearchParams({maxResults:'15',q:query || 'in:inbox',fields:'messages(id),nextPageToken'});
    if(page) params.set('pageToken',page);
    const list = await (await this.get('gmail',`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`)).json();
    const items=await Promise.all((list.messages ?? []).slice(0,15).map(async(row:{id:string})=> {
      const data=await (await this.get('gmail',`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(row.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&fields=id,snippet,payload(headers)`)).json();
      const header=(name:string)=>data.payload?.headers?.find((h:{name:string;value:string})=>h.name.toLowerCase()===name.toLowerCase())?.value || '';
      return {id:data.id,subject:header('Subject'),from:header('From'),date:header('Date'),snippet:data.snippet};
    }));
    return {items,nextPageToken:list.nextPageToken};
  }
  async message(id: string) {
    if(!/^[a-f\d]{1,100}$/i.test(id)) throw new WorkspaceError('upstream');
    const data=await (await this.get('gmail',`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`)).json();
    const text:string[]=[];
    const walk=(part:{mimeType?:string;body?:{data?:string};parts?:unknown[]})=> {
      if(part.mimeType === 'text/plain' && part.body?.data) text.push(Buffer.from(part.body.data,'base64url').toString('utf8'));
      for(const child of part.parts ?? []) walk(child as typeof part);
    }; walk(data.payload ?? {});
    return {text:text.join('\n').slice(0,100000) || data.snippet || '텍스트 본문이 없는 메일입니다. 첨부파일과 HTML은 표시하지 않습니다.'};
  }
  async disconnect() {
    const session = await this.store.read();
    if(session.refreshToken) {
      const response=await this.request('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:session.refreshToken}),signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok && response.status !== 400) throw new WorkspaceError('upstream',502);
    }
    await this.store.write({}); return {disconnected:true};
  }
}

let service: GoogleWorkspace | undefined;
let operation = Promise.resolve();
export async function googleWorkspace(request: Request, callback = false) {
  const access = nasAccess(request.headers);
  if(!access.allowed) return json({error:messages.nas_only},403);
  if((request.method === 'POST' || request.headers.has('origin')) && request.headers.get('origin') !== access.origin) return json({error:messages.origin},403);
  service ??= new GoogleWorkspace({clientId:process.env.GOOGLE_WORKSPACE_CLIENT_ID || '',clientSecret:process.env.GOOGLE_WORKSPACE_CLIENT_SECRET || '',origin:access.origin,directory:process.env.GOOGLE_WORKSPACE_DATA_DIR || '/run/google'},new WorkspaceStore(process.env.GOOGLE_WORKSPACE_DATA_DIR || '/run/google'));
  const execute=async()=> {
    const url=new URL(request.url), action=url.searchParams.get('action') || 'status', q=(url.searchParams.get('q') || '').slice(0,500), page=(url.searchParams.get('page') || '').slice(0,2000);
    try {
      if(callback) {
        await service!.callback(url.searchParams.get('code') || '',url.searchParams.get('state') || '',url.searchParams.has('error'));
        return new Response(null,{status:303,headers:{location:new URL(`/?google=${url.searchParams.has('error')?'cancelled':'connected'}`,access.origin).href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
      }
      if(request.method === 'POST') {
        if(action === 'connect') return json(await service!.connect());
        if(action === 'disconnect') return json(await service!.disconnect());
        return json({error:'지원하지 않는 요청입니다.'},405);
      }
      const id=url.searchParams.get('id') || '';
      if(action === 'status') return json(await service!.status());
      if(action === 'verify') return json(await service!.verify());
      if(action === 'calendars') return json(await service!.calendars());
      if(action === 'events') return json(await service!.events(id,q,page));
      if(action === 'files') return json(await service!.files(q,page));
      if(action === 'file') return json(await service!.file(id));
      if(action === 'messages') return json(await service!.messages(q,page));
      if(action === 'message') return json(await service!.message(id));
      return json({error:'지원하지 않는 요청입니다.'},400);
    } catch(error) {
      const known=error instanceof WorkspaceError;
      return json({error:known ? messages[error.code] ?? messages.upstream : messages.upstream},known ? error.status:502);
    }
  };
  // Serialize session updates so refresh/callback/disconnect cannot restore old tokens.
  const result=operation.then(execute,execute); operation=result.then(()=>{},()=>{}); return result;
}
