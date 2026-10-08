"""Root-only mode publication after a private read-only audit; no secret output."""
import argparse
import json
import os
import stat
import tempfile
import time
from pathlib import Path

CHECKS={'uidvalidity_unchanged','seen_flag_unchanged','all_flags_unchanged',
        'safe_text_returned','response_size_bounded','attachment_metadata_only'}


def enable(root,report,acknowledged):
    private=Path(root)/'private'
    info=private.lstat()
    if (os.geteuid()!=0 or os.getegid()!=10001 or not stat.S_ISDIR(info.st_mode)
            or info.st_uid!=0 or info.st_gid!=10001 or stat.S_IMODE(info.st_mode)!=0o750):
        raise ValueError('management_identity_invalid')
    if (not acknowledged or report.get('status')!='passed'
            or set(report.get('checks',{}))!=CHECKS
            or any(value is not True for value in report['checks'].values())
            or report.get('mail_values_printed') is not False
            or report.get('credential_values_printed') is not False
            or type(report.get('checked_at')) is not int
            or abs(time.time()-report['checked_at'])>600):
        raise ValueError('read_only_audit_and_policy_required')
    path=private/'config.json';info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=10001 or stat.S_IMODE(info.st_mode)!=0o440:
        raise ValueError('config_permissions_invalid')
    config=json.loads(path.read_text())
    if config.get('mode')!='validation':raise ValueError('existing_real_mode_preserved')
    gate=private/'read-only-approval.json'
    expected={'read_only_audit_passed':True,'xai_data_policy_acknowledged':True}
    if gate.exists() or gate.is_symlink():
        info=gate.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=10001
                or stat.S_IMODE(info.st_mode)!=0o440 or json.loads(gate.read_text())!=expected):
            raise ValueError('existing_approval_invalid')
    else:
        fd=os.open(gate,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o440)
        with os.fdopen(fd,'w') as handle:
            os.fchmod(handle.fileno(),0o440)
            json.dump(expected,handle);handle.flush();os.fsync(handle.fileno())
    config['mode']='real-mail'
    fd,name=tempfile.mkstemp(prefix='.mode-',dir=private)
    try:
        with os.fdopen(fd,'w') as handle:
            os.fchmod(handle.fileno(),0o440);json.dump(config,handle);handle.flush();os.fsync(handle.fileno())
        os.replace(name,path)
    finally:
        Path(name).unlink(missing_ok=True)


def rollback(root):
    private=Path(root)/'private'
    info=private.lstat()
    if (os.geteuid()!=0 or os.getegid()!=10001 or not stat.S_ISDIR(info.st_mode)
            or info.st_uid!=0 or info.st_gid!=10001 or stat.S_IMODE(info.st_mode)!=0o750):
        raise ValueError('management_identity_invalid')
    path=private/'config.json';info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o440:
        raise ValueError('config_permissions_invalid')
    config=json.loads(path.read_text())
    if config.get('mode') not in {'validation','real-mail'}:raise ValueError('invalid_mode')
    config['mode']='validation'
    fd,name=tempfile.mkstemp(prefix='.mode-',dir=private)
    try:
        with os.fdopen(fd,'w') as handle:
            os.fchmod(handle.fileno(),0o440);json.dump(config,handle);handle.flush();os.fsync(handle.fileno())
        os.replace(name,path)
    finally:Path(name).unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-report')
    parser.add_argument('--acknowledge-xai-policy',action='store_true')
    parser.add_argument('--rollback-validation',action='store_true')
    args=parser.parse_args()
    try:
        if args.rollback_validation:
            if args.audit_report or args.acknowledge_xai_policy:raise ValueError('exclusive_action_required')
            rollback('/project')
        else:
            path=Path(args.audit_report);info=path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o027 or info.st_size>8192:
                raise ValueError('private_report_invalid')
            enable('/project',json.loads(path.read_text()),args.acknowledge_xai_policy)
    except Exception:
        raise SystemExit('REAL_MAIL_MODE_PUBLICATION=failed; values suppressed') from None
    print('OAUTH_MODE_PUBLICATION=passed; MODE='+('validation' if args.rollback_validation else 'real-mail')+'; FRESH_WEB_AUTHORIZATION_REQUIRED=yes')


if __name__=='__main__':main()
