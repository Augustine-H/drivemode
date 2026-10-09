import { useEffect, useState, useRef } from "react";
import { naverRequest, selectNaverContext, downloadNaverAttachment } from "@/lib/naver-mail-client";
import { confirmWorkspace } from "@/lib/google-workspace-client";
import {
  MAIL_PROVIDER,
  NAVER_SELECTION,
  NAVER_DRAFT_EVENT,
  type NaverDraft,
  type NaverMailItem,
  type NaverMailMessage,
  type NaverAction,
  NAVER_ATTACHMENT_LIMIT,
} from "@/lib/naver-mail-contract";

const control =
  "min-h-11 rounded-xl border border-line bg-surface px-3 text-sm text-fg disabled:opacity-40";
const emptyDraft = (): NaverDraft => ({ to: "", subject: "", text: "", attachments: [] });
export function NaverMailSection() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-2xl border border-line p-3"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer py-3 font-medium">네이버 메일</summary>
      {open && <NaverMailSettings />}
    </details>
  );
}
export function NaverMailSettings() {
  const [status, setStatus] = useState<{ connected: boolean; email: string | null } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [query, setQuery] = useState(""),
    [unread, setUnread] = useState(false),
    [mailbox, setMailbox] = useState("INBOX");
  const [boxes, setBoxes] = useState<{ path: string; name: string; specialUse?: string }[]>([]),
    [items, setItems] = useState<NaverMailItem[]>([]),
    [loaded, setLoaded] = useState(false),
    [detail, setDetail] = useState<NaverMailMessage | null>(null),
    [destination, setDestination] = useState("");
  const [draft, setDraft] = useState<NaverDraft>(emptyDraft),
    [dirty, setDirty] = useState(false);
  const [forwardAttachments, setForwardAttachments] = useState(true);
  const abort = useRef(new AbortController());
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await work();
    } catch (e) {
      if (!abort.current.signal.aborted)
        setError(e instanceof Error ? e.message : "네이버 요청을 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const result = await naverRequest("status", {}, undefined, abort.current.signal);
    setStatus(result);
    if (result.connected) {
      const [folders, saved] = await Promise.all([
        naverRequest("mailboxes", {}, undefined, abort.current.signal),
        naverRequest("draft", {}, undefined, abort.current.signal),
      ]);
      setBoxes(folders.items);
      setDraft(saved.draft || emptyDraft());
      setDirty(false);
    }
  }
  useEffect(() => {
    abort.current = new AbortController();
    void run(refresh);
    const receive = (event: Event) => {
      setDraft((event as CustomEvent<NaverDraft>).detail);
      setDirty(false);
    };
    const reload = () => void run(refresh);
    window.addEventListener(NAVER_DRAFT_EVENT, receive);
    window.addEventListener(`${NAVER_DRAFT_EVENT}-refresh`, reload);
    return () => {
      abort.current.abort();
      setPassword("");
      window.removeEventListener(NAVER_DRAFT_EVENT, receive);
      window.removeEventListener(`${NAVER_DRAFT_EVENT}-refresh`, reload);
    };
  }, []);
  function edit(value: Partial<NaverDraft>) {
    setDraft((previous) => ({ ...previous, ...value }));
    setDirty(true);
    setNote("");
  }
  async function list() {
    setDetail(null);
    const result = await naverRequest(
      "messages",
      { mailbox, q: query, unread: String(unread) },
      undefined,
      abort.current.signal,
    );
    setItems(result.items);
    setLoaded(true);
    selectNaverContext(result.items);
  }
  async function open(item: NaverMailItem) {
    const result = await naverRequest("message", { id: item.id }, undefined, abort.current.signal);
    setDetail(result);
    selectNaverContext([result]);
  }
  async function mutate(action: NaverAction) {
    const result = await naverRequest("propose", {}, action, abort.current.signal);
    if (!(await confirmWorkspace(result.proposal, abort.current.signal))) {
      setNote("작업을 취소했습니다.");
      return;
    }
    const done = await naverRequest(
      "execute",
      {},
      { id: result.proposal.id },
      abort.current.signal,
    );
    setNote(done.text);
    if (action.operation === "send") {
      setDraft(emptyDraft());
      setDirty(false);
    } else if (action.operation === "syncDraft") {
      setDraft(done.draft);
      setDirty(false);
    } else await list();
  }
  async function save() {
    const result = await naverRequest("draft", {}, draft, abort.current.signal);
    setDraft(result.draft);
    setDirty(false);
    sessionStorage.setItem(MAIL_PROVIDER, "naver");
    setNote(
      "앱 초안을 NAS에 암호화 저장했습니다. 재시작 후에도 유지됩니다. 네이버 저장 버튼을 누르면 임시보관함에도 저장합니다.",
    );
  }
  return (
    <section aria-label="네이버 메일 연결" className="space-y-4 text-sm">
      <p className="text-muted">
        네이버 메일을 읽고 검색하거나, 초안을 고쳐 보낼 수 있습니다. 읽기와 음성 낭독은 읽음 상태를
        바꾸지 않습니다.
      </p>
      <p role="status">
        {status
          ? status.connected
            ? `연결됨 · ${status.email}`
            : "네이버 메일 연결 대기"
          : error
            ? "서버 연결 확인 필요"
            : "연결 상태 확인 중…"}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={control} disabled={busy} onClick={() => void run(refresh)}>
          연결 상태 확인
        </button>
        {status?.connected && (
          <button
            className={control}
            disabled={busy}
            onClick={() => {
              if (window.confirm("저장된 네이버 연결 정보와 앱 초안을 지울까요?"))
                void run(async () => {
                  await naverRequest("disconnect", {}, {}, abort.current.signal);
                  setStatus({ connected: false, email: null });
                  setItems([]);
                  setDetail(null);
                  setDraft(emptyDraft());
                  setBoxes([]);
                  setLoaded(false);
                  sessionStorage.removeItem(NAVER_SELECTION);
                  sessionStorage.removeItem(MAIL_PROVIDER);
                  setNote(
                    "앱 연결을 해제했습니다. 네이버 보안 설정에서 앱 비밀번호도 폐기할 수 있습니다.",
                  );
                });
            }}
          >
            연결 해제
          </button>
        )}
      </div>
      {!status?.connected && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const credentials = { email, password };
            setPassword("");
            void run(async () => {
              await naverRequest("connect", {}, credentials, abort.current.signal);
              await refresh();
              setNote("네이버 IMAP·SMTP 인증을 확인했습니다.");
            });
          }}
        >
          <label className="block space-y-2">
            <span>네이버 메일 주소</span>
            <input
              className={`${control} w-full`}
              type="email"
              autoComplete="username"
              placeholder="name@naver.com"
              value={email}
              maxLength={254}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block space-y-2">
            <span>애플리케이션 비밀번호</span>
            <input
              className={`${control} w-full`}
              type="password"
              autoComplete="off"
              value={password}
              maxLength={128}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <p className="text-muted">
            네이버 메일의 IMAP 사용을 켜고, 2단계 인증에서 앱 비밀번호를 발급하세요. 일반 로그인
            비밀번호를 입력하지 마세요. 연결 정보는 서버에 암호화해 보관합니다.
          </p>
          <div className="flex flex-wrap gap-3 text-muted">
            <a
              className="underline"
              href="https://help.naver.com/service/30029/contents/21344?lang=ko"
              target="_blank"
              rel="noreferrer"
            >
              IMAP 설정 안내
            </a>
            <a
              className="underline"
              href="https://help.naver.com/service/30029/bookmark/24347?lang=ko&osType=COMMONOS"
              target="_blank"
              rel="noreferrer"
            >
              앱 비밀번호 안내
            </a>
          </div>
          <button className={`${control} w-full`} disabled={busy || !status || !password || !email}>
            연결 확인 후 저장
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-muted">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="whitespace-pre-wrap break-words text-muted">
          {note}
        </p>
      )}
      {status?.connected && (
        <>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(list);
            }}
          >
            <label className="block space-y-2">
              <span>메일함</span>
              <select
                className={`${control} w-full`}
                value={mailbox}
                disabled={busy}
                onChange={(e) => {
                  setMailbox(e.target.value);
                  setItems([]);
                  setDetail(null);
                  setLoaded(false);
                }}
              >
                {!boxes.some((box) => box.path === "INBOX") && (
                  <option value="INBOX">받은메일함</option>
                )}
                {boxes.map((box) => (
                  <option key={box.path} value={box.path}>
                    {box.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <input
                aria-label="네이버 메일 검색어"
                className={`${control} min-w-0 flex-1`}
                value={query}
                maxLength={500}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제목·보낸 사람·본문 검색"
              />
              <button className={control} disabled={busy}>
                {busy ? "조회 중…" : "조회"}
              </button>
            </div>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={unread}
                disabled={busy}
                onChange={(e) => setUnread(e.target.checked)}
              />
              안 읽은 메일만
            </label>
            <p className="text-muted">검색 결과 중 최근 20통을 표시합니다.</p>
            {query.trim() && (
              <p className="text-muted">
                제목·보낸 사람은 최근 100통을 추가 확인합니다. 본문 검색은 메일 서버의 결과를
                사용합니다.
              </p>
            )}
          </form>
          {loaded && !items.length && <p>조회 결과가 없습니다.</p>}
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li key={item.id}>
                <button
                  className="min-h-11 w-full rounded-xl border border-line p-3 text-left disabled:opacity-40"
                  disabled={busy}
                  onClick={() => void run(() => open(item))}
                >
                  <span className="block break-words font-medium">
                    {index + 1}. {item.subject}
                    {item.unread ? " · 안읽음" : ""}
                    {item.flagged ? " · 중요" : ""}
                  </span>
                  <span className="mt-1 block break-words text-muted">{item.from}</span>
                  <span className="mt-1 block text-muted">
                    {item.date ? new Date(item.date).toLocaleString("ko-KR") : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {detail && (
            <article className="space-y-3 rounded-xl border border-line p-3">
              <h3 className="break-words font-medium">{detail.subject}</h3>
              <p className="break-words text-muted">{detail.from}</p>
              {detail.flagged && <p className="text-primary">중요 메일</p>}
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans">
                {detail.text || "읽을 수 있는 본문이 없습니다."}
              </pre>
              {detail.attachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted">
                    첨부파일은 본문 낭독에 포함하지 않습니다. 다운로드는 파일당 10MB 이하를
                    지원합니다.
                  </p>
                  {detail.attachments.map((file, index) => (
                    <button
                      key={index}
                      className={`${control} w-full break-all py-2 text-left`}
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          downloadNaverAttachment(detail.id, index, abort.current.signal),
                        )
                      }
                    >
                      {file.name} · {file.size} bytes · 다운로드
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {boxes.some((box) => box.path === mailbox && box.specialUse === "\\Drafts") && (
                  <button
                    className={control}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await naverRequest(
                          "loadDraft",
                          {},
                          { id: detail.id },
                          abort.current.signal,
                        );
                        setDraft(result.draft);
                        setDirty(false);
                        setNote(
                          "네이버 초안을 불러왔습니다. 수정 후 네이버 저장 버튼을 눌러주세요.",
                        );
                      })
                    }
                  >
                    초안으로 불러오기
                  </button>
                )}
                <button
                  className={control}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await naverRequest(
                        "reply",
                        {},
                        { id: detail.id },
                        abort.current.signal,
                      );
                      setDraft(result.draft);
                      setDirty(false);
                    })
                  }
                >
                  답장 초안
                </button>
                <button
                  className={control}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await naverRequest(
                        "forward",
                        {},
                        { id: detail.id, includeAttachments: forwardAttachments },
                        abort.current.signal,
                      );
                      setDraft(result.draft);
                      setDirty(false);
                      setNote(
                        forwardAttachments
                          ? "원본 첨부파일을 포함한 전달 초안을 작성했습니다. 받는 사람과 첨부를 확인하세요."
                          : "첨부파일을 제외한 전달 초안을 작성했습니다.",
                      );
                    })
                  }
                >
                  전달 초안
                </button>
                <button
                  className={control}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      mutate({ operation: "mark", id: detail.id, unread: !detail.unread }),
                    )
                  }
                >
                  {detail.unread ? "읽음으로 변경" : "안읽음으로 변경"}
                </button>
                <button
                  className={control}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      mutate({ operation: "flag", id: detail.id, flagged: !detail.flagged }),
                    )
                  }
                >
                  {detail.flagged ? "중요 표시 해제" : "중요 표시"}
                </button>
                <button
                  className={control}
                  disabled={busy}
                  onClick={() => void run(() => mutate({ operation: "trash", id: detail.id }))}
                >
                  휴지통으로 이동
                </button>
              </div>
              {detail.attachments.length > 0 && (
                <label className="flex min-h-11 items-center gap-2 text-muted">
                  <input
                    type="checkbox"
                    checked={forwardAttachments}
                    disabled={busy}
                    onChange={(event) => setForwardAttachments(event.target.checked)}
                  />
                  전달 시 원본 첨부파일 포함
                </label>
              )}
              <div className="flex gap-2">
                <select
                  aria-label="이동할 네이버 메일함"
                  className={`${control} min-w-0 flex-1`}
                  value={destination}
                  disabled={busy}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">이동할 메일함 선택</option>
                  {boxes
                    .filter((box) => box.path !== mailbox)
                    .map((box) => (
                      <option key={box.path} value={box.path}>
                        {box.name}
                      </option>
                    ))}
                </select>
                <button
                  className={control}
                  disabled={busy || !destination}
                  onClick={() =>
                    void run(() =>
                      mutate({ operation: "move", id: detail.id, mailbox: destination }),
                    )
                  }
                >
                  이동 확인
                </button>
              </div>
              <p className="text-muted">
                “네이버 이 메일 요약해줘” 또는 “원문 읽어줘”라고 대화에서 요청할 수 있습니다.
              </p>
            </article>
          )}
          <div className="space-y-3 rounded-xl border border-line p-3">
            <h3 className="font-medium">메일 초안</h3>
            <p className="text-muted">
              앱 초안 저장은 NAS에 암호화 보관합니다. 네이버에 저장한 초안은 임시보관함에서 다시
              불러와 수정할 수 있습니다. 본문은 일반 텍스트로 편집합니다.
            </p>
            <label className="block space-y-2">
              <span>받는 사람</span>
              <input
                className={`${control} w-full`}
                value={draft.to}
                disabled={busy}
                maxLength={2600}
                onChange={(e) => edit({ to: e.target.value })}
                placeholder="이메일 주소 · 여러 명은 쉼표로 구분"
              />
            </label>
            <label className="block space-y-2">
              <span>참조(CC)</span>
              <input
                className={`${control} w-full`}
                value={draft.cc || ""}
                disabled={busy}
                maxLength={2600}
                onChange={(e) => edit({ cc: e.target.value })}
                placeholder="참조할 이메일 주소 · 선택 사항"
              />
            </label>
            <label className="block space-y-2">
              <span>숨은참조(BCC)</span>
              <input
                className={`${control} w-full`}
                value={draft.bcc || ""}
                disabled={busy}
                maxLength={2600}
                onChange={(e) => edit({ bcc: e.target.value })}
                placeholder="다른 수신자에게 표시하지 않을 주소 · 선택 사항"
              />
            </label>
            <p className="text-muted">받는 사람·참조·숨은참조는 합계 10명까지 지원합니다.</p>
            <label className="block space-y-2">
              <span>제목</span>
              <input
                className={`${control} w-full`}
                value={draft.subject}
                disabled={busy}
                maxLength={500}
                onChange={(e) => edit({ subject: e.target.value })}
              />
            </label>
            <label className="block space-y-2">
              <span>본문</span>
              <textarea
                className={`${control} min-h-32 w-full py-3`}
                value={draft.text}
                disabled={busy}
                maxLength={50000}
                onChange={(e) => edit({ text: e.target.value })}
              />
            </label>
            <label className="block space-y-2">
              <span>첨부파일 · 최대 5개, 합계 10MB</span>
              <input
                type="file"
                multiple
                disabled={busy}
                className="block w-full"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  if (
                    files.length > 5 ||
                    files.reduce((sum, file) => sum + file.size, 0) > NAVER_ATTACHMENT_LIMIT
                  ) {
                    setError("첨부파일은 최대 5개, 합계 10MB 이하로 선택하세요.");
                    return;
                  }
                  void run(async () => {
                    const attachments = await Promise.all(
                      files.map(async (file) => {
                        const bytes = new Uint8Array(await file.arrayBuffer());
                        let binary = "";
                        for (let index = 0; index < bytes.length; index += 8192)
                          binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
                        return {
                          name: file.name,
                          mimeType: file.type || "application/octet-stream",
                          data: btoa(binary),
                        };
                      }),
                    );
                    edit({ attachments });
                  });
                }}
              />
            </label>
            {draft.attachments.length > 0 && (
              <div className="space-y-1">
                {draft.attachments.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 break-words">{file.name}</span>
                    <button
                      className={control}
                      disabled={busy}
                      onClick={() =>
                        edit({ attachments: draft.attachments.filter((_, i) => i !== index) })
                      }
                    >
                      제거
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button className={control} disabled={busy} onClick={() => void run(save)}>
                초안 저장
              </button>
              <button
                className={control}
                disabled={
                  busy ||
                  (!draft.to &&
                    !draft.cc &&
                    !draft.bcc &&
                    !draft.subject &&
                    !draft.text &&
                    !draft.attachments.length)
                }
                onClick={() =>
                  void run(async () => {
                    if (dirty) await save();
                    await mutate({ operation: "syncDraft", draft });
                  })
                }
              >
                네이버 임시보관함에 저장
              </button>
              <button
                className={control}
                disabled={busy || !(draft.to || draft.cc || draft.bcc) || !draft.text}
                onClick={() =>
                  void run(async () => {
                    if (dirty) await save();
                    await mutate({ operation: "send", draft });
                  })
                }
              >
                발송 내용 확인
              </button>
              <button
                className={control}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await naverRequest("clearDraft", {}, {}, abort.current.signal);
                    setDraft(emptyDraft());
                    setDirty(false);
                    setNote(
                      "새 앱 초안을 시작합니다. 기존 네이버 초안은 임시보관함에 남아 있습니다.",
                    );
                  })
                }
              >
                새 초안
              </button>
            </div>
            <p className="text-muted">
              “네이버 답장 초안 써줘”, “초안을 더 짧게 바꿔줘”, “초안 보내줘”도 사용할 수 있습니다.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
