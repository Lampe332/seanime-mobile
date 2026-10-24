"""AniList list entry sheet on Android: same mutation payload as the desktop form, chips, steppers, manga labels. Optional arg: screenshot dir."""
from pathlib import Path
from web_build import WEB
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
checks=[]
def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok),detail=detail));assert ok,(name,detail)
with tempfile.TemporaryDirectory(prefix='seanime-anilist-sheet-') as tmp:
    bundle=Path(tmp)/'anilist.js'
    subprocess.run(['node',str(root/'tests/mobile_anime_bundle.cjs'),str(bundle),'mobile_anilist_harness.tsx'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(viewport=dict(width=360,height=780),device_scale_factor=3,has_touch=True,is_mobile=True)
        page.route('http://anime.test/**',lambda r:r.fulfill(content_type='text/html',body='<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'))
        page.goto('http://anime.test/')
        for css in (WEB/'static/css').rglob('*.css'):page.add_style_tag(path=str(css))
        page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
        dialog=page.get_by_role('dialog')
        def open_(which):
            page.locator(f'#{which} [data-anilist-media-entry-modal-edit-button]').click();dialog.wait_for();page.wait_for_timeout(400)
        def save():
            page.get_by_role('button',name='Save',exact=True).click();page.wait_for_timeout(300)
        calls=lambda:page.evaluate('window.anilistCalls||[]')
        reset=lambda:page.evaluate('window.anilistCalls=[]')
        open_('desktop');save();desktop=calls();page.keyboard.press('Escape');dialog.wait_for(state='hidden');reset()
        open_('mobile')
        check('Mobile sheet shows a compact one-line title and status chips',page.locator('.mobile-anilist-title').evaluate('e=>e.getBoundingClientRect().height<30') and page.get_by_role('radio').count()==6 and page.get_by_role('radio',name='Watching',exact=True).get_attribute('aria-checked')=='true')
        check('Whole sheet fits a 360x780 phone screen without scrolling',dialog.evaluate('e=>e.scrollHeight<=e.clientHeight+1&&e.getBoundingClientRect().top>=0'))
        if shots: page.screenshot(path=str(shots/'harness-anilist-360.png'))
        save();mobile=calls()
        check('Unchanged mobile save sends exactly the desktop form payload',mobile==desktop and len(mobile)==1,dict(mobile=mobile,desktop=desktop))
        check('Payload keeps the AniList field mapping',mobile[0][1]=={'mediaId':209983,'status':'CURRENT','score':75,'progress':10,'startedAt':{'day':5,'month':9,'year':2026},'completedAt':None,'type':'anime'},mobile)
        reset()
        page.locator('[data-stepper="progress"] button[aria-label="Increase"]').click()
        page.locator('[data-stepper="score"] input').fill('8,5')
        page.locator('[data-stepper="repeat"] button[aria-label="Increase"]').click()
        save();changed=calls()
        edit=[c for c in changed if c[0]=='edit'];rep=[c for c in changed if c[0]=='repeat']
        check('Steppers change progress, score (0-10, one decimal) and rewatches',edit and edit[0][1]['progress']==11 and edit[0][1]['score']==85 and rep==[['repeat',{'mediaId':209983,'repeat':1}]],changed)
        reset()
        page.get_by_role('radio',name='Completed',exact=True).click();page.wait_for_timeout(200)
        check('Completed fills progress with the episode count as on desktop',page.locator('[data-stepper="progress"] input').input_value()=='13')
        page.locator('[data-stepper="progress"] input').fill('99')
        page.locator('[data-stepper="progress"] input').blur();page.wait_for_timeout(100)
        check('Typed progress is clamped to the released episodes',page.locator('[data-stepper="progress"] input').input_value()=='13')
        page.locator('[data-anilist-delete]').click()
        check('Delete needs the existing second confirmation and is not triggered by the first tap',page.locator('[data-anilist-delete-confirm]').is_visible() and calls()==[])
        check('Touch targets are at least 48px',page.evaluate('[...document.querySelectorAll(".mobile-anilist-status button,.mobile-anilist-stepper button,[data-anilist-delete],[data-anilist-delete-confirm],.mobile-anilist-actions button[type=submit]")].every(e=>e.getBoundingClientRect().height>=47.9)'))
        page.keyboard.press('Escape');dialog.wait_for(state='hidden');reset()
        open_('manga')
        check('Manga variant keeps "Total rereads" and reading labels',page.get_by_text('Total rereads',exact=True).count()==1 and page.get_by_role('radio',name='Reading',exact=True).count()==1 and page.get_by_role('radio',name='Rereading',exact=True).count()==1)
        page.keyboard.press('Escape');dialog.wait_for(state='hidden')
        page.set_viewport_size(dict(width=320,height=740));page.evaluate('document.documentElement.style.fontSize="200%"')
        open_('mobile')
        check('320px / 200% text: no horizontal overflow, Save reachable by scrolling',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1') and dialog.evaluate('e=>e.getBoundingClientRect().right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1'))
        if shots: page.screenshot(path=str(shots/'harness-anilist-320-200.png'))
        browser.close()
print(json.dumps(checks,indent=2))

