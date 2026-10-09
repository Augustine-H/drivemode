import { workspaceConversation } from './google-workspace-client.ts';
import { networkFetch } from './network.ts';
import type { AskResult } from "@/lib/ask-grok";
import type { AskTurn } from "@/lib/ask-prompt";

export async function streamAsk(
  input: {
    message: string;
    history: AskTurn[];
    persona?: string;
    memory?: string;
    summary?: string;
    recentBudget?: number;
    memoriesRetrieved?: number;
    image?: string;
    frames?: string[];
    workspace?:boolean;
    workspaceResult?:Promise<string|null>;
  },
  onText: (text: string, voiceText?: string) => void,
  signal?: AbortSignal,
): Promise<AskResult> {
  const workspace=input.workspaceResult?await input.workspaceResult:input.workspace?await workspaceConversation(input.message,signal,input.image):null;
  if(workspace!==null) {onText(workspace,workspace);return {ok:true,text:workspace,voiceText:workspace};}
  const res = await networkFetch("/api/ask", {
    signal,
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({...input,workspace:undefined,workspaceResult:undefined}),
  });
  if (!res.ok || !res.body) return { ok: false, error: "그록이 대답하지 못했습니다." };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let voiceText: string | undefined;
  let metrics: import("./grok-context").ContextMetrics | undefined;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    buf += decoder.decode(step.value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .map((row) => row.trim())
        .find((row) => row.startsWith("data:"));
      if (!line) continue;
      let event: {
        text?: unknown;
        error?: unknown;
        done?: unknown;
        voiceText?: string;
        metrics?: typeof metrics;
      };
      try {
        event = JSON.parse(line.slice(5).trim()) as typeof event;
      } catch {
        continue;
      }
      if (typeof event.error === "string" && event.error) return { ok: false, error: event.error };
      if (typeof event.text === "string" && event.text.trim()) {
        text = event.text.trim();
        voiceText = event.voiceText;
        metrics = event.metrics ?? metrics;
        onText(text, voiceText);
      }
    }
  }
  if (!text) return { ok: false, error: "그록이 빈 답을 보냈습니다." };
  return { ok: true, text, voiceText, metrics };
}
