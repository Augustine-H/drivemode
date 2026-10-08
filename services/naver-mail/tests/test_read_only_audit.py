import json
import pytest
from naver_mail.read_only_audit import audit


@pytest.fixture(autouse=True)
def flags_oracle(fake):
    original=fake.uid
    def uid(command,*args):
        if command=='FETCH' and args[1]=='(UID FLAGS)':
            fake.calls.append(('FETCH',*args))
            key=int(args[0]);flags=' '.join(sorted(fake.flags[key]))
            return 'OK',[f'1 (UID {key} FLAGS ({flags}))'.encode()]
        return original(command,*args)
    fake.uid=uid


def test_read_only_audit_passes_without_private_output(mail,fake):
    before={k:set(v) for k,v in fake.flags.items()}
    report=audit(mail)
    assert report['status']=='passed' and report['checks']['all_flags_unchanged']
    assert report['hangul_in_sample_body'] is True and fake.flags==before
    output=json.dumps(report)
    assert all(value not in output for value in ['한국어 본문','hong@example.test','synthetic-password'])
    assert any(call[0]=='FETCH' and 'BODY.PEEK' in call[2] for call in fake.calls)
    assert all(call[0] in {'LOGIN','EXAMINE','SEARCH','FETCH','SHUTDOWN'} for call in fake.calls)


@pytest.mark.parametrize('flag',[r'\Deleted',r'\Seen'])
def test_external_flag_change_fails_read_only_check(mail,fake,flag):
    original=fake.uid
    def uid(command,*arguments):
        response=original(command,*arguments)
        if command=='FETCH' and 'BODY.PEEK[1]' in arguments[1]:
            fake.flags[int(arguments[0])].symmetric_difference_update({flag})
        return response
    fake.uid=uid
    report=audit(mail)
    assert report['status']=='failed' and report['checks']['all_flags_unchanged'] is False
    if flag==r'\Seen':assert report['checks']['seen_flag_unchanged'] is False


def test_empty_mailbox_is_not_read_only_pass(mail,fake):
    original=fake.uid
    fake.uid=lambda command,*args:('OK',[b'']) if command=='SEARCH' else original(command,*args)
    report=audit(mail)
    assert report['status']=='needs_sample' and 'checks' not in report
