import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Inbox } from "lucide-react";
import { listVoiceMails, MAIL_CHANGED_EVENT } from "@/lib/voice-mail";

export function MailNotifications({ onOpen }: { onOpen: (personaId: string) => void }) {
  const [counts, setCounts] = useState<{ id: string; name: string; count: number }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const mails = await listVoiceMails();
        const grouped = new Map<string, { id: string; name: string; count: number }>();
        for (const mail of mails) {
          if (mail.direction !== "received" || mail.heard) continue;
          const row = grouped.get(mail.personaId) ?? {
            id: mail.personaId,
            name: mail.personaName,
            count: 0,
          };
          row.count++;
          grouped.set(row.id, row);
        }
        if (active) setCounts([...grouped.values()]);
      } catch {
        /* The mail box reports storage errors when opened. */
      }
    };
    const resume = () => {
      if (!document.hidden) void refresh();
    };
    void refresh();
    window.addEventListener(MAIL_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      window.removeEventListener(MAIL_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  if (!total) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`새 보이스 메일 ${total}개`}
          className="relative inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-fg"
        >
          <Inbox className="size-5" aria-hidden="true" />
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-xs text-ink">
            {total}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-2xl border border-line bg-surface p-3 text-fg shadow-lg"
        >
          <p className="mb-2 text-sm text-muted">아직 듣지 않은 보이스 메일</p>
          {counts.map((row) => (
            <button
              key={row.id}
              type="button"
              className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 hover:bg-bg"
              onClick={() => {
                setOpen(false);
                onOpen(row.id);
              }}
            >
              <span>{row.name}</span>
              <span>{row.count}개</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
