"""Optional local browser UX smoke check. Requires Python playwright + system chromium.
Run with: python tests/v121-browser-smoke.py (from repo root)."""
import json
import subprocess
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:4173/mobile'
proc = subprocess.Popen(['node', '--experimental-strip-types', 'demo/safety-challenge/server.mjs'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    for _ in range(65):
        try:
            with urllib.request.urlopen(URL, timeout=1) as r:
                if r.status == 200: break
        except Exception: time.sleep(.2)
    else: raise AssertionError('Local server failed to start')
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={"width": 393, "height": 852}, device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(URL,wait_until='domcontentloaded')
        page.locator('#mobile-skeleton').wait_for(state='hidden',timeout=12000)
        page.locator('#home-case').wait_for(state='visible')
        assert page.locator('#home-case').text_content().strip()!='—','Case ID missing'
        page.locator('#theme-toggle').click()
        assert page.locator('body').get_attribute('data-theme')=='light'
        page.get_by_role('button',name='SafeBank',exact=True).first.click()
        assert page.locator('#view-bank').is_visible()
        assert page.locator('#bank-case').text_content().strip()!='—'
        assert page.locator('#mobile-error').is_hidden()
        assert page.locator('#btn-tx').is_enabled()
        page.locator('#btn-tx').click()
        page.wait_for_timeout(700)
        assert page.locator('#view-guard').is_visible(),'Transfer success must move to guard on successful server action'
        page.locator('button[data-go="home"]').first.click()
        assert page.locator('#view-home').is_visible()
        assert not errors,repr(errors)
        out=ROOT/'validation-logs/v121/mobile-browser-393-light.png'
        out.parent.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(out),full_page=True)
        print('BROWSER_SMOKE: PASS 393x852, startup skeleton, Case ID, light theme, SafeBank, server-approved transfer, navigation')
        print('Screenshot:',out)
        browser.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired: proc.kill()
