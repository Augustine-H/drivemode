import { workspaceRequest,connectWorkspace,confirmWorkspace,selectWorkspaceContext } from '@/lib/google-workspace-client';
import type {WorkspaceAction} from '@/lib/google-workspace-contract';
import { useEffect, useRef, useState } from 'react';
type Service = 'calendar'|'drive'|'gmail';
type Status = { configured:boolean; connected:boolean; services:Record<Service,boolean>; expiresAt:number|null;email?:string };
type Item = {id:string;summary?:string;name?:string;subject?:string;from?:string;date?:string;snippet?:string;mimeType?:string;location?:string;description?:string;start?:{dateTime?:string;date?:string};end?:{dateTime?:string;date?:string}};
const names={calendar:'일정',drive:'Drive 파일',gmail:'Gmail'};
const control='min-h-11 rounded-xl border border-line bg-surface px-3 text-sm text-fg disabled:opacity-40';
export function GoogleWorkspaceSettings() {
  const [status,setStatus]=useState<Status|null>(null),[service,setService]=useState<Service>('calendar');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState('');
  const [items,setItems]=useState<Item[]>([]),[calendars,setCalendars]=useState<Item[]>([]),[calendar,setCalendar]=useState('primary');
  const [next,setNext]=useState(''),[loaded,setLoaded]=useState(false),[detail,setDetail]=useState<{name:string;text:string}|null>(null);
  const [form,setForm]=useState<WorkspaceAction>({operation:'sendMail'});
  const [resultNote,setResultNote]=useState('');
  const [checks,setChecks]=useState<{service:Service;ok:boolean;error?:string}[]>([]);
  const abort=useRef<AbortController|null>(null);
  async function call(action:string, params:Record<string,string>={}, method='GET') {
    abort.current?.abort(); const controller=new AbortController(); abort.current=controller;
    setBusy(true); setError('');
    try {
      return await workspaceRequest(action,params,method==='POST'?{}:undefined,controller.signal);
    } catch(e) { if(!controller.signal.aborted) setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message:'요청이 지연됩니다. 다시 시도하세요.'); return null; }
    finally { if(abort.current===controller) setBusy(false); }
  }
  async function refresh() { const result=await call('status'); if(result) setStatus(result); }
  useEffect(()=>{void refresh();const focus=()=>void refresh();window.addEventListener('focus',focus);const code=new URLSearchParams(window.location.search).get('google');if(code && code!=='connected')setResultNote(code==='access_denied'?'Google 승인을 취소했습니다.':`Google 연결을 완료하지 못했습니다 (${code}). 다시 연결하세요.`);return()=>{abort.current?.abort();window.removeEventListener('focus',focus);};},[]);
  async function list(page='') {
    setDetail(null);
    const action={calendar:'events',drive:'files',gmail:'messages'}[service];
    const result=await call(action,{q:query,page,...(service==='calendar'?{id:calendar}:{})});
    if(result){setItems(result.items ?? result.files ?? []);setNext(result.nextPageToken || '');setLoaded(true);}
  }
  async function open(item:Item) {
    if(service==='calendar') {selectWorkspaceContext([{id:item.id,summary:item.summary,start:item.start?.dateTime || item.start?.date}]);setDetail({name:item.summary || '제목 없는 일정',text:[item.start?.dateTime || item.start?.date,item.location,item.description].filter(Boolean).join('\n')});return;}
    const result=await call(service==='drive'?'file':'message',{id:item.id});
    if(result){setDetail({name:result.name || item.subject || '메일 본문',text:result.text});selectWorkspaceContext([{...result,id:item.id}]);}
  }
  return <section aria-label="Google 서비스 연결" className="space-y-4 text-sm">
    <p className="text-muted">Google 계정의 메일·일정과 앱에서 접근을 허용한 Drive 파일을 사용합니다. 변경과 전송은 내용을 확인한 뒤 실행합니다. 대화로 요청하면 Grok이 요청과 선택한 항목의 제목을 해석합니다.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={control} disabled={busy || !status?.configured} onClick={()=>connectWorkspace()}>{status?.connected?'Google 다시 연결':'Google 계정 연결'}</button>
      <button type="button" className={control} disabled={busy} onClick={()=>void refresh()}>연결 상태 확인</button>
      <button type="button" className={control} disabled={busy || !status?.connected} onClick={async()=>{const result=await call('verify');if(result){setChecks(result.results);await refresh();}}}>세 서비스 읽기 점검</button>
      {status?.connected && <button type="button" className={control} disabled={busy} onClick={async()=>{if(window.confirm('Google 서비스 권한을 철회하고 저장된 연결 정보를 지울까요?')){const result=await call('disconnect',{},'POST');if(result){setItems([]);setDetail(null);setLoaded(false);setResultNote(result.warning || 'Google 연결을 해제했습니다.');selectWorkspaceContext([]);await refresh();}}}}>연결 해제</button>}
    </div>
    {status && <p role="status">{status.configured ? status.connected?'Google 연결됨':'Google 승인 대기':'관리자 OAuth 설정 대기'}</p>}
    {status?.email && <p className="break-words text-muted">{status.email}</p>}
    {resultNote && <p role="status" className="whitespace-pre-wrap break-words text-muted">{resultNote}</p>}
    {checks.length>0 && <ul aria-label="Google 읽기 점검 결과" className="space-y-1">{checks.map(check=><li key={check.service}>{names[check.service]}: {check.ok?'읽기 API 성공':check.error || '연결 확인 필요'}</li>)}</ul>}
    {status && !status.configured && <p className="text-muted">앱 전용 OAuth 설정이 준비되면 계정 연결 버튼이 활성화됩니다.</p>}
    <div role="tablist" aria-label="Google 서비스" className="flex flex-wrap gap-2">
      {(Object.keys(names) as Service[]).map(key=><button type="button" key={key} role="tab" aria-selected={service===key} className={control} disabled={busy} onClick={()=>{setService(key);setItems([]);setDetail(null);setNext('');setLoaded(false);setQuery('');setError('');}}>{names[key]}{status?.services[key]?' · 승인됨':' · 미연결'}</button>)}
    </div>
    {service==='calendar' && <div className="space-y-2"><p className="text-muted">오늘부터 30일간의 일정을 조회합니다.</p><div className="flex flex-wrap gap-2">
      <select aria-label="조회할 캘린더" className={`${control} min-w-0 max-w-full flex-1`} value={calendar} disabled={busy} onChange={e=>{setCalendar(e.target.value);setLoaded(false);setItems([]);setNext('');}}><option value="primary">기본 캘린더</option>{calendars.filter(c=>c.id!=='primary').map(c=><option key={c.id} value={c.id}>{c.summary}</option>)}</select>
      <button type="button" className={control} disabled={busy || !status?.services.calendar} onClick={async()=>{const result=await call('calendars');if(result)setCalendars(result.items ?? []);}}>캘린더 목록</button>
    </div></div>}
    <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void list();}}>
      <input aria-label="Google 검색어" className={`${control} min-w-0 flex-1`} maxLength={500} value={query} onChange={e=>setQuery(e.target.value)} placeholder={service==='gmail'?'메일 검색 · 예: is:unread':service==='drive'?'파일 이름 검색':'일정 검색'} />
      <button type="submit" className={control} disabled={busy || !status?.services[service]}>{busy?'조회 중…':'조회'}</button>
    </form>
    {error && <p role="alert" className="text-muted">{error}</p>}
    {loaded && !items.length && <p role="status">조회 결과가 없습니다.</p>}
    <ul className="space-y-2">{items.map(item=><li key={item.id}><button type="button" className="min-h-11 w-full rounded-xl border border-line p-3 text-left disabled:opacity-40" disabled={busy} onClick={()=>void open(item)}>
      <span className="block break-words text-muted">ID: {item.id}</span><span className="block break-words font-medium">{item.summary || item.name || item.subject || '제목 없음'}</span>
      <span className="mt-1 block break-words text-muted">{service==='calendar' ? item.start?.dateTime || item.start?.date : service==='gmail' ? item.from : item.mimeType}</span>
      {item.snippet && <span className="mt-1 block break-words text-muted">{item.snippet}</span>}
    </button></li>)}</ul>
    {next && <button type="button" className={control} disabled={busy} onClick={()=>void list(next)}>다음 페이지</button>}
    {detail && <article className="rounded-xl border border-line p-3"><h3 className="break-words font-medium">{detail.name}</h3><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{detail.text}</pre><button type="button" className={`${control} mt-3`} onClick={()=>setDetail(null)}>본문 닫기</button></article>}
    {status?.connected && <details className="rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer">메일 전송 · 일정 · Drive 작업</summary>
      <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const draft=await workspaceRequest('propose',{},form);if(await confirmWorkspace(draft.proposal)){const result=await workspaceRequest('execute',{},{id:draft.proposal.id});setResultNote(result.text);}}catch(e){setError(e instanceof Error?e.message:'작업을 완료하지 못했습니다.');}finally{setBusy(false);}}}>
        <select aria-label="Google 작업 종류" className={`${control} w-full`} value={form.operation} onChange={e=>setForm({operation:e.target.value as WorkspaceAction['operation']})}>{Object.entries({sendMail:'메일 전송',replyMail:'선택한 메일에 답장',markMail:'메일 읽음/안읽음',createEvent:'일정 추가',updateEvent:'일정 수정',deleteEvent:'일정 삭제',createFile:'Drive 텍스트 파일 저장',updateFile:'Drive 파일 수정',deleteFile:'Drive 파일 휴지통 이동'}).map(([op,label])=><option key={op} value={op}>{label}</option>)}</select>
        {['replyMail','markMail','updateEvent','deleteEvent','updateFile','deleteFile'].includes(form.operation) && <input aria-label="작업 항목 ID" placeholder="조회한 항목의 ID" className={`${control} w-full`} value={form.id || ''} onChange={e=>setForm({...form,id:e.target.value})} required/>}
        {form.operation==='sendMail' && <input aria-label="메일 받는 사람" placeholder="받는 사람 이메일" type="email" className={`${control} w-full`} value={form.to || ''} onChange={e=>setForm({...form,to:e.target.value})} required/>}
        {['sendMail','createEvent','updateEvent'].includes(form.operation) && <input aria-label="메일 또는 일정 제목" placeholder="제목" className={`${control} w-full`} value={form.subject || ''} onChange={e=>setForm({...form,subject:e.target.value})} required/>}
        {form.operation==='createFile' && <input aria-label="Drive 파일 이름" placeholder="파일 이름.txt" className={`${control} w-full`} value={form.name || ''} onChange={e=>setForm({...form,name:e.target.value})} required/>}
        {form.operation==='createFile' && <label className="block text-muted">파일 선택 · 최대 1MB<input type="file" aria-label="Drive에 저장할 파일" className="mt-2 block w-full" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1048576){setError('파일 저장은 1MB 이하만 지원합니다.');e.target.value='';return;}const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(let offset=0;offset<bytes.length;offset+=8192)raw+=String.fromCharCode(...bytes.subarray(offset,offset+8192));setForm({...form,name:file.name,mimeType:file.type || 'application/octet-stream',data:btoa(raw)});}}/>{form.data!==undefined && <span>선택한 파일: {form.name}</span>}</label>}
        {['createEvent','updateEvent'].includes(form.operation) && <><input aria-label="일정 시작 시간" placeholder="2026-10-08T15:00:00+09:00" className={`${control} w-full`} value={form.start || ''} onChange={e=>setForm({...form,start:e.target.value})} required/><input aria-label="일정 종료 시간" placeholder="2026-10-08T16:00:00+09:00" className={`${control} w-full`} value={form.end || ''} onChange={e=>setForm({...form,end:e.target.value})} required/></>}
        {form.operation==='markMail' && <select aria-label="메일 읽음 상태" className={control} value={String(form.unread ?? false)} onChange={e=>setForm({...form,unread:e.target.value==='true'})}><option value="false">읽음</option><option value="true">안읽음</option></select>}
        {!['markMail','deleteEvent','deleteFile'].includes(form.operation) && <textarea aria-label="Google 작업 본문" placeholder="메일 본문 · 일정 설명 · 파일 내용" className={`${control} min-h-24 w-full py-3`} value={form.text || ''} onChange={e=>setForm({...form,text:e.target.value})}/>}
        <button type="submit" className={control} disabled={busy}>내용 확인</button>
      </form>
      <button type="button" className={`${control} mt-4`} disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const draft=await workspaceRequest('propose',{},{operation:'selfTest'});if(await confirmWorkspace(draft.proposal)){const result=await workspaceRequest('execute',{},{id:draft.proposal.id});setResultNote(result.results.map((x:{service:string;step:string;ok:boolean;error?:string;cleanupId?:string})=>`${x.service} · ${x.step}: ${x.ok?'성공':x.error}${x.cleanupId?' · 정리 필요 ID: '+x.cleanupId:''}`).join('\n'));}}catch(e){setError(e instanceof Error?e.message:'시험 실패');}finally{setBusy(false);}}}>실제 API 통합 시험 · 변경 포함</button>
    </details>}
    <p className="text-muted">Drive 목록은 앱이 생성했거나 앱에 접근을 허용한 파일만 표시합니다. 전체 Drive 검색 권한은 없습니다. Testing 상태에서는 7일 후 재연결이 필요할 수 있습니다.</p>
  </section>;
}
