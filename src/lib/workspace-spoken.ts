export function spokenText(text:string) {
  return text.replace(/https?:\/\/\S+/gi,'링크').replace(/([\w.+-]+)@[\w.-]+\.[A-Za-z]{2,}/g,'$1').replace(/[<>]/g,'').replace(/\s+/g,' ').trim();
}
export function senderName(from:string) {
  const decoded=from.replace(/=\?UTF-8\?([BQ])\?([^?]+)\?=/gi,(_,kind,value)=>kind.toUpperCase()==='B'?Buffer.from(value,'base64').toString('utf8'):Buffer.from(value.replace(/_/g,' ').replace(/=([0-9a-f]{2})/gi,(_:string,hex:string)=>String.fromCharCode(parseInt(hex,16))),'binary').toString('utf8'));
  const address=decoded.match(/([\w.+-]+)@[\w.-]+/);
  const label=decoded.replace(/<[^>]*>/g,'').replace(/[\w.+-]+@[\w.-]+/g,'').replace(/["()\\/]/g,' ').trim();
  return spokenText(label || address?.[1]?.replace(/[._+]/g,' ') || '보낸 사람');
}
export function mailIntroduction(mail:{from?:string;subject?:string}) {
  return `${senderName(mail.from || '')} 님이 ${spokenText(mail.subject || '제목 없는 메일')}라는 제목으로 메일을 보냈네요.`;
}
type CalendarEvent={summary?:string;start?:{dateTime?:string;date?:string};end?:{dateTime?:string;date?:string}};
export function spokenCalendarEvent(event:CalendarEvent,now=new Date()) {
  const start=event.start?.dateTime || event.start?.date;
  if(!start || !Number.isFinite(Date.parse(start)))return `${spokenText(event.summary || '제목 없는 일정')}, 시간 정보가 없습니다.`;
  const value=new Date(event.start?.dateTime || `${start}T00:00:00+09:00`);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',weekday:'long',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(value).map(p=>[p.type,p.value]));
  const year=new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(now);
  const date=`${parts.year!==year?`${parts.year}년 `:''}${parts.month}월 ${parts.day}일 ${parts.weekday}`;
  const h=Number(parts.hour),m=Number(parts.minute);
  const time=event.start?.dateTime?`${h<12?'오전':'오후'} ${h%12 || 12}시${m?` ${m}분`:''}`:'하루 종일';
  return `${date}${event.start?.dateTime?` ${time}에`:'에는 하루 종일'} ${spokenText(event.summary || '제목 없는 일정')} 일정이 있어요.`;
}
