import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceResponse } from '../src/lib/voice-formatter.ts';
import { ttsUnits } from '../src/lib/tts-chunking.ts';
import { speechForTurn } from '../src/lib/reader-parts.ts';
import { mergeTtsStatus } from '../src/lib/tts-status.ts';

test('a streamed six sentence reply retains every emitted chunk and its final sentence',()=>{
  const text='첫 번째 안내입니다. 두 번째 설명입니다. 세 번째 단계입니다. 네 번째 내용입니다. 다섯 번째 주의사항입니다. 마지막 문장까지 모두 읽습니다.';
  let heard=[];
  for(let i=1;i<=text.length;i++){
    const current=ttsUnits(voiceResponse(text.slice(0,i),false),true);
    assert.deepEqual(current.slice(0,heard.length),heard);
    heard=current;
  }
  const completed=ttsUnits(voiceResponse(text,true),true);
  assert.deepEqual(completed.slice(0,heard.length),heard);
  assert.equal(completed.join(' '),text);
});
test('old shortened voice copies cannot truncate a saved completed reply',()=>{
  const text='첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다. 마지막 문장입니다.';
  const turn={id:'old',speaker:'grok',text,voiceText:'첫 번째 문장입니다. 두 번째 문장입니다.',speechParts:['첫 번째 문장입니다.','두 번째 문장입니다.']};
  const before=JSON.stringify(turn);
  assert.equal(speechForTurn(turn).join(' '),text);
  assert.equal(JSON.stringify(turn),before);
  assert.deepEqual(speechForTurn({...turn,streaming:true}),turn.speechParts);
});
test('usage updates preserve NAS selection but explicit PC failover changes it',()=>{
  const routing={activeBackend:'nas',priority:['nas','pc'],attempts:[],usageScope:'allocated',totalBudget:200000};
  const previous={routing,authentication:true,usage:{googleChirpCharacters:317}};
  const updated=mergeTtsStatus(previous,{authentication:true,usage:{googleChirpCharacters:360}});
  assert.equal(updated.routing.activeBackend,'nas');
  assert.equal(updated.usage.googleChirpCharacters,360);
  assert.equal(mergeTtsStatus(updated,{...updated,routing:{...routing,activeBackend:'pc'}}).routing.activeBackend,'pc');
});
