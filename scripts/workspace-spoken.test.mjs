import test from 'node:test';
import assert from 'node:assert/strict';
import {spokenCalendarEvent,senderName,mailIntroduction} from '../src/lib/workspace-spoken.ts';
import {summarizeMail} from '../src/lib/google-workspace-chat.server.ts';
test('calendar uses Seoul date, weekday and natural time across UTC midnight',()=>{
 const now=new Date('2026-10-07T00:00:00Z');
 assert.equal(spokenCalendarEvent({summary:'회의',start:{dateTime:'2026-10-08T06:30:00Z'}},now),'10월 8일 목요일 오후 3시 30분에 회의 일정이 있어요.');
 assert.match(spokenCalendarEvent({start:{dateTime:'2026-10-07T16:00:00Z'}},now),/10월 8일 목요일 오전 1시/);
 assert.match(spokenCalendarEvent({summary:'휴가',start:{date:'2026-10-08'}},now),/목요일에는 하루 종일 휴가/);
 assert.match(spokenCalendarEvent({start:{date:'2027-01-01'}},now),/2027년 1월 1일 금요일/);
 assert.doesNotMatch(spokenCalendarEvent({start:{date:'invalid'}},now),/Invalid Date/);
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
