import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { confirmationEvent, type ConfirmationRequest } from "@/lib/google-workspace-client";
export function GoogleWorkspaceConfirmation() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  useEffect(() => {
    let active: ConfirmationRequest | null = null;
    const receive = (event: Event) => {
      active?.resolve(false);
      active = (event as CustomEvent<ConfirmationRequest>).detail;
      setRequest(active);
    };
    const close = () => {
      active = null;
      setRequest(null);
    };
    window.addEventListener(confirmationEvent, receive);
    window.addEventListener(`${confirmationEvent}-close`, close);
    return () => {
      window.removeEventListener(confirmationEvent, receive);
      window.removeEventListener(`${confirmationEvent}-close`, close);
      active?.resolve(false);
    };
  }, []);
  return (
    <Dialog.Root
      open={!!request}
      onOpenChange={(open) => {
        if (!open) request?.resolve(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/80" />
        <Dialog.Content className="fixed inset-x-4 top-20 z-50 mx-auto max-h-96 max-w-lg space-y-4 overflow-auto rounded-2xl border border-line bg-surface p-5 text-fg">
          <Dialog.Title className="text-lg font-medium">{request?.proposal.title}</Dialog.Title>
          <Dialog.Description className="text-muted">
            {request?.proposal.provider === "naver"
              ? "아래 내용을 네이버 메일에 적용합니다."
              : "아래 내용을 Google에 적용합니다."}{" "}
            실행 전 내용을 확인하세요.
          </Dialog.Description>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
            {request?.proposal.details}
          </pre>
          <div className="flex gap-3">
            <button
              type="button"
              className="min-h-11 rounded-xl border border-line px-4"
              onClick={() => request?.resolve(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="min-h-11 rounded-xl bg-primary px-4 text-bg"
              onClick={() => request?.resolve(true)}
            >
              확인 후 실행
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
