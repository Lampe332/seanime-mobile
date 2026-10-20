"""Download episodes sheet: quick selections incl. "This episode", saved episodes, one batch submission. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
checks=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
with tempfile.TemporaryDirectory(prefix='seanime-download-sheet-') as tmp:
    bundle=Path(tmp)/'download.js'
    subprocess.run(['node',str(root/'tests/mobile_anime_bundle.cjs'),str(bundle),'mobile_anime_download_harness.tsx'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(viewport=dict(width=360,height=780),device_scale_factor=3,has_touch=True,is_mobile=True)
        page.route('http://anime.test/**',lambda r:r.fulfill(content_type='text/html',body='<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'))
        page.goto('http://anime.test/')
        for css in (root/'backend/seanime-web/out/static/css').rglob('*.css'):page.add_style_tag(path=str(css))
        page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
        trigger=page.get_by_role('button',name='Download season / episodes',exact=True);trigger.wait_for()
        check('Single trigger keeps its accessible name and shows a short label',trigger.inner_text().strip()=='Download')
        trigger.click();sheet=page.locator('[data-episode-download-picker]');sheet.wait_for();page.wait_for_timeout(400)
        selected=lambda:page.evaluate('[...document.querySelectorAll("[data-download-episode] input")].filter(i=>i.checked).map(i=>+i.closest("label").dataset.downloadEpisode)')
        pressed=lambda:page.evaluate('[...document.querySelectorAll("[data-download-preset][aria-pressed=true]")].map(b=>b.dataset.downloadPreset)')
        check('Saved episodes are marked and cannot be selected',page.locator('[data-download-episode][data-saved]').count()==2 and page.locator('[data-download-episode="1"] input').is_disabled() and 'Saved' in page.locator('[data-download-episode="2"]').inner_text())
        check('Episode saved with other audio stays selectable',not page.locator('[data-download-episode="3"] input').is_disabled())
        check('Opening preselects the whole unsaved season',selected()==list(range(3,14)) and pressed()==['season'])
        if shots: page.screenshot(path=str(shots/'harness-download-sheet-360.png'))
        page.locator('[data-download-preset="this"]').click()
        check('"This episode" selects only the current episode',selected()==[11] and pressed()==['this'] and page.locator('[data-download-submit]').inner_text()=='Download 1 episode')
        if shots: page.screenshot(path=str(shots/'harness-download-sheet-this-episode.png'))
        page.locator('[data-download-preset="from"]').click()
        check('"From ep. 11" selects the rest of the season',selected()==[11,12,13])
        page.locator('[data-download-episode="12"]').click()
        check('Tapping a row toggles it',selected()==[11,13] and pressed()==[])
        page.locator('[data-download-preset="none"]').click()
        check('"None" clears the selection and disables download',selected()==[] and page.locator('[data-download-submit]').is_disabled())
        page.locator('[data-download-preset="this"]').click();page.locator('[data-download-submit]').click()
        batches=page.evaluate('batches')
        check('Submit queues the same batch payload for the current episode only',len(batches)==1 and [e['number'] for e in batches[0]['episodes']]==[11]
              and batches[0]['provider']=='animetoast' and batches[0]['server']=='VidMoly' and batches[0]['dubbed'] is False and batches[0]['quality']=='Auto' and batches[0]['mediaId']==209983)
        sheet.wait_for(state='detached')
        page.set_viewport_size(dict(width=320,height=740));page.evaluate('document.documentElement.style.fontSize="200%"')
        trigger.click();sheet.wait_for();page.wait_for_timeout(400)
        check('320px / 200% text: sheet and footer action stay on screen without page overflow',page.evaluate('''(()=>{const d=document.querySelector('[role=dialog]').getBoundingClientRect(),b=document.querySelector('[data-download-submit]').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth+1&&d.left>=0&&d.right<=innerWidth+1&&b.bottom<=innerHeight+1&&b.right<=innerWidth+1})()'''))
        check('Touch targets are at least 48px',page.evaluate('[...document.querySelectorAll("[data-download-preset],[data-download-episode],[data-download-submit]")].every(e=>e.getBoundingClientRect().height>=47.9)'))
        if shots: page.screenshot(path=str(shots/'harness-download-sheet-320-200.png'))
        browser.close()
print(json.dumps(checks,indent=2))
