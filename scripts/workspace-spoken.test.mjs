import test from 'node:test';
import assert from 'node:assert/strict';
import {spokenCalendarEvent,senderName,mailIntroduction} from '../src/lib/workspace-spoken.ts';
import {summarizeMail,workspaceChat} from '../src/lib/google-workspace-chat.server.ts';
test('calendar uses Seoul date, weekday and natural time across UTC midnight',()=>{
 const now=new Date('2026-10-07T00:00:00Z');
 assert.equal(spokenCalendarEvent({summary:'회의',start:{dateTime:'2026-10-08T06:30:00Z'}},now),'10월 8일 목요일 오후 3시 30분에 회의 일정이 있어요.');
 assert.match(spokenCalendarEvent({start:{dateTime:'2026-10-07T16:00:00Z'}},now),/10월 8일 목요일 오전 1시/);
 assert.match(spokenCalendarEvent({summary:'휴가',start:{date:'2026-10-08'}},now),/목요일에는 하루 종일 휴가/);
 assert.match(spokenCalendarEvent({start:{date:'2027-01-01'}},now),/2027년 1월 1일 금요일/);
 assert.doesNotMatch(spokenCalendarEvent({start:{date:'invalid'}},now),/Invalid Date/);
});
test('explicit short-mail summary invokes summarizer instead of returning truncated preview',async()=>{
 let called=false;const result=await summarizeMail('실제 본문입니다. 근데',async()=>{called=true;return Response.json({output:[{type:'message',content:[{type:'output_text',text:'본문의 핵심 내용을 안내하는 메일입니다.'}]}]});},true);
 assert.equal(called,true);assert.match(result,/내용을 요약하면/);assert.doesNotMatch(result,/근데/);
});
test('selected and numbered original reads bypass list planning; ambiguous mail never chooses silently',async()=>{
 const saved=process.env.XAI_API_KEY;process.env.XAI_API_KEY='test-not-real';
 try {
  let requested;const client={status:async()=>({connected:true}),message:async id=>{requested=id;return {id,from:'alice@example.com',subject:'회의',text:'본문의 마지막 문장입니다.'};}};
  const never=async()=>{throw Error('must not plan original read');};
  const one=await workspaceChat(client,{message:'원문 읽어줘',context:[{id:'mail-a',subject:'회의'}]},never);
  assert.equal(requested,'mail-a');assert.match(one.text,/원문을 읽어드릴게요/);assert.match(one.text,/마지막 문장입니다/);
  const two=await workspaceChat(client,{message:'2번 메일 원문 읽어줘',context:[{id:'mail-a',subject:'회의'},{id:'mail-b',subject:'안내'}]},never);
  assert.equal(requested,'mail-b');assert.match(two.text,/원문을 읽어드릴게요/);
  const ambiguous=await workspaceChat(client,{message:'이 메일 원문 읽어줘',context:[{id:'mail-a',subject:'회의'},{id:'mail-b',subject:'안내'}]},never);
  assert.match(ambiguous.text,/번호나 제목/);
  let planned=false;const newSearch=await workspaceChat({...client,messages:async()=>({items:[]})},{message:'오늘 온 중요한 메일 요약해줘',context:[{id:'old-mail',subject:'지난주 안내'}]},async()=>{planned=true;return Response.json({output:[{type:'function_call',name:'workspace_request',arguments:'{"operation":"messages","q":"is:important"}'}]});});
  assert.equal(planned,true);assert.equal(newSearch.text,'해당 메일이 없습니다.');
 }finally{if(saved===undefined)delete process.env.XAI_API_KEY;else process.env.XAI_API_KEY=saved;}
});
test('reading a mail list summarizes fetched full bodies, not Gmail snippets',async()=>{
 const saved=process.env.XAI_API_KEY;process.env.XAI_API_KEY='test-not-real';
 try {
  const client={status:async()=>({connected:true}),messages:async()=>({items:[{id:'mail-a',subject:'안내',snippet:'근데'}]}),message:async()=>({id:'mail-a',from:'alice@example.com',subject:'안내',text:'실제 전체 본문입니다.'})};
  let calls=0;const request=async(url,options)=>{calls++;const input=JSON.parse(options.body);if(input.tools)return Response.json({output:[{type:'function_call',name:'workspace_request',arguments:JSON.stringify({operation:'messages'})}]});assert.equal(JSON.parse(input.input[1].content).emailBody,'실제 전체 본문입니다.');return Response.json({output:[{type:'message',content:[{type:'output_text',text:'전체 본문의 요약입니다.'}]}]});};
  const result=await workspaceChat(client,{message:'최근 메일 내용 요약해서 읽어줘'},request);
  assert.equal(calls,2);assert.match(result.text,/전체 본문의 요약/);assert.doesNotMatch(result.text,/미리보기|근데/);
 }finally{if(saved===undefined)delete process.env.XAI_API_KEY;else process.env.XAI_API_KEY=saved;}
});
test('sender keeps display names or local part without speaking address syntax',()=>{
 assert.equal(senderName('"홍길동" <hong@example.com>'),'홍길동');
 assert.equal(senderName('alice@example.com (alice)'),'alice');
 assert.equal(senderName('alice.smith@example.com'),'alice smith');
 assert.equal(senderName('=?UTF-8?B?7ZmN6ri464+Z?= <hong@example.com>'),'홍길동');
 assert.doesNotMatch(mailIntroduction({from:'alice@example.com',subject:'안내'}),/[@<>()]/);
});
test('long mail summary is bounded, non-stored and treats body as data; failure is honest',async()=>{
 let calls=0;const request=async(url,options)=>{calls++;const b=JSON.parse(options.body);assert.equal(b.store,false);assert.equal(b.max_output_tokens,1600);assert.equal(JSON.parse(b.input[1].content).emailBody.length,12000);assert.match(b.input[0].content,/untrusted/);return Response.json({output:[{type:'message',content:[{type:'output_text',text:'내일 회의 시간을 확인해 달라는 내용입니다.'}]}]});};
 assert.match(await summarizeMail('본문 '.repeat(5000),request),/본문 앞부분을 기준으로 요약하면/);assert.equal(calls,1);
 assert.equal(await summarizeMail('짧은 메일입니다.',request),'짧은 메일입니다.');assert.equal(calls,1);
 assert.match(await summarizeMail('본문 '.repeat(300),async()=>{throw Error('network')}),/요약을 만들지 못했습니다/);
});
test('summary preserves complete text past 1000 characters and retries unfinished output once',async()=>{
 const output=text=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});
 const long='중요한 내용을 확인하세요. '.repeat(100)+'마지막 안내입니다.';
 assert.ok(long.length>1000);
 assert.ok((await summarizeMail('본문 '.repeat(300),async()=>Response.json(output(long)))).endsWith('마지막 안내입니다.'));
 let calls=0;
 const fixed=await summarizeMail('본문 '.repeat(300),async()=>{calls++;return Response.json(calls===1?{...output('확인했습니다. 근데'),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}:output('내일 회의가 있습니다. 참석 여부를 알려주세요.'));});
 assert.equal(calls,2);assert.ok(fixed.endsWith('알려주세요.'));assert.doesNotMatch(fixed,/근데/);
 calls=0;const failed=await summarizeMail('본문 '.repeat(300),async()=>{calls++;return Response.json(output('근데'));});
 assert.equal(calls,2);assert.match(failed,/원문 읽기/);assert.doesNotMatch(failed,/근데/);
});
