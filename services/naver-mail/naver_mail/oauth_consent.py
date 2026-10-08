"""Owner consent; no mail, remote assets, or client-controlled HTML."""
import hmac
import html
import secrets
from starlette.responses import HTMLResponse,JSONResponse,RedirectResponse,Response
from .oauth_store import digest


def add_consent_routes(mcp,provider,validation):
    @mcp.custom_route('/consent.css',methods=['GET'])
    async def consent_style(_request):
        return Response('''
:root{--bg:#f4f6f8;--surface:#fff;--fg:#182230;--border:#bec8d4;--action:#155bb5;--space:1rem;--radius:.5rem}
*{box-sizing:border-box}body{margin:0;word-break:keep-all;background:var(--bg);color:var(--fg);font:1rem/1.5 "Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:32rem;margin:3rem auto;padding:1.5rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}
h1{font-size:1.5rem;margin:0 0 var(--space)}p{margin:0 0 1.5rem}label{display:block}
input[type=password]{display:block;width:100%;min-height:44px;margin-top:.5rem;padding:.5rem;font:inherit;border:1px solid var(--border);border-radius:var(--radius)}
button{width:100%;min-height:44px;margin-top:var(--space);padding:.5rem 1rem;background:var(--action);color:var(--surface);border:0;border-radius:var(--radius);font:inherit;cursor:pointer}
label:has(input[type=checkbox]){display:flex;align-items:center;gap:.75rem;min-height:44px;margin-top:1rem}input[type=checkbox]{width:20px;height:20px;flex:none;accent-color:var(--action)}
.error{margin:1rem 0;color:var(--fg);font-weight:600}input:focus-visible,button:focus-visible{outline:2px solid var(--action);outline-offset:3px}
@media(max-width:36rem){main{margin:1.5rem 1rem;padding:1.25rem}}
''',media_type='text/css')

    def consent_page(key,row,error=False):
        csrf=secrets.token_urlsafe(32)
        provider.set_csrf(key,csrf)
        message='<p class="error" role="alert">메일 접근 승인 암호를 확인하고 다시 입력하세요.</p>' if error else ''
        page=('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
              '<title>네이버 메일 접근 승인</title><link rel="stylesheet" href="/consent.css"></head><body><main><h1>네이버 메일 읽기 전용 연결 승인</h1>'
              '<p>'+('현재는 합성 검증 모드이며 실제 메일은 연결되지 않습니다. ' if validation else '')+'이 연결은 조회한 메일 내용을 Grok/xAI로 전달할 수 있으며 xAI 데이터 처리 정책이 적용됩니다. NAS·네이버 비밀번호를 입력하지 마세요.</p>'+message+
              '<form method="post"><label>메일 접근 승인 암호 <input name="phrase" type="password" minlength="16" maxlength="256" autocomplete="off" required></label>'
              f'<input name="csrf" type="hidden" value="{html.escape(csrf,quote=True)}">'+
              ('' if validation else '<label><input type="checkbox" name="acknowledge_xai" value="yes" required> 조회한 메일이 xAI로 전달될 수 있음을 확인했습니다.</label>')+
              '<button type="submit">메일 조회 연결 승인</button></form></main></body></html>')
        response=HTMLResponse(page,status_code=403 if error else 200)
        response.set_cookie('naver_mail_consent',csrf,secure=True,httponly=True,samesite='strict',max_age=300,path='/consent')
        return response

    @mcp.custom_route('/consent',methods=['GET','POST'])
    async def consent(request):
        key = request.query_params.get('request','')
        row = provider.consent_record(key)
        if not row:
            return JSONResponse({'error':'consent_unavailable'},status_code=400)
        if request.method=='GET':
            return consent_page(key,row)
        if request.headers.get('origin')!=provider.issuer:
            return JSONResponse({'error':'consent_denied'},status_code=403)
        form = await request.form()
        if not validation and form.get('acknowledge_xai')!='yes':
            return JSONResponse({'error':'data_policy_acknowledgement_required'},status_code=403)
        csrf = str(form.get('csrf',''))
        if not csrf or not hmac.compare_digest(csrf,request.cookies.get('naver_mail_consent','')):
            return JSONResponse({'error':'consent_denied'},status_code=403)
        try:
            redirect = provider.consent(key,csrf,str(form.get('phrase','')))
        except ValueError:
            return consent_page(key,row,error=True)
        response = RedirectResponse(redirect,status_code=303)
        response.delete_cookie('naver_mail_consent',path='/consent')
        return response
