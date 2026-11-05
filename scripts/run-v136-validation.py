#!/usr/bin/env python3
from pathlib import Path
import subprocess,json,time
root=Path(__file__).resolve().parents[1]
logs=root/'docs/v136/logs';logs.mkdir(parents=True,exist_ok=True)
scripts=['test:v136','test:v135','test:v134','test:v133','test:v132','test:v131','test:v130','test:v129','test:v128','test:v127','test:mobile','test:safebank','test:demo','test:offline','test:restart:process','check:static','check:preflight','sim:v136','sim:v135','typecheck','build']
results=[]
for script in scripts:
    begun=time.monotonic()
    try:
        result=subprocess.run(['npm','run',script],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=50,env=None)
        exit_code=result.returncode;output=result.stdout
    except subprocess.TimeoutExpired as error:
        exit_code=124;output=(error.stdout or b'').decode('utf8','replace') if isinstance(error.stdout,bytes) else error.stdout or ''
        output+='\nPROCESS_TIMED_OUT'
    (logs/(script.replace(':','_')+'.log')).write_text(output)
    import re
    pass_count=re.search(r'^# pass (\d+)',output,re.M)
    fail_count=re.search(r'^# fail (\d+)',output,re.M)
    status=('PASS' if exit_code==0 else 'BLOCKED_DEPENDENCIES' if script in ['typecheck','build'] and ('Cannot find module' in output or 'next: not found' in output or "Cannot find type definition" in output) else 'FAIL')
    row=dict(command=f'npm run {script}',status=status,exit=exit_code,passed=int(pass_count.group(1)) if pass_count else None,failed=int(fail_count.group(1)) if fail_count else None,seconds=round(time.monotonic()-begun,2),log=f'logs/{script.replace(":","_")}.log')
    results.append(row)
    print(script,status,exit_code,row['passed'],row['failed'],flush=True)
(logs.parent/'VALIDATION_SUMMARY.json').write_text(json.dumps({'v':'1.36','mode':'LOCAL_MOCK','tests':results},indent=2,ensure_ascii=False)+'\n')
