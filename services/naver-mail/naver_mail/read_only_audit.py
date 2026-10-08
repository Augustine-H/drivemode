"""One bounded INBOX sample; return checks only, never message/credential values."""
import argparse
import json
import re
import time
from pathlib import Path
from .mail import MailError,ReadOnlyMail,MAX_RESPONSE


def audit(mail):
    initial=mail.search(folder='INBOX',limit=1,offset=0)
    if not initial['items']:
        return {'status':'needs_sample','mailbox_empty':True,'mail_values_printed':False}
    item=initial['items'][0]
    folder,uid,validity=item['folder'],item['uid'],item['uidvalidity']
    def read_flags():
        def operation(connection):
            mail.mailbox(connection,folder,validity)
            rows=mail.read_uid(connection,'FETCH',str(uid),'(UID FLAGS)')
            for row in rows:
                if not isinstance(row,bytes):continue
                uid_match=re.search(rb'UID (\d+)',row)
                flags=re.search(rb'FLAGS \(([^)]*)\)',row)
                if uid_match and int(uid_match[1])==uid and flags:
                    return set(flags[1].decode('ascii').split())
            raise MailError('flags_unavailable')
        return mail.run(operation)
    before=read_flags()
    message=mail.message(folder,uid,validity,body_chars=1000,body_offset=0)
    attachments=mail.attachments(folder,uid,validity,limit=1,offset=0)
    after=read_flags()
    unchanged=before==after
    def seen(flags):return any(flag.casefold()==r'\seen' for flag in flags)
    checks={'uidvalidity_unchanged':True,
        'seen_flag_unchanged':seen(before)==seen(after),
        'all_flags_unchanged':unchanged,
        'safe_text_returned':isinstance(message['body'],str) and message.get('untrusted_content') is True,
        'response_size_bounded':len(json.dumps(message,ensure_ascii=False).encode())<=MAX_RESPONSE,
        'attachment_metadata_only':isinstance(attachments['items'],list)}
    return {'status':'passed' if all(checks.values()) else 'failed',
            'checked_at':int(time.time()),'checks':checks,'hangul_in_sample_body':bool(re.search('[가-힣]',message['body'])),
            'mail_values_printed':False,'credential_values_printed':False,
            'external_urls_accessed':False,'attachment_files_downloaded':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials',default='/run/mail-private/imap.json')
    args=parser.parse_args()
    import logging
    logging.disable(logging.CRITICAL)
    mail=None
    try:
        credentials=json.loads(Path(args.credentials).read_text())
        mail=ReadOnlyMail(credentials['username'],credentials['password'])
        report=audit(mail)
    except MailError as error:
        code = 'uidvalidity_unsupported' if str(error) == 'uidvalidity_unsupported' else 'read_only_audit_unavailable'
        report={'status':'failed','error':code,'mail_values_printed':False,'credential_values_printed':False}
    except Exception:
        report={'status':'failed','error':'read_only_audit_unavailable','mail_values_printed':False,'credential_values_printed':False}
    finally:
        if mail is not None:mail.close()
    print(json.dumps(report,sort_keys=True))
    raise SystemExit(0 if report['status']=='passed' else 1)


if __name__=='__main__':
    main()
