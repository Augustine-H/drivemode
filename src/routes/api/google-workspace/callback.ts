import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/google-workspace/callback')({server:{handlers:{
  GET:async({request})=>(await import('@/lib/google-workspace.server')).googleWorkspace(request,true),
}}});
