export const NAVER_MAIL_TOOLS = [
  "mail_list_folders",
  "mail_list_recent",
  "mail_search",
  "mail_get_message",
  "mail_get_unread",
  "mail_list_attachments",
  "mail_get_thread",
] as const;
export type NaverMailTool = (typeof NAVER_MAIL_TOOLS)[number];
export type NaverMailRef = {
  folder: string;
  uid: number;
  uidvalidity: number;
  from?: string;
  subject?: string;
  date?: string;
};
export type NaverMailReply = {
  text: string;
  voiceText: string;
  items: NaverMailRef[];
  notice: string;
  nextOffset?: number | null;
  nextBodyOffset?: number | null;
  truncated?: boolean;
};
export const NAVER_MAIL_NOTICE =
  "요청에 필요한 메일 데이터는 요약·도구 처리 과정에서 xAI로 전달되며 xAI의 데이터 처리 정책이 적용될 수 있습니다. 이 결과는 대화 기억과 자동 백업에 저장하지 않습니다.";

export function naverMailIntent(message: string, hasSelection = false): boolean {
  if (/(?:gmail|구글|google)/iu.test(message)) return false;
  if (
    /(?:네이버|naver).*?(?:이?메일|mail)/iu.test(message) ||
    /(?:이?메일|mail).*?(?:네이버|naver)/iu.test(message)
  )
    return true;
  return (
    hasSelection &&
    /^(?:(?:첫\s*번째|두\s*번째|세\s*번째|마지막|\d+\s*(?:번째|번)|이|그|해당|방금)\s*메일|원문|전문|요약|첨부파일|관련\s*메일)/u.test(
      message,
    )
  );
}
export function naverMailWriteIntent(message: string): boolean {
  return /(?:답장|회신|발송|전송|삭제|휴지통|이동|업로드|플래그|읽음\s*(?:으로|표시|변경)|안\s*읽음\s*(?:으로|표시|변경)|메일.*(?:보내|지워))/u.test(
    message,
  );
}
