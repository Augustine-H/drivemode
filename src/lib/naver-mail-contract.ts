import { z } from "zod";

export const NAVER_ATTACHMENT_LIMIT = 10_000_000;
export const NAVER_SOURCE_LIMIT = 20_000_000;

export function naverBase64Bytes(data: string) {
  return (data.length * 3) / 4 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

const address = z.string().trim().max(254).email();
const recipients = z
  .string()
  .trim()
  .max(2600)
  .refine((value) => {
    const parts = value.split(/[,;]/);
    return (
      parts.length >= 1 &&
      parts.length <= 10 &&
      parts.every((part) => address.safeParse(part.trim()).success)
    );
  }, "이메일 주소를 쉼표로 구분하세요.");
const optionalRecipients = z.union([recipients, z.literal("")]);
const recipientCount = (value: { to: string; cc?: string; bcc?: string }) =>
  [value.to, value.cc, value.bcc].flatMap((field) => (field ? field.split(/[,;]/) : [])).length;
export const naverAttachmentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\r\n/\\]+$/),
    data: z
      .string()
      .max(13_333_336)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0),
    mimeType: z
      .string()
      .max(100)
      .regex(/^[\w.+-]+\/[\w.+-]+$/),
  })
  .strict();
export const naverDraftSchema = z
  .object({
    to: optionalRecipients,
    cc: optionalRecipients.optional(),
    bcc: optionalRecipients.optional(),
    subject: z
      .string()
      .max(500)
      .regex(/^[^\r\n]*$/),
    text: z.string().min(1).max(50000),
    attachments: z.array(naverAttachmentSchema).max(5).default([]),
    inReplyTo: z
      .string()
      .max(500)
      .regex(/^[^\r\n]*$/)
      .optional(),
    references: z
      .string()
      .max(2000)
      .regex(/^[^\r\n]*$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) => recipientCount(value) >= 1 && recipientCount(value) <= 10,
    "받는 사람·참조·숨은참조는 합계 1~10명이어야 합니다.",
  )
  .refine(
    (value) =>
      value.attachments.reduce((sum, item) => sum + naverBase64Bytes(item.data), 0) <=
      NAVER_ATTACHMENT_LIMIT,
    "첨부파일은 합계 10MB 이하로 선택하세요.",
  );
export type NaverDraft = z.infer<typeof naverDraftSchema>;
export const naverEditableDraftSchema = z
  .object({
    to: z.union([recipients, z.literal("")]).default(""),
    cc: optionalRecipients.optional(),
    bcc: optionalRecipients.optional(),
    subject: z
      .string()
      .max(500)
      .regex(/^[^\r\n]*$/)
      .default(""),
    text: z.string().max(50000).default(""),
    attachments: z.array(naverAttachmentSchema).max(5).default([]),
    inReplyTo: z
      .string()
      .max(500)
      .regex(/^[^\r\n]*$/)
      .optional(),
    references: z
      .string()
      .max(2000)
      .regex(/^[^\r\n]*$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) => recipientCount(value) <= 10,
    "받는 사람·참조·숨은참조는 합계 10명까지 지원합니다.",
  )
  .refine(
    (value) =>
      value.attachments.reduce((sum, item) => sum + naverBase64Bytes(item.data), 0) <=
      NAVER_ATTACHMENT_LIMIT,
  );
export const naverActionSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("send"), draft: naverDraftSchema }),
  z.object({ operation: z.literal("syncDraft"), draft: naverEditableDraftSchema }),
  z.object({ operation: z.literal("mark"), id: z.string().max(1500), unread: z.boolean() }),
  z.object({
    operation: z.literal("move"),
    id: z.string().max(1500),
    mailbox: z.string().min(1).max(300),
  }),
  z.object({ operation: z.literal("trash"), id: z.string().max(1500) }),
  z.object({ operation: z.literal("flag"), id: z.string().max(1500), flagged: z.boolean() }),
]);
export type NaverAction = z.infer<typeof naverActionSchema>;
export type NaverDraftSync = { id: string; fingerprint: string };
export type NaverSavedDraft = { generation: string; draft: NaverDraft; sync?: NaverDraftSync };
export type NaverMailItem = {
  id: string;
  subject: string;
  from: string;
  date: string;
  unread: boolean;
  flagged?: boolean;
};
export type NaverMailMessage = NaverMailItem & {
  text: string;
  replyTo: string;
  messageId: string;
  references: string;
  inReplyTo?: string;
  attachments: { name: string; size: number }[];
  isDraft?: boolean;
};
export const NAVER_SELECTION = "voicegrok-navermail-selection";
export const MAIL_PROVIDER = "voicegrok-mail-provider";
export const NAVER_DRAFT_EVENT = "voicegrok-navermail-draft";
export function naverIntent(message: string, selected = false) {
  if (
    /(?:보이스\s*메일|음성\s*메일)/u.test(message) ||
    /(?:gmail|구글|google|캘린더|일정|drive|드라이브)/iu.test(message)
  )
    return false;
  return (
    (/(?:네이버|naver)/iu.test(message) && /(?:메일|이메일|편지|답장|초안)/u.test(message)) ||
    (selected &&
      /(?:메일|이메일|답장|초안|원문|전문|요약|읽어|짧게|길게|공손|받는\s*사람|제목|본문|보내|발송|전달|읽음|안읽음|휴지통|중요|별표)/u.test(
        message,
      ))
  );
}
