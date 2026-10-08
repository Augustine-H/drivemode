"""Explicit validation mode: fixed synthetic data, no IMAP connection."""
import datetime as dt
from .mail import MailError,page_values,positive


class SyntheticMail:
    """Deterministic dataset, with no connection to any mail provider."""
    BODY = '합성 테스트 메일입니다. 회의는 2026년 10월 9일입니다.'
    ITEM = {'folder': 'INBOX', 'uid': 1, 'uidvalidity': 77,
            'from': '테스트 <canary@example.test>', 'subject': '[CANARY] 한국어 안내',
            'date': '2026-10-08T09:00:00+09:00', 'flags': [], 'size': 160}

    def page(self, items, limit, offset):
        page_values(limit, offset)
        return {'canary': True, 'items': items[offset:offset+limit],
                'next_offset': offset+limit if offset+limit < len(items) else None}

    def folders(self, limit=10, offset=0):
        return self.page([{'folder': 'INBOX', 'selectable': True}], limit, offset)

    def search(self, folder='INBOX', limit=10, offset=0, sender='', subject='',
               since='', before='', body='', unread=False):
        self.folder(folder)
        date = dt.date(2026, 10, 8)
        try:
            matches = ((not since or date >= dt.date.fromisoformat(since))
                       and (not before or date < dt.date.fromisoformat(before))
                       and sender.casefold() in self.ITEM['from'].casefold()
                       and subject.casefold() in self.ITEM['subject'].casefold()
                       and body.casefold() in self.BODY.casefold())
        except ValueError:
            raise MailError('invalid_input') from None
        return self.page([dict(self.ITEM)] if matches else [], limit, offset)

    def folder(self, folder):
        if folder != 'INBOX':
            raise MailError('mailbox_unavailable')

    def identity(self, folder, uid, uidvalidity):
        self.folder(folder)
        positive(uid); positive(uidvalidity)
        if uidvalidity != 77:
            raise MailError('uidvalidity_changed')
        if uid != 1:
            raise MailError('message_not_found')

    def message(self, folder, uid, uidvalidity, body_chars=4000, body_offset=0):
        self.identity(folder, uid, uidvalidity)
        if not 1 <= body_chars <= 8000 or not 0 <= body_offset <= 16000:
            raise MailError('invalid_input')
        end = body_offset + body_chars
        return {**self.ITEM, 'canary': True, 'body': self.BODY[body_offset:end],
                'untrusted_content': True, 'truncated': end < len(self.BODY),
                'next_body_offset': end if end < len(self.BODY) else None}

    def attachments(self, folder, uid, uidvalidity, limit=10, offset=0):
        self.identity(folder, uid, uidvalidity)
        return self.page([{'name': '합성.pdf', 'size': 128, 'mime_type': 'application/pdf'}], limit, offset)

    def thread(self, folder, uid, uidvalidity, limit=10, offset=0):
        self.identity(folder, uid, uidvalidity)
        return {**self.page([dict(self.ITEM)], limit, offset), 'supported': True}

