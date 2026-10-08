import copy
import imaplib
import pytest
from naver_mail.mail import MailError, ReadOnlyMail, safe_body, utf7, unutf7, bounded, BoundedIMAP, sexp
from conftest import FakeIMAP


def test_auth_and_invalid_credentials(mail, fake):
    assert len(mail.search()['items']) == 2
    assert fake.calls[0] == ('LOGIN',)
    bad = ReadOnlyMail('user', 'private', factory=lambda: FakeIMAP(auth=False))
    with pytest.raises(MailError, match='imap_auth_failed') as error:
        bad.search()
    assert 'PRIVATE_PASSWORD' not in str(error.value)


def test_korean_headers_body_and_flags(mail, fake):
    before = copy.deepcopy(fake.flags)
    rows = mail.search()
    assert rows['items'][0]['subject'] == '한국어 안내'
    assert rows['items'][0]['from'] == '홍길동 <hong@example.test>'
    detail = mail.message('INBOX', 1, 77)
    assert '한국어 본문입니다' in detail['body']
    assert detail['untrusted_content'] is True
    assert fake.flags == before  # SEEN plus all other flags unchanged.
    assert all(c[0] in {'LOGIN', 'EXAMINE', 'SEARCH', 'FETCH'} for c in fake.calls)
    assert all('BODY.PEEK' in c[2] for c in fake.calls if c[0] == 'FETCH' and 'BODYSTRUCTURE' not in c[2])


def test_html_safe_conversion():
    fake = FakeIMAP(html=True)
    value = ReadOnlyMail('user', 'password', factory=lambda: fake).message('INBOX', 1, 77)
    assert value['body'] == '한국어 본문 & 안내'
    assert 'steal' not in value['body'] and 'tracking' not in value['body'] and '숨긴' not in value['body']
    assert safe_body('<svg><text>hidden</text></svg><p>safe</p>', True) == 'safe'


def test_date_search_korean_literal_intersection_and_unread(mail, fake):
    result = mail.search(since='2026-10-01', before='2026-10-09', sender='홍길동', subject='한국어', body='안내', unread=True)
    assert len(result['items']) == 1
    calls = [c for c in fake.calls if c[0] == 'SEARCH']
    assert calls[0][1:7] == (None, 'UNSEEN', 'SINCE', '01-Oct-2026', 'BEFORE', '09-Oct-2026')
    assert calls[1][1:] == ('CHARSET', 'UTF-8', 'FROM', '홍길동'.encode())
    assert calls[2][-1] == '한국어'.encode()
    assert calls[3][-1] == '안내'.encode()


@pytest.mark.parametrize('params', [{'limit': 0}, {'limit': True}, {'limit': 21}, {'offset': -1}, {'since': '2026-02-30'}, {'since': '2026-10-08', 'before': '2026-10-01'}, {'folder': 'INBOX\r\nSTORE 1 FLAGS (\\Seen)'}, {'subject': 'x\r\nDELETE INBOX'}])
def test_validation(mail, params):
    with pytest.raises(MailError):
        mail.search(**params)


def test_pagination_and_uidvalidity(mail):
    first = mail.search(limit=1)
    second = mail.search(limit=1, offset=first['next_offset'])
    assert [first['items'][0]['uid'], second['items'][0]['uid']] == [2, 1]
    assert first['uidvalidity'] == 77 and second['next_offset'] is None
    with pytest.raises(MailError, match='uidvalidity_changed'):
        mail.message('INBOX', 1, 76)


@pytest.mark.parametrize('validity', [0, -1, 4294967296])
def test_unsupported_uidvalidity_blocks_search_and_message_before_data_read(validity):
    fake = FakeIMAP(validity=validity)
    reader = ReadOnlyMail('synthetic-user', 'synthetic-password', factory=lambda: fake)
    try:
        with pytest.raises(MailError, match='^uidvalidity_unsupported$'):
            reader.search(limit=1)
        with pytest.raises(MailError, match='^uidvalidity_unsupported$'):
            reader.message('INBOX', 1, 77)
        assert not any(call[0] in {'SEARCH', 'FETCH'} for call in fake.calls)
    finally:
        reader.close()


def test_large_response_is_bounded_without_attachment_download():
    fake = FakeIMAP(huge=True)
    value = ReadOnlyMail('user', 'password', factory=lambda: fake).message('INBOX', 1, 77, body_chars=100)
    assert len(value['body']) == 100 and value['truncated'] and value['next_body_offset'] == 100
    assert not any('BODY.PEEK[2]' in str(call) for call in fake.calls)
    with pytest.raises(MailError, match='response_too_large'):
        bounded({'body': '한' * 30000})
    with pytest.raises(MailError, match='imap_literal_too_large'):
        BoundedIMAP.read(object(), 65537)


def test_attachment_metadata_only(mail, fake):
    result = mail.attachments('INBOX', 1, 77, limit=1)
    assert result['items'] == [{'name': '한글.pdf', 'size': 25000000, 'mime_type': 'application/pdf'}]
    assert not any('BODY.PEEK' in str(call) for call in fake.calls)


def test_attachment_literal_filename_with_parentheses_and_utf8(mail, fake):
    original = fake.uid
    filename = '한글 (계약).pdf'.encode()
    def fetch(command, *args):
        if command == 'FETCH' and 'BODYSTRUCTURE' in args[1]:
            prefix = b'1 (UID 1 BODYSTRUCTURE ("APPLICATION" "PDF" NIL NIL NIL "BASE64" 100 NIL ("ATTACHMENT" ("FILENAME" {' + str(len(filename)).encode() + b'}'
            return 'OK', [(prefix, filename), b'))))']
        return original(command, *args)
    fake.uid = fetch
    assert mail.attachments('INBOX', 1, 77)['items'][0]['name'] == '한글 (계약).pdf'
    with pytest.raises(MailError):
        sexp(b'("a" {500}\r\nshort)')


def test_folder_encoding(mail):
    assert unutf7(utf7('한글 & 보관함')) == '한글 & 보관함'
    assert mail.folders(limit=1)['next_offset'] == 1
    assert mail.folders(offset=1)['items'][0]['folder'] == '보관함'


def test_thread_is_header_related_only(mail, fake):
    result = mail.thread('INBOX', 1, 77)
    assert result['supported'] is True and len(result['items']) == 2
    assert any('HEADER References' in str(c) for c in fake.calls if c[0] == 'SEARCH')
    assert all('HEADER.FIELDS' in c[2] for c in fake.calls if c[0] == 'FETCH')


def test_reconnect_after_socket_failure_and_fresh_process():
    first, second = FakeIMAP(), FakeIMAP()
    first.uid = lambda *_: (_ for _ in ()).throw(imaplib.IMAP4.abort('disconnected'))
    connections = iter([first, second])
    mail = ReadOnlyMail('user', 'password', factory=lambda: next(connections))
    assert len(mail.search()['items']) == 2
    assert ('SHUTDOWN',) in first.calls
    restarted = ReadOnlyMail('user', 'password', factory=FakeIMAP)
    assert restarted.message('INBOX', 1, 77)['body']


def test_write_commands_impossible(mail, fake):
    mail.search()
    for command in ['STORE', 'COPY', 'MOVE', 'APPEND', 'EXPUNGE', 'DELETE', 'CREATE']:
        with pytest.raises(MailError, match='read_only_violation'):
            mail.read_uid(fake, command, '1')
