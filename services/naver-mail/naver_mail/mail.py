"""Bounded IMAP reads. All selected mailboxes use EXAMINE, never SELECT."""
import base64
import email
import imaplib
import json
import re
import socket
import ssl
import threading
import time
from contextlib import contextmanager
from datetime import date
from email.header import decode_header, make_header
from email.parser import BytesParser
from email.policy import default
from html.parser import HTMLParser

MAX_RESPONSE = 65536
MAX_HEADER = 8192
MAX_BODY = 32768
MAX_MATCHES = 20000


class MailError(Exception):
    """Only fixed public error codes may leave this module."""


class BoundedIMAP(imaplib.IMAP4_SSL):
    def read(self, size):
        if size > MAX_RESPONSE:
            raise MailError('imap_literal_too_large')
        return super().read(size)


def text(value, limit=200):
    if not isinstance(value, str) or not value or len(value) > limit or any(ord(c) < 32 for c in value):
        raise MailError("invalid_input")
    return value


def positive(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 4294967295:
        raise MailError("invalid_input")
    return value


def page_values(limit, offset):
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20:
        raise MailError("invalid_input")
    if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset <= MAX_MATCHES:
        raise MailError("invalid_input")


def quoted(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def utf7(value):
    """IMAP modified UTF-7; Python's ordinary UTF-7 has a different alphabet."""
    def encode(match):
        return '&' + base64.b64encode(match.group().encode('utf-16be')).decode().rstrip('=').replace('/', ',') + '-'
    return re.sub(r'[^\x20-\x7e]+', encode, value.replace('&', '&-'))


def unutf7(value):
    def decode(match):
        encoded = match[1].replace(',', '/')
        if not encoded:
            return '&'
        return base64.b64decode(encoded + '=' * (-len(encoded) % 4)).decode('utf-16be')
    try:
        return re.sub(r'&([^-]*)-', decode, value)
    except (ValueError, UnicodeError):
        raise MailError('invalid_folder_response') from None


def header(value, limit=300):
    try:
        decoded = str(make_header(decode_header(str(value or ''))))
    except (LookupError, UnicodeError):
        decoded = str(value or '')
    return re.sub(r'[\x00-\x1f\x7f]', ' ', decoded)[:limit]


class SafeHTML(HTMLParser):
    blocked = {'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'head', 'template', 'noscript'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        style = re.sub(r'\s', '', attrs.get('style', '')).lower()
        hidden = tag in self.blocked or 'hidden' in attrs or attrs.get('aria-hidden') == 'true' or 'display:none' in style or 'visibility:hidden' in style
        if tag not in {'br', 'img', 'hr', 'input', 'meta', 'link', 'wbr'}:
            self.stack.append((tag, hidden or any(v for _, v in self.stack)))
        if tag in {'p', 'div', 'br', 'li', 'tr'}:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if not any(v for _, v in self.stack):
            self.parts.append(data)


def safe_body(value, html=False):
    if html:
        parser = SafeHTML()
        parser.feed(value)
        value = ' '.join(parser.parts)
    value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]', '', value)
    return re.sub(r'\s+', ' ', value).strip()


def sexp(raw):
    """Parse BODYSTRUCTURE only, including IMAP quoted strings/literals."""
    tokens = []
    position = 0
    while position < len(raw):
        if raw[position:position+1].isspace():
            position += 1
            continue
        if raw[position:position+1] == b'{':
            match = re.match(rb'\{(\d+)\}\r\n', raw[position:])
            if not match:
                raise MailError('invalid_mime_structure')
            size = int(match[1]); start = position + len(match[0])
            if start + size > len(raw):
                raise MailError('invalid_mime_structure')
            tokens.append(('literal', raw[start:start+size]));position = start + size
            continue
        match = re.match(rb'"(?:[^"\\]|\\.)*"|[()]|[^\s()]+', raw[position:])
        if not match:
            raise MailError('invalid_mime_structure')
        tokens.append(match[0]);position += len(match[0])
        if len(tokens) > 4000:
            raise MailError('invalid_mime_structure')
    index = 0

    def parse(depth=0):
        nonlocal index
        if depth > 20 or index >= len(tokens):
            raise MailError('invalid_mime_structure')
        token = tokens[index]
        index += 1
        if isinstance(token, tuple):
            return token[1].decode('utf-8', 'replace')
        if token == b'(':
            result = []
            while index < len(tokens) and tokens[index] != b')':
                if len(result) >= 500:
                    raise MailError('invalid_mime_structure')
                result.append(parse(depth + 1))
            if index >= len(tokens):
                raise MailError('invalid_mime_structure')
            index += 1
            return result
        if token.startswith(b'"'):
            return re.sub(rb'\\(.)', rb'\1', token[1:-1]).decode('utf-8', 'replace')
        if token.upper() == b'NIL':
            return None
        if token.isdigit():
            return int(token)
        return token.decode('ascii', 'replace')
    return parse()


def body_parts(structure, prefix=''):
    if not isinstance(structure, list) or not structure:
        raise MailError('invalid_mime_structure')
    if isinstance(structure[0], list):
        output = []
        for i, child in enumerate(structure):
            if not isinstance(child, list):
                break
            output.extend(body_parts(child, f'{prefix}.{i+1}' if prefix else str(i+1)))
        return output
    if len(structure) < 7:
        raise MailError('invalid_mime_structure')
    kind, subtype, params, _, _, encoding, size = structure[:7]
    if not isinstance(kind, str) or not isinstance(subtype, str) or not isinstance(size, int):
        raise MailError('invalid_mime_structure')
    param = {str(k).upper(): v for k, v in zip((params or [])[::2], (params or [])[1::2])}
    mime = f'{kind}/{subtype}'.lower()
    extension_index = 9 if mime == 'message/rfc822' else 8 if kind.upper() == 'TEXT' else 7
    disposition = structure[extension_index + 1] if len(structure) > extension_index + 1 else None
    disp = disposition[0].lower() if isinstance(disposition, list) and isinstance(disposition[0], str) else ''
    disp_params = disposition[1] if isinstance(disposition, list) and len(disposition) > 1 else None
    message = email.message.Message()
    # Let email decode RFC2231 filename continuations as well as MIME headers.
    if isinstance(disp_params, list):
        message['Content-Disposition'] = disp + ''.join(f'; {k}={quoted(str(v))}' for k, v in zip(disp_params[::2], disp_params[1::2]) if v is not None)
    message['Content-Type'] = mime + ''.join(f'; {k}={quoted(str(v))}' for k, v in param.items() if v is not None)
    filename = message.get_filename()
    return [{'part': prefix or '1', 'mime_type': mime, 'charset': param.get('CHARSET', 'utf-8'), 'encoding': encoding,
             'size': size, 'name': header(filename) if filename else '', 'attachment': bool(filename) or disp == 'attachment' or kind.upper() != 'TEXT'}]


class ReadOnlyMail:
    def __init__(self, username, password, factory=None, timeout=12):
        self.username, self.password = username, password
        self.factory = factory or (lambda: BoundedIMAP('imap.naver.com', 993, ssl_context=ssl.create_default_context(), timeout=timeout))
        self.connection = None
        self.lock = threading.Lock()

    def close(self):
        connection, self.connection = self.connection, None
        if connection:
            try:
                connection.shutdown()
            except (OSError, imaplib.IMAP4.error):
                pass

    @staticmethod
    def ok(reply):
        status, data = reply
        if status != 'OK':
            raise MailError('imap_read_failed')
        return data

    def run(self, operation):
        with self.read_lock():
            self.deadline = time.monotonic() + 25
            for attempt in range(2):
                try:
                    if self.connection is None:
                        self.connection = self.factory()
                        try:
                            self.ok(self.connection.login(self.username, self.password))
                        except (imaplib.IMAP4.error, MailError):
                            self.close()
                            raise MailError('imap_auth_failed') from None
                    return operation(self.connection)
                except (OSError, socket.timeout, imaplib.IMAP4.abort):
                    self.close()
                    if attempt:
                        raise MailError('imap_unavailable') from None
                except imaplib.IMAP4.error:
                    self.close()
                    raise MailError('imap_read_failed') from None
                except MailError:
                    self.close()
                    raise

    @contextmanager
    def read_lock(self):
        # Cancelled HTTP calls cannot accumulate indefinitely waiting for IMAP.
        if not self.lock.acquire(timeout=1):
            raise MailError('imap_busy')
        try:
            yield
        finally:
            self.lock.release()

    def read_uid(self, connection, command, *args):
        if command not in {'SEARCH', 'FETCH'}:
            raise MailError('read_only_violation')
        if time.monotonic() > self.deadline:
            raise MailError('imap_timeout')
        return self.ok(connection.uid(command, *args))

    def mailbox(self, connection, folder, expected=None):
        text(folder)
        self.ok(connection.select(quoted(utf7(folder)), readonly=True))
        _, data = connection.response('UIDVALIDITY')
        try:
            validity = positive(int(data[0]))
        except (TypeError, ValueError, IndexError):
            raise MailError('uidvalidity_unavailable') from None
        if expected is not None and positive(expected) != validity:
            raise MailError('uidvalidity_changed')
        return validity

    def folders(self, limit=20, offset=0):
        page_values(limit, offset)
        def operation(connection):
            rows = self.ok(connection.list())
            if len(rows) > MAX_MATCHES:
                raise MailError('search_too_broad')
            items = []
            for row in rows[offset:offset+limit]:
                if not isinstance(row, bytes) or len(row) > 4096:
                    raise MailError('invalid_folder_response')
                match = re.fullmatch(rb'\(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)', row)
                if not match:
                    raise MailError('invalid_folder_response')
                name = match[2].decode('ascii')
                if name.startswith('"'):
                    name = re.sub(r'\\(.)', r'\1', name[1:-1])
                items.append({'folder': unutf7(name), 'selectable': b'\\Noselect' not in match[1]})
            return {'items': items, 'next_offset': offset+limit if offset+limit < len(rows) else None}
        return self.run(operation)

    def metadata(self, connection, folder, validity, uid):
        data = self.read_uid(connection, 'FETCH', str(uid), '(UID RFC822.SIZE FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)]<0.8192>)')
        literals = [(prefix, payload) for row in data if isinstance(row, tuple) and len(row) == 2 for prefix, payload in [row]]
        if len(literals) != 1 or len(literals[0][1]) > MAX_HEADER:
            raise MailError('message_not_found')
        prefix, payload = literals[0]
        actual = re.search(rb'\bUID (\d+)', prefix)
        size = re.search(rb'RFC822.SIZE (\d+)', prefix)
        if not actual or int(actual[1]) != uid or not size:
            raise MailError('invalid_imap_response')
        headers = BytesParser(policy=default).parsebytes(payload, headersonly=True)
        return {'folder': folder, 'uid': uid, 'uidvalidity': validity, 'from': header(headers.get('From')), 'subject': header(headers.get('Subject')),
                'date': header(headers.get('Date'), 100), 'size': int(size[1]), '_headers': headers}

    def search(self, folder='INBOX', limit=10, offset=0, sender='', subject='', since='', before='', body='', unread=False):
        page_values(limit, offset)
        terms = ['UNSEEN' if unread else 'ALL']
        filters = []
        for key, value in [('FROM', sender), ('SUBJECT', subject), ('BODY', body)]:
            if value:
                filters.append((key, text(value, 200)))
        dates = {}
        for key, value in [('SINCE', since), ('BEFORE', before)]:
            if value:
                try:
                    dates[key] = date.fromisoformat(text(value, 10))
                except ValueError:
                    raise MailError('invalid_date') from None
                terms.extend([key, dates[key].strftime('%d-%b-%Y')])
        if len(dates) == 2 and dates['SINCE'] >= dates['BEFORE']:
            raise MailError('invalid_date_range')
        def operation(connection):
            validity = self.mailbox(connection, folder)
            def identifiers(rows):
                raw = b' '.join(x for x in rows if isinstance(x, bytes))
                if len(raw) > 220000 or len(raw.split()) > MAX_MATCHES:
                    raise MailError('search_too_broad')
                try:
                    return {positive(int(x)) for x in raw.split()}
                except ValueError:
                    raise MailError('invalid_imap_response') from None
            ids = identifiers(self.read_uid(connection, 'SEARCH', None, *terms))
            # One terminal literal per filter, then intersect UIDs. This uses
            # stdlib continuation support and never interpolates search keys.
            for key, value in filters:
                connection.literal = value.encode('utf-8')
                ids &= identifiers(self.read_uid(connection, 'SEARCH', 'CHARSET', 'UTF-8', key))
            ids = sorted(ids, reverse=True)
            items = [self.metadata(connection, folder, validity, uid) for uid in ids[offset:offset+limit]]
            for item in items:
                item.pop('_headers')
            return {'items': items, 'next_offset': offset+limit if offset+limit < len(ids) else None, 'uidvalidity': validity}
        return self.run(operation)

    def structure(self, connection, uid):
        rows = self.read_uid(connection, 'FETCH', str(uid), '(UID BODYSTRUCTURE)')
        chunks = []
        for row in rows:
            if isinstance(row, bytes):
                chunks.append(row)
            elif isinstance(row, tuple) and len(row) == 2:
                chunks.append(row[0] + b'\r\n' + row[1])
        raw = b' '.join(chunks)
        if len(raw) > MAX_RESPONSE:
            raise MailError('mime_structure_too_large')
        match = re.search(rb'\bUID (\d+)', raw)
        if not match or int(match[1]) != uid or b'BODYSTRUCTURE ' not in raw:
            raise MailError('message_not_found')
        return body_parts(sexp(raw.split(b'BODYSTRUCTURE ', 1)[1]))

    def message(self, folder, uid, uidvalidity, body_chars=4000, body_offset=0):
        positive(uid); positive(uidvalidity)
        if isinstance(body_chars, bool) or not isinstance(body_chars, int) or not 1 <= body_chars <= 8000 or isinstance(body_offset, bool) or not isinstance(body_offset, int) or not 0 <= body_offset <= 16000:
            raise MailError('invalid_input')
        def operation(connection):
            validity = self.mailbox(connection, folder, uidvalidity)
            item = self.metadata(connection, folder, validity, uid)
            item.pop('_headers')
            parts = [p for p in self.structure(connection, uid) if not p['attachment'] and p['mime_type'] in {'text/plain', 'text/html'}]
            plain = [p for p in parts if p['mime_type'] == 'text/plain']
            selected = (plain or parts)[:1]
            value = ''
            truncated = False
            for part in selected:
                rows = self.read_uid(connection, 'FETCH', str(uid), f'(UID BODY.PEEK[{part["part"]}]<0.{MAX_BODY}>)')
                chunks = [r[1] for r in rows if isinstance(r, tuple)]
                if len(chunks) != 1 or len(chunks[0]) > MAX_BODY:
                    raise MailError('invalid_imap_response')
                payload = chunks[0]
                charset = text(part['charset'] or 'utf-8', 80)
                encoding = str(part['encoding']).upper()
                if encoding not in {'BASE64', 'QUOTED-PRINTABLE', '7BIT', '8BIT', 'BINARY'}:
                    raise MailError('unsupported_transfer_encoding')
                mime = BytesParser(policy=default).parsebytes(f'Content-Type: {part["mime_type"]}; charset={quoted(charset)}\r\nContent-Transfer-Encoding: {encoding}\r\n\r\n'.encode() + payload)
                try:
                    decoded = mime.get_content()
                except (LookupError, UnicodeError, ValueError):
                    decoded = (mime.get_payload(decode=True) or b'').decode('utf-8', 'replace')
                value = safe_body(decoded, part['mime_type'] == 'text/html')
                truncated = part['size'] > len(payload)
            item.update({'body': value[body_offset:body_offset+body_chars], 'body_offset': body_offset,
                         'next_body_offset': body_offset+body_chars if body_offset+body_chars < min(len(value), 24000) else None,
                         'truncated': truncated or len(parts) > 1, 'untrusted_content': True})
            return item
        return self.run(operation)

    def attachments(self, folder, uid, uidvalidity, limit=10, offset=0):
        positive(uid); positive(uidvalidity); page_values(limit, offset)
        def operation(connection):
            self.mailbox(connection, folder, uidvalidity)
            parts = [p for p in self.structure(connection, uid) if p['attachment']]
            return {'folder': folder, 'uid': uid, 'uidvalidity': uidvalidity,
                    'items': [{k: p[k] for k in ('name', 'size', 'mime_type')} for p in parts[offset:offset+limit]],
                    'next_offset': offset+limit if offset+limit < len(parts) else None}
        return self.run(operation)

    def thread(self, folder, uid, uidvalidity, limit=10, offset=0):
        positive(uid); positive(uidvalidity); page_values(limit, offset)
        def operation(connection):
            validity = self.mailbox(connection, folder, uidvalidity)
            item = self.metadata(connection, folder, validity, uid)
            heads = item.pop('_headers')
            refs = re.findall(r'<[!-~]{1,190}>', ' '.join(str(heads.get(k, '')) for k in ('Message-ID', 'References', 'In-Reply-To')))
            if not refs:
                return {'supported': False, 'reason': 'no_message_identifiers', 'items': [], 'next_offset': None}
            # Header identifiers only, never fuzzy subject matching or body reads.
            keys = [f'HEADER {name} {quoted(ref)}' for ref in list(dict.fromkeys(refs))[-3:] for name in ('Message-ID', 'References', 'In-Reply-To')]
            expression = keys[-1]
            for key in reversed(keys[:-1]):
                expression = f'OR ({key}) ({expression})'
            rows = self.read_uid(connection, 'SEARCH', None, expression)
            raw = b' '.join(r for r in rows if isinstance(r, bytes))
            if len(raw) > 220000 or len(raw.split()) > MAX_MATCHES:
                raise MailError('search_too_broad')
            try:
                ids = sorted({positive(int(x)) for x in raw.split()}, reverse=True)
            except ValueError:
                raise MailError('invalid_imap_response') from None
            results = [self.metadata(connection, folder, validity, v) for v in ids[offset:offset+limit]]
            for result in results:
                result.pop('_headers')
            return {'supported': True, 'items': results, 'next_offset': offset+limit if offset+limit < len(ids) else None}
        return self.run(operation)


def bounded(result):
    if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_RESPONSE:
        raise MailError('response_too_large')
    return result
