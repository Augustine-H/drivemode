import { createFileRoute } from '@tanstack/react-router';
const handle=async(request:Request)=> {
  const action=new URL(request.url).pathname.split('/').at(-1);
  return (await import('@/lib/google-workspace.server')).googleWorkspace(request,false,action);
};
export const Route=createFileRoute('/api/google-workspace/$')({server:{handlers:{
  GET:async({request})=>handle(request),POST:async({request})=>handle(request),OPTIONS:async({request})=>handle(request),
}}});
