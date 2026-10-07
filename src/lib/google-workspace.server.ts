import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {mailHtmlText} from './mail-body.server.ts';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nasAccess } from './nas-access.ts';

import { GOOGLE_REDIRECT_URI, GOOGLE_APP_ORIGIN, WORKSPACE_SCOPES, OAUTH_SCOPES, type WorkspaceAction } from './google-workspace-contract.ts';
export { WORKSPACE_SCOPES } from './google-workspace-contract.ts';
type Session = { accessToken?: string; refreshToken?: string; expiresAt?: number; scopes?: string[]; email?:string; tokenType?:string; generation?:string; pending?: { state: string; verifier: string; expires: number; returnOrigin?:string } };
type Config = { clientId: string; clientSecret: string; origin: string; directory: string; redirectUri?:string };
export class WorkspaceError extends Error {
  code:string; status:number;
  constructor(code: string, status = 400) { super(code); this.code=code;this.status=status; }
}
const messages: Record<string,string> = {
  nas_only: 'NAS 앱과 Tailscale 계정으로 접속하세요.', origin: '앱 주소를 확인하세요.', setup: '앱 전용 Google OAuth 설정이 필요합니다.',
  disconnected: 'Google 계정을 연결하세요.', consent: '선택한 Google 서비스 권한이 부족합니다. 다시 연결해 승인하세요.', expired: 'Google 연결이 만료되었습니다. 다시 연결하세요.',
  state: '연결 요청이 만료되었거나 이미 사용되었습니다. 다시 연결하세요.', upstream: 'Google 요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.',
  redirect_uri_mismatch:'Google Cloud에 등록한 callback 주소가 일치하지 않습니다.', access_denied:'Google 권한 승인을 취소했습니다.', invalid_grant:'Google 승인이 만료되었거나 철회되었습니다. 다시 연결하세요.', missing_refresh:'Refresh token을 받지 못했습니다. Google 계정을 다시 연결하세요.', quota:'Google API 사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.', network:'네트워크 연결을 확인하세요. 변경 요청 결과가 불확실하면 목록에서 확인한 뒤 다시 시도하세요.', input:'필수 항목과 작업 내용을 확인하세요.', confirmation:'작업 확인이 만료되었거나 이미 실행되었습니다. 다시 요청하세요.', ai:'Google 요청을 해석하지 못했습니다. 설정의 직접 조회와 작업 양식을 사용하세요.',
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
  private redirectUri() { const value=this.config.redirectUri || GOOGLE_REDIRECT_URI; if(value!==GOOGLE_REDIRECT_URI) throw new WorkspaceError('redirect_uri_mismatch'); return value; }
  async status() {
    const session = await this.store.read();
    return { configured:!!this.config.clientId && !!this.config.clientSecret, connected:!!session.refreshToken, email:session.email ?? null, gmail:!!session.refreshToken && !!session.scopes?.includes(WORKSPACE_SCOPES.gmail), calendar:!!session.refreshToken && !!session.scopes?.includes(WORKSPACE_SCOPES.calendar), drive:!!session.refreshToken && !!session.scopes?.includes(WORKSPACE_SCOPES.drive), expiresAt:session.expiresAt ?? null,
      services:Object.fromEntries(Object.entries(WORKSPACE_SCOPES).map(([name,scope])=>[name,(session.scopes ?? []).includes(scope)])) };
  }
  async connect(returnOrigin=this.config.origin) {
    if(!this.config.clientId || !this.config.clientSecret) throw new WorkspaceError('setup',503);
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const session = await this.store.read(); session.pending={state,verifier,expires:Date.now()+600000,returnOrigin:returnOrigin===GOOGLE_APP_ORIGIN?GOOGLE_APP_ORIGIN:this.config.origin}; await this.store.write(session);
    const query = new URLSearchParams({client_id:this.config.clientId,redirect_uri:this.redirectUri(),response_type:'code',access_type:'offline',prompt:'consent',
      scope:OAUTH_SCOPES.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return {url:`https://accounts.google.com/o/oauth2/v2/auth?${query}`};
  }
  async callback(code: string, state: string, denied = false) {
    const session = await this.store.read(), pending = session.pending;
    if(!pending || pending.expires < Date.now() || Buffer.byteLength(state) !== Buffer.byteLength(pending.state) || !timingSafeEqual(Buffer.from(state),Buffer.from(pending.state))) throw new WorkspaceError('state');
    delete session.pending; await this.store.write(session);
    if(denied) return {returnOrigin:pending.returnOrigin || this.config.origin,denied:true};
    if(!code || code.length > 4096) throw new WorkspaceError('state');
    const tokens = await this.token({grant_type:'authorization_code',code,redirect_uri:this.redirectUri(),code_verifier:pending.verifier});
    // Do not retain an earlier account's refresh token after switching accounts.
    if(!tokens.refresh_token) throw new WorkspaceError('missing_refresh',401);
    if(typeof tokens.scope !== 'string') throw new WorkspaceError('consent',403);
    await this.store.write({accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt:Date.now()+tokens.expires_in*1000,scopes:tokens.scope.split(' '),tokenType:tokens.token_type,generation:randomBytes(16).toString('hex')});
    if(tokens.scope.split(' ').includes('email')) {
      const info=await this.request('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(15000),redirect:'error'}).catch(()=>null);
      if(info?.ok) {const identity=await info.json(); if(identity.email_verified===true && typeof identity.email==='string') {const current=await this.store.read();current.email=identity.email;await this.store.write(current);}}
    }
    this.proposals.clear();
    return {returnOrigin:pending.returnOrigin || this.config.origin,denied:false};
  }
  private async token(parameters: Record<string,string>) {
    const response = await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({...parameters,client_id:this.config.clientId,client_secret:this.config.clientSecret}),signal:AbortSignal.timeout(15000),redirect:'error'}).catch(()=>{throw new WorkspaceError('network',502);});
    const data = await response.json();
    if(!response.ok) {const code=['invalid_grant','redirect_uri_mismatch','access_denied'].includes(data.error)?data.error:'upstream'; throw new WorkspaceError(code,code==='invalid_grant'?401:502);}
    if(typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in<=0 || (data.token_type && data.token_type.toLowerCase()!=='bearer')) throw new WorkspaceError('upstream',502);
    return data as {access_token:string;refresh_token?:string;expires_in:number;scope:string;token_type?:string};
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
          const updated = {...saved,accessToken:data.access_token,expiresAt:Date.now()+data.expires_in*1000,scopes:data.scope?.split(' ') ?? saved.scopes,refreshToken:data.refresh_token || saved.refreshToken};
          await this.store.write(updated); return updated;
        } catch(e) { if(e instanceof WorkspaceError && e.code === 'invalid_grant') await this.store.write({}); throw e; }
      })().finally(()=>{this.refresh=null;});
      session = await this.refresh;
      if(!session.scopes?.includes(WORKSPACE_SCOPES[service])) throw new WorkspaceError('consent',403);
    }
    return session.accessToken!;
  }
  private async api(service: keyof typeof WORKSPACE_SCOPES, url:string, method='GET', body?:unknown, media:boolean|string=false) {
    for(let attempt=0;attempt<2;attempt++) {
      const token=await this.access(service);
      let response:Response;
      try {response=await this.request(url,{method,headers:{authorization:`Bearer ${token}`,...(body!==undefined?{'content-type':typeof media==='string'?media:media?'text/plain; charset=utf-8':'application/json'}:{})},body:body===undefined?undefined:media?body as BodyInit:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});} catch {throw new WorkspaceError('network',502);}
      if(response.ok) return response;
      const error=await response.json().catch(()=>({}));
      const reason=error.error?.details?.find((d:{reason?:string})=>d.reason)?.reason || error.error?.errors?.[0]?.reason;
      if(response.status===401 && attempt===0) {const saved=await this.store.read();saved.expiresAt=0;await this.store.write(saved);continue;}
      if(response.status===401) {await this.store.write({});throw new WorkspaceError('invalid_grant',401);}
      const code=reason==='SERVICE_DISABLED'?'disabled':response.status===429 || ['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','quotaExceeded'].includes(reason)?'quota':response.status===403?'consent':'upstream';
      throw new WorkspaceError(code,response.status===403?403:response.status===429?429:502);
    }
    throw new WorkspaceError('invalid_grant',401);
  }
  private async get(service:keyof typeof WORKSPACE_SCOPES,url:string) {return this.api(service,url);}
  async profile() {return (await this.get('gmail','https://gmail.googleapis.com/gmail/v1/users/me/profile')).json();}
  // calendar.events does not authorize calendarList; use known calendar IDs.
  async calendars() {return {items:[{id:'primary',summary:'기본 캘린더'}]};}
  async verify() {
    const results=[];
    for(const [service,url] of [
      ['calendar','https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=items(id)'],
      ['drive','https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)'],
      ['gmail','https://gmail.googleapis.com/gmail/v1/users/me/profile'],
    ] as const) {
      try {const response=await this.get(service,url);await response.body?.cancel();results.push({service,ok:true});}
      catch(error){results.push({service,ok:false,error:error instanceof WorkspaceError?messages[error.code]:messages.upstream});}
    }
    return {results,checkedAt:new Date().toISOString()};
  }
  async events(calendarId: string, query: string, page: string, timeMin?:string, timeMax?:string) {
    const now = new Date(), end = new Date(now.getTime()+30*86400000);
    const params = new URLSearchParams({timeMin:timeMin?new Date(timeMin).toISOString():now.toISOString(),timeMax:timeMax?new Date(timeMax).toISOString():end.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'30',fields:'items(id,summary,start,end,location,description),nextPageToken'});
    if(query) params.set('q',query); if(page) params.set('pageToken',page);
    return (await this.get('calendar',`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params}`)).json();
  }
  async files(query: string, page: string) {
    const escaped = query.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const params = new URLSearchParams({q:`trashed = false${query ? ` and name contains '${escaped}'`:''}`,pageSize:'30',orderBy:'modifiedTime desc',fields:'files(id,name,mimeType,modifiedTime,size,isAppAuthorized),nextPageToken'});
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
    const text:string[]=[],html:string[]=[];
    const walk=async(part:{mimeType?:string;filename?:string;body?:{data?:string;attachmentId?:string;size?:number};parts?:unknown[]})=> {
      if(part.filename)return; // Do not read attached text files as the email body.
      if(['text/plain','text/html'].includes(part.mimeType || '') && (part.body?.size ?? 0)<=1048576) {
        let encoded=part.body?.data;
        if(!encoded && part.body?.attachmentId) {
          const attachment=await (await this.get('gmail',`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`)).json();
          encoded=attachment.data;
        }
        if(encoded){const decoded=Buffer.from(encoded,'base64url').toString('utf8');if(decoded.trim())(part.mimeType==='text/plain'?text:html).push(decoded);}
      }
      for(const child of part.parts ?? [])await walk(child as typeof part);
    }; await walk(data.payload ?? {});
    const header=(name:string)=>data.payload?.headers?.find((h:{name:string;value:string})=>h.name.toLowerCase()===name.toLowerCase())?.value || '';
    const body=text.length?text.join('\n'):html.map(mailHtmlText).join('\n');
    return {id:data.id,threadId:data.threadId,subject:header('Subject'),from:header('From'),replyTo:header('Reply-To') || header('From'),messageId:header('Message-ID'),references:header('References'),text:body.slice(0,100000) || '텍스트로 읽을 수 있는 메일 본문이 없습니다. 첨부파일은 메일에서 확인해 주세요.',bodySource:text.length?'plain':body?'html':'none'};
  }
  private proposals=new Map<string,{action:WorkspaceAction;generation?:string;expiresAt:number;details:string}>();
  async propose(input:WorkspaceAction) {
    const session=await this.store.read(); if(!session.refreshToken) throw new WorkspaceError('disconnected',401);
    const operations=['sendMail','replyMail','markMail','createEvent','updateEvent','deleteEvent','createFile','updateFile','deleteFile','selfTest'];
    if(!operations.includes(input.operation)) throw new WorkspaceError('input');
    const action:WorkspaceAction={operation:input.operation};
    for(const field of ['id','to','subject','text','calendarId','start','end','name'] as const) {
      if(input[field]!==undefined) {if(typeof input[field]!=='string' || input[field]!.length>(field==='text'?100000:1000))throw new WorkspaceError('input');action[field]=input[field];}
    }
    if(typeof input.unread==='boolean') action.unread=input.unread;
    if(input.data!==undefined) {
      if(input.operation!=='createFile' || typeof input.data!=='string' || input.data.length>1400000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data) || Buffer.from(input.data,'base64').length>1048576)throw new WorkspaceError('size');
      action.data=input.data;action.mimeType=typeof input.mimeType==='string' && /^[\w.+-]+\/[\w.+-]+$/.test(input.mimeType)?input.mimeType:'application/octet-stream';
    }
    const op=action.operation;
    const service=op.includes('Mail')?'gmail':op.includes('Event')?'calendar':'drive';
    if(op!=='selfTest' && !session.scopes?.includes(WORKSPACE_SCOPES[service]))throw new WorkspaceError('consent',403);
    if(/^(replyMail|markMail|updateEvent|deleteEvent|updateFile|deleteFile)$/.test(op) && !/^[\w-]{1,200}$/.test(action.id || '')) throw new WorkspaceError('input');
    if(op==='sendMail' && !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(action.to || '')) throw new WorkspaceError('input');
    if(/^(sendMail|replyMail|createFile|updateFile)$/.test(op) && !action.text?.trim() && !(op==='createFile' && action.data!==undefined)) throw new WorkspaceError('input');
    if(op==='markMail' && typeof action.unread!=='boolean') throw new WorkspaceError('input');
    if(op==='createFile' && !action.name?.trim())throw new WorkspaceError('input');
    if(op==='createEvent' || op==='updateEvent') {
      if(!action.subject?.trim() || !action.start || !action.end || !/(Z|[+-]\d{2}:\d{2})$/.test(action.start) || !/(Z|[+-]\d{2}:\d{2})$/.test(action.end) || !Number.isFinite(Date.parse(action.start)) || !Number.isFinite(Date.parse(action.end)) || Date.parse(action.end)<=Date.parse(action.start))throw new WorkspaceError('input');
    }
    let details=Object.entries(action).filter(([key])=>key!=='operation' && key!=='data').map(([k,v])=>`${k}: ${v}`).join('\n');
    if(action.data!==undefined)details+=`\n파일 크기: ${Buffer.from(action.data,'base64').length} bytes`;
    if(op==='replyMail') {const mail=await this.message(action.id!);details=`받는 사람: ${mail.replyTo}\n제목: Re: ${mail.subject}\n\n${action.text}`;}
    if(op==='deleteFile' || op==='updateFile') {const meta=await (await this.get('drive',`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(action.id!)}?fields=id,name,isAppAuthorized`)).json();if(meta.isAppAuthorized!==true)throw new WorkspaceError('consent',403);details=`파일: ${meta.name}\n${details}`;}
    if(op==='deleteEvent' || op==='updateEvent') {const event=await (await this.get('calendar',`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(action.calendarId || 'primary')}/events/${encodeURIComponent(action.id!)}`)).json();details=`기존 일정: ${event.summary || '(제목 없음)'}\n${event.start?.dateTime || event.start?.date || ''}\n${details}`;}
    if(op==='selfTest')details='내 Gmail 주소로 VoiceGrok OAuth Test 메일 1통을 전송하고 그 메일의 읽음/안읽음을 변경합니다. 테스트 메일은 남겨 둡니다. 기본 캘린더의 테스트 일정과 앱이 만든 Drive 텍스트 파일만 생성·조회·수정 후 제거합니다.';
    for(const [key,value] of this.proposals)if(value.expiresAt<Date.now())this.proposals.delete(key);
    if(this.proposals.size>=20)throw new WorkspaceError('quota',429);
    const id=randomBytes(32).toString('base64url'),expiresAt=Date.now()+600000;
    this.proposals.set(id,{action,generation:session.generation,expiresAt,details});
    const titles:Record<string,string>={sendMail:'메일 전송',replyMail:'메일 답장',markMail:'메일 읽음 상태 변경',createEvent:'일정 추가',updateEvent:'일정 수정',deleteEvent:'일정 삭제',createFile:'Drive 파일 저장',updateFile:'Drive 파일 수정',deleteFile:'Drive 파일 삭제',selfTest:'실제 Google API 통합 시험'};
    return {id,title:titles[op],details,expiresAt};
  }
  async execute(id:string) {
    const saved=this.proposals.get(id); if(!saved)throw new WorkspaceError('confirmation');
    this.proposals.delete(id); const session=await this.store.read();
    if(saved.expiresAt<Date.now() || !session.refreshToken || session.generation!==saved.generation)throw new WorkspaceError('confirmation');
    return this.writeAction(saved.action);
  }
  private async writeAction(action:WorkspaceAction):Promise<unknown> {
    const op=action.operation,id=encodeURIComponent(action.id || ''),calendar=encodeURIComponent(action.calendarId || 'primary');
    if(op==='selfTest')return this.selfTest();
    if(op==='sendMail' || op==='replyMail') {
      let to=action.to!,subject=action.subject || '(제목 없음)',threadId:string|undefined,replyHeaders='';
      if(op==='replyMail') {const original=await this.message(action.id!);to=original.replyTo;subject=/^re:/i.test(original.subject)?original.subject:`Re: ${original.subject}`;threadId=original.threadId;
        const messageId=original.messageId.replace(/[\r\n]/g,'');replyHeaders=messageId?`In-Reply-To: ${messageId}\r\nReferences: ${original.references.replace(/[\r\n]/g,'')} ${messageId}\r\n`:'';
      }
      if(!to || /[\r\n]/.test(to))throw new WorkspaceError('input');
      const raw=Buffer.from(`To: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\n${replyHeaders}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(action.text!).toString('base64').match(/.{1,76}/g)?.join('\r\n') || ''}`).toString('base64url');
      const result=await (await this.api('gmail','https://gmail.googleapis.com/gmail/v1/users/me/messages/send','POST',{raw,...(threadId?{threadId}:{})})).json();
      return {id:result.id,text:'메일을 전송했습니다.'};
    }
    if(op==='markMail') {await this.api('gmail',`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`,'POST',{addLabelIds:action.unread?['UNREAD']:[],removeLabelIds:action.unread?[]:['UNREAD']});return {text:action.unread?'안읽음으로 변경했습니다.':'읽음으로 변경했습니다.'};}
    if(op.includes('Event')) {
      const base=`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`;
      if(op==='deleteEvent') {await this.api('calendar',`${base}/${id}?sendUpdates=none`,'DELETE');return {text:'일정을 삭제했습니다.'};}
      const event={summary:action.subject,...(action.text!==undefined?{description:action.text}:{}),start:{dateTime:action.start,timeZone:'Asia/Seoul'},end:{dateTime:action.end,timeZone:'Asia/Seoul'}};
      const result=await (await this.api('calendar',`${base}${op==='updateEvent'?`/${id}`:''}?sendUpdates=none`,op==='updateEvent'?'PATCH':'POST',event)).json();return {id:result.id,text:op==='createEvent'?'일정을 추가했습니다.':'일정을 수정했습니다.'};
    }
    if(op==='deleteFile') {await this.api('drive',`https://www.googleapis.com/drive/v3/files/${id}`,'PATCH',{trashed:true});return {text:'파일을 휴지통으로 이동했습니다.'};}
    if(op==='createFile') {
      const created=await (await this.api('drive','https://www.googleapis.com/drive/v3/files?fields=id','POST',{name:action.name,mimeType:action.mimeType || 'text/plain',appProperties:{application:'VoiceGrok'}})).json();
      const binary=action.data!==undefined?new Blob([Uint8Array.from(Buffer.from(action.data,'base64'))]):undefined;
      try {await this.api('drive',`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(created.id)}?uploadType=media`,'PATCH',binary ?? action.text,binary? action.mimeType || 'application/octet-stream':true);} catch(error){try{await this.api('drive',`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.id)}`,'PATCH',{trashed:true});}catch{/* Do not delete any pre-existing file. */}throw error;}
      return {id:created.id,text:'Drive에 파일을 저장했습니다.'};
    }
    await this.api('drive',`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,'PATCH',action.text,true);return {text:'파일 내용을 수정했습니다.'};
  }
  private async selfTest() {
    const results:{service:string;step:string;ok:boolean;error?:string;cleanupId?:string}[]=[];
    let eventId='',fileId='';const run=async(service:string,step:string,task:()=>Promise<unknown>)=>{try{const result=await task();results.push({service,step,ok:true});return result as {id?:string};}catch(e){results.push({service,step,ok:false,error:e instanceof WorkspaceError?messages[e.code]:messages.upstream});return null;}};
    const profile=await run('gmail','계정 조회',()=>this.profile());
    await run('gmail','최근 메일 목록',()=>this.messages('in:inbox',''));
    if(profile) {const own=await this.profile();const sent=await run('gmail','내 계정에 테스트 메일 전송',()=>this.writeAction({operation:'sendMail',to:own.emailAddress,subject:'VoiceGrok OAuth Test',text:'VoiceGrok OAuth API integration test.'}));
      if(sent?.id) {await run('gmail','테스트 메일 본문 읽기',()=>this.message(sent.id!));await run('gmail','안읽음 변경',()=>this.writeAction({operation:'markMail',id:sent.id,unread:true}));await run('gmail','읽음 변경',()=>this.writeAction({operation:'markMail',id:sent.id,unread:false}));}}
    try {
      await run('calendar','일정 목록',()=>this.events('primary','',''));
      const start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString();
      const event=await run('calendar','테스트 일정 생성',()=>this.writeAction({operation:'createEvent',subject:'VoiceGrok OAuth Test',start,end}));eventId=event?.id || '';
      if(eventId)await run('calendar','테스트 일정 수정',()=>this.writeAction({operation:'updateEvent',id:eventId,subject:'VoiceGrok OAuth Test (updated)',start,end}));
      const file=await run('drive','앱 테스트 파일 생성',()=>this.writeAction({operation:'createFile',name:'VoiceGrok OAuth Test.txt',text:'initial test'}));fileId=file?.id || '';
      if(fileId) {await run('drive','앱 테스트 파일 조회',()=>this.file(fileId));await run('drive','앱 테스트 파일 수정',()=>this.writeAction({operation:'updateFile',id:fileId,text:'updated test'}));}
    } finally {
      if(eventId) {const removed=await run('calendar','생성한 테스트 일정 삭제',()=>this.writeAction({operation:'deleteEvent',id:eventId}));if(!removed)results.at(-1)!.cleanupId=eventId;}
      if(fileId) {const removed=await run('drive','생성한 테스트 파일 삭제',async()=>{await this.api('drive',`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,'DELETE');return {id:fileId};});if(!removed)results.at(-1)!.cleanupId=fileId;}
    }
    return {text:'Google API 시험 결과를 확인하세요. 테스트 메일은 남겨 두었습니다.',results};
  }
  async disconnect() {
    const session=await this.store.read();let revoked=!session.refreshToken;
    try {
      if(session.refreshToken) {const response=await this.request('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:session.refreshToken}),signal:AbortSignal.timeout(15000),redirect:'error'});revoked=response.ok || response.status===400;}
    } catch {revoked=false;} finally {await this.store.write({});this.proposals.clear();}
    return {disconnected:true,revoked,...(!revoked?{warning:'앱의 연결 정보는 삭제했습니다. Google 권한 철회에 실패했으므로 Google 계정의 연결된 앱에서도 권한을 철회하세요.'}:{})};
  }

}

let service: GoogleWorkspace | undefined;
let operation = Promise.resolve();
const cookieName='__Host-voicegrok-google-state';
export async function googleWorkspace(request: Request, callback = false, routeAction?:string) {
  const access=nasAccess(request.headers),origin=request.headers.get('origin');
  const trusted=origin===access.origin || origin===GOOGLE_APP_ORIGIN;
  const cors=(response:Response)=>{if(trusted && origin){response.headers.set('access-control-allow-origin',origin);response.headers.set('vary','Origin');response.headers.set('access-control-allow-methods','GET, POST, OPTIONS');response.headers.set('access-control-allow-headers','Content-Type');}return response;};
  if(!access.allowed)return cors(json({error:messages.nas_only,errorCode:'nas_only'},403));
  if((request.method==='POST' || origin) && !trusted)return json({error:messages.origin,errorCode:'origin'},403);
  if(request.method==='OPTIONS')return cors(new Response(null,{status:204,headers:{'cache-control':'no-store'}}));
  service ??= new GoogleWorkspace({clientId:process.env.GOOGLE_CLIENT_ID || '',clientSecret:process.env.GOOGLE_CLIENT_SECRET || '',redirectUri:process.env.GOOGLE_REDIRECT_URI,origin:access.origin,directory:process.env.GOOGLE_WORKSPACE_DATA_DIR || '/run/google'},new WorkspaceStore(process.env.GOOGLE_WORKSPACE_DATA_DIR || '/run/google'));
  const execute=async()=> {
    const url=new URL(request.url),action=routeAction || url.searchParams.get('action') || 'status',q=(url.searchParams.get('q') || '').slice(0,500),page=(url.searchParams.get('page') || '').slice(0,2000),id=url.searchParams.get('id') || '';
    try {
      if(callback) {
        const state=url.searchParams.get('state') || '',cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1) || '';
        if(!state || Buffer.byteLength(cookie)!==Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(cookie),Buffer.from(state)))throw new WorkspaceError('state');
        const result=await service!.callback(url.searchParams.get('code') || '',state,url.searchParams.has('error'));
        return new Response(null,{status:303,headers:{location:new URL(`/?google=${result.denied?'access_denied':'connected'}`,result.returnOrigin).href,'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`}});
      }
      if(action==='connect' && request.method==='GET') {
        const result=await service!.connect(url.searchParams.get('returnOrigin') || access.origin),state=new URL(result.url).searchParams.get('state');
        return new Response(null,{status:303,headers:{location:result.url,'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':`${cookieName}=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`}});
      }
      if(request.method==='POST') {
        if(action==='disconnect')return json(await service!.disconnect());
        if(Number(request.headers.get('content-length'))>1600000)throw new WorkspaceError('input');
        const body=await request.text();if(body.length>1600000)throw new WorkspaceError('input');
        let data;try{data=JSON.parse(body);}catch{throw new WorkspaceError('input');}
        if(action==='propose')return json({proposal:await service!.propose(data)});
        if(action==='execute')return json(await service!.execute(String(data?.id || '')));
        if(action==='chat')return json(await (await import('./google-workspace-chat.server.ts')).workspaceChat(service!,data));
        return json({error:'지원하지 않는 요청입니다.'},405);
      }
      if(action==='status')return json(await service!.status());
      if(action==='verify')return json(await service!.verify());
      if(action==='profile')return json(await service!.profile());
      if(action==='calendars')return json(await service!.calendars());
      if(action==='events')return json(await service!.events(id,q,page));
      if(action==='files')return json(await service!.files(q,page));
      if(action==='file')return json(await service!.file(id));
      if(action==='messages')return json(await service!.messages(q,page));
      if(action==='message')return json(await service!.message(id));
      return json({error:'지원하지 않는 요청입니다.'},400);
    } catch(error) {
      const known=error instanceof WorkspaceError,code=known?error.code:'upstream';
      if(callback)return new Response(null,{status:303,headers:{location:new URL(`/?google=${encodeURIComponent(code)}`,access.origin).href,'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`}});
      return json({error:messages[code] || messages.upstream,errorCode:code},known?error.status:502);
    }
  };
  const result=operation.then(execute,execute);operation=result.then(()=>{},()=>{});return cors(await result);
}
