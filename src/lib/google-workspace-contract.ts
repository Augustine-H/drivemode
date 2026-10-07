export const GOOGLE_REDIRECT_URI = 'https://ds218-hmh.tail15dbbb.ts.net:8445/api/google-workspace/callback';
export const GOOGLE_BACKEND_ORIGIN = new URL(GOOGLE_REDIRECT_URI).origin;
export const GOOGLE_APP_ORIGIN = 'https://drivemode.grok.me';
export const WORKSPACE_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  drive: 'https://www.googleapis.com/auth/drive.file',
  gmail: 'https://www.googleapis.com/auth/gmail.modify',
} as const;
export const OAUTH_SCOPES = [...Object.values(WORKSPACE_SCOPES), 'openid', 'email'];
export type WorkspaceAction = {
  operation: 'sendMail'|'replyMail'|'markMail'|'createEvent'|'updateEvent'|'deleteEvent'|'createFile'|'updateFile'|'deleteFile'|'selfTest';
  id?: string; to?: string; subject?: string; text?: string; unread?: boolean;
  calendarId?: string; start?: string; end?: string; name?: string;
  data?:string; mimeType?:string;
};
export type WorkspaceProposal = {id:string; title:string; details:string; expiresAt:number};
export function workspaceIntent(message:string) {
  if(/(?:보이스\s*메일|음성\s*메일|google\s*(?:cloud\s*)?tts|구글\s*(?:클라우드\s*)?(?:tts|목소리|음성))/i.test(message))return false;
  return /(?:gmail|구글|google|drive|드라이브|캘린더|메일|이메일|답장|일정)/i.test(message);
}
