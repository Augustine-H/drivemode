import { useEffect, useRef, useState } from 'react';
type Service = 'calendar'|'drive'|'gmail';
type Status = { configured:boolean; connected:boolean; services:Record<Service,boolean>; expiresAt:number|null };
type Item = {id:string;summary?:string;name?:string;subject?:string;from?:string;date?:string;snippet?:string;mimeType?:string;location?:string;description?:string;start?:{dateTime?:string;date?:string};end?:{dateTime?:string;date?:string}};
const names={calendar:'일정',drive:'Drive 파일',gmail:'Gmail'};
const control='min-h-11 rounded-xl border border-line bg-surface px-3 text-sm text-fg disabled:opacity-40';
export function GoogleWorkspaceSettings() {
  const [status,setStatus]=useState<Status|null>(null),[service,setService]=useState<Service>('calendar');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState('');
  const [items,setItems]=useState<Item[]>([]),[calendars,setCalendars]=useState<Item[]>([]),[calendar,setCalendar]=useState('primary');
  const [next,setNext]=useState(''),[loaded,setLoaded]=useState(false),[detail,setDetail]=useState<{name:string;text:string}|null>(null);
  const [checks,setChecks]=useState<{service:Service;ok:boolean;error?:string}[]>([]);
  const abort=useRef<AbortController|null>(null);
  async function call(action:string, params:Record<string,string>={}, method='GET') {
    abort.current?.abort(); const controller=new AbortController(); abort.current=controller;
    setBusy(true); setError('');
    try {
      const response=await fetch(`/api/google-workspace?${new URLSearchParams({action,...params})}`,{method,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]),credentials:'same-origin',cache:'no-store'});
      const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Google 연결을 확인하세요.');
      return data;
    } catch(e) { if(!controller.signal.aborted) setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message:'요청이 지연됩니다. 다시 시도하세요.'); return null; }
    finally { if(abort.current===controller) setBusy(false); }
  }
  async function refresh() { const result=await call('status'); if(result) setStatus(result); }
  useEffect(()=>{void refresh();return()=>{abort.current?.abort();};},[]);
  async function list(page='') {
    setDetail(null);
    const action={calendar:'events',drive:'files',gmail:'messages'}[service];
    const result=await call(action,{q:query,page,...(service==='calendar'?{id:calendar}:{})});
    if(result){setItems(result.items ?? result.files ?? []);setNext(result.nextPageToken || '');setLoaded(true);}
  }
  async function open(item:Item) {
    if(service==='calendar') {setDetail({name:item.summary || '제목 없는 일정',text:[item.start?.dateTime || item.start?.date,item.location,item.description].filter(Boolean).join('\n')});return;}
    const result=await call(service==='drive'?'file':'message',{id:item.id});
    if(result)setDetail({name:result.name || item.subject || '메일 본문',text:result.text});
  }
  return <section aria-label="Google 서비스 연결" className="space-y-4 text-sm">
    <p className="text-muted">Google 계정을 연결하면 일정·파일·메일을 여기에서 읽을 수 있습니다. 검색 결과는 대화나 기기에 자동 저장하지 않습니다.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={control} disabled={busy || !status?.configured} onClick={async()=>{const result=await call('connect',{},'POST');if(result?.url)window.location.assign(result.url);}}>{status?.connected?'Google 다시 연결':'Google 계정 연결'}</button>
      <button type="button" className={control} disabled={busy} onClick={()=>void refresh()}>연결 상태 확인</button>
      <button type="button" className={control} disabled={busy || !status?.connected} onClick={async()=>{const result=await call('verify');if(result){setChecks(result.results);await refresh();}}}>세 서비스 읽기 점검</button>
      {status?.connected && <button type="button" className={control} disabled={busy} onClick={async()=>{if(window.confirm('Google 읽기 권한을 철회하고 저장된 연결 정보를 지울까요?')){const result=await call('disconnect',{},'POST');if(result){setItems([]);setDetail(null);setLoaded(false);await refresh();}}}}>연결 해제</button>}
    </div>
    {status && <p role="status">{status.configured ? status.connected?'Google 연결됨 · 읽기 전용':'Google 승인 대기':'관리자 OAuth 설정 대기'}</p>}
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
      <span className="block break-words font-medium">{item.summary || item.name || item.subject || '제목 없음'}</span>
      <span className="mt-1 block break-words text-muted">{service==='calendar' ? item.start?.dateTime || item.start?.date : service==='gmail' ? item.from : item.mimeType}</span>
      {item.snippet && <span className="mt-1 block break-words text-muted">{item.snippet}</span>}
    </button></li>)}</ul>
    {next && <button type="button" className={control} disabled={busy} onClick={()=>void list(next)}>다음 페이지</button>}
    {detail && <article className="rounded-xl border border-line p-3"><h3 className="break-words font-medium">{detail.name}</h3><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{detail.text}</pre><button type="button" className={`${control} mt-3`} onClick={()=>setDetail(null)}>본문 닫기</button></article>}
    <p className="text-muted">일정 수정·파일 변경·메일 전송 기능은 요청하지 않습니다. Drive 미리보기는 Google Docs와 텍스트 파일을 지원합니다.</p>
  </section>;
}
