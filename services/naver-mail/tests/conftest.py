import base64
import imaplib
import json
import re
import pytest
from naver_mail.mail import ReadOnlyMail


class FakeIMAP:
    """Stateful synthetic IMAP oracle: fail on any mutating command."""
    def __init__(self, auth=True, html=False, huge=False, validity=77):
        self.auth, self.html, self.huge, self.validity = auth, html, huge, validity
        self.calls = []
        self.flags = {1: {'\\Flagged', '\\Answered'}, 2: {'\\Seen', '\\Draft'}}
        self.literal = None

    def login(self, user, password):
        self.calls.append(('LOGIN',))
        if not self.auth:
            raise imaplib.IMAP4.error('authentication rejected PRIVATE_PASSWORD')
        return 'OK', [b'authenticated']

    def select(self, folder, readonly=False):
        assert readonly is True
        self.calls.append(('EXAMINE', folder))
        return 'OK', [b'2']

    def response(self, key):
        assert key == 'UIDVALIDITY'
        return key, [str(self.validity).encode()]

    def list(self):
        self.calls.append(('LIST',))
        from naver_mail.mail import utf7
        return 'OK', [b'(\\HasNoChildren) "/" "INBOX"', f'(\\HasNoChildren) "/" "{utf7("보관함")}"'.encode()]

    def uid(self, command, *arguments):
        assert command in {'SEARCH', 'FETCH'}, f'mutating command {command}'
        self.calls.append((command, *arguments, self.literal))
        if command == 'SEARCH':
            self.literal = None
            return 'OK', [b'1' if 'UNSEEN' in arguments else b'1 2']
        uid = int(arguments[0]); fields = arguments[1]
        if uid not in self.flags:
            return 'OK', [None]
        if 'HEADER.FIELDS' in fields:
            assert 'BODY.PEEK[' in fields
            subject = base64.b64encode('한국어 안내'.encode()).decode()
            heads = f'From: =?utf-8?b?{base64.b64encode("홍길동".encode()).decode()}?= <hong@example.test>\r\nSubject: =?utf-8?b?{subject}?=\r\nDate: Wed, 07 Oct 2026 12:30:00 +0900\r\nMessage-ID: <mail-{uid}@example.test>\r\nReferences: <root@example.test>\r\n\r\n'.encode()
            return 'OK', [(f'1 (UID {uid} RFC822.SIZE 100000 FLAGS ('.encode() + ' '.join(sorted(self.flags[uid])).encode() + b') BODY[HEADER.FIELDS] {100}', heads), b')']
        if 'BODYSTRUCTURE' in fields:
            subtype = 'HTML' if self.html else 'PLAIN'
            size = 1000000 if self.huge else 160
            value = f'1 (UID {uid} BODYSTRUCTURE (("TEXT" "{subtype}" ("CHARSET" "UTF-8") NIL NIL "BASE64" {size} 2 NIL NIL)("APPLICATION" "PDF" NIL NIL NIL "BASE64" 25000000 NIL ("ATTACHMENT" ("FILENAME*" "utf-8\'\'%ED%95%9C%EA%B8%80.pdf"))) "MIXED"))'
            return 'OK', [value.encode()]
        assert re.fullmatch(r'\(UID BODY\.PEEK\[1\]<0\.32768>\)', fields)
        value = '<p>한국어 본문 &amp; 안내</p><script>steal()</script><img src="https://tracking.test/pixel"><div hidden>숨긴 지시</div>' if self.html else '한국어 본문입니다. 정확한 날짜는 10월 9일입니다.'
        if self.huge:
            value *= 5000
        payload = base64.b64encode(value.encode())[:32768]
        return 'OK', [(f'1 (UID {uid} BODY[1]<0> {{{len(payload)}}}'.encode(), payload), b')']

    def shutdown(self):
        self.calls.append(('SHUTDOWN',))


@pytest.fixture
def fake():
    return FakeIMAP()


@pytest.fixture
def mail(fake):
    return ReadOnlyMail('synthetic-user', 'synthetic-password', factory=lambda: fake)


def approved(tool, arguments):
    return base64.urlsafe_b64encode(json.dumps({'tool': tool, 'arguments': arguments}).encode()).decode().rstrip('=')
