import { GOOGLE_APP_ORIGIN,GOOGLE_BACKEND_ORIGIN,workspaceIntent,type WorkspaceProposal } from './google-workspace-contract.ts';
export function workspaceEndpoint(action:string) {
  const base=typeof window!=='undefined' && window.location.origin===GOOGLE_APP_ORIGIN?GOOGLE_BACKEND_ORIGIN:'';
  return `${base}/api/google-workspace/${action}`;
}
export function connectWorkspace() {
  const origin=window.location.origin;
  window.location.assign(`${workspaceEndpoint('connect')}?returnOrigin=${encodeURIComponent(origin)}`);
}
export async function workspaceRequest(action:string,params:Record<string,string>={},body?:unknown,signal?:AbortSignal) {
  try {
    const res=await fetch(`${workspaceEndpoint(action)}?${new URLSearchParams(params)}`,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});
    const data=await res.json();if(!res.ok)throw new Error(data.error || 'Google 서비스 요청을 완료하지 못했습니다.');return data;
  } catch(e) {if(e instanceof TypeError)throw new Error('NAS/Tailscale 서버에 연결하지 못했습니다. Tailscale 연결과 NAS 앱 접근을 확인하세요.');if(e instanceof DOMException && e.name==='TimeoutError')throw new Error('Google 요청이 지연됩니다. 변경 작업은 실제 결과를 조회한 뒤 다시 시도하세요.');throw e;}
}
export type ConfirmationRequest={proposal:WorkspaceProposal;resolve:(confirmed:boolean)=>void};
export const confirmationEvent='voicegrok-google-confirmation';
export function confirmWorkspace(proposal:WorkspaceProposal,signal?:AbortSignal):Promise<boolean> {
  return new Promise(resolve=>{
    let finished=false;
    const done=(value:boolean)=>{if(finished)return;finished=true;signal?.removeEventListener('abort',abort);resolve(value);window.dispatchEvent(new CustomEvent(`${confirmationEvent}-close`));};
    const abort=()=>done(false);if(signal?.aborted){resolve(false);return;}
    signal?.addEventListener('abort',abort,{once:true});
    window.dispatchEvent(new CustomEvent<ConfirmationRequest>(confirmationEvent,{detail:{proposal,resolve:done}}));
  });
}
let context:unknown[]=[];
export function selectWorkspaceContext(value:unknown[]) {context=value.slice(0,15);}
export async function workspaceConversation(message:string,signal?:AbortSignal,image?:string) {
  if(!workspaceIntent(message))return null;
  try {
    const parsed=image?.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    const attachment=parsed?{name:'VoiceGrok image',mimeType:parsed[1],data:parsed[2]}:undefined;
    const data=await workspaceRequest('chat',{}, {message,context,attachment},signal);
    if(Array.isArray(data.context))selectWorkspaceContext(data.context);
    if(data.proposal) {
      if(!await confirmWorkspace(data.proposal,signal))return 'Google 작업을 취소했습니다.';
      const result=await workspaceRequest('execute',{}, {id:data.proposal.id},signal);
      return result.text || 'Google 작업을 완료했습니다.';
    }
    return data.text || 'Google 서비스 응답을 확인하세요.';
  } catch(e) {return e instanceof Error?e.message:'Google 요청을 완료하지 못했습니다.';}
}
