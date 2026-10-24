"""Downloads tab (Android phones): anime overview, polling only while a download moves, anime detail, deletion, selection,
manga tab, 48px targets, 320px / 200% text. Optional arg: screenshot dir."""
from pathlib import Path
from web_build import WEB
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
checks=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name):
    if shots: page.screenshot(path=str(shots/name),full_page=True)
SVG='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="hsl({h} 35% 32%)"/><circle cx="230" cy="70" r="46" fill="hsl({h} 45% 55%)"/></svg>'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL_TARGETS='''[...document.querySelectorAll("[data-mobile-downloads] button")].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)&&!b.matches("[data-downloaded-anime],[data-downloaded-manga],.mdl-continue-tile")}).map(b=>b.textContent||b.getAttribute("aria-label"))'''
with tempfile.TemporaryDirectory(prefix='seanime-downloads-') as tmp:
    bundle=Path(tmp)/'downloads.js'
    subprocess.run(['node',str(root/'tests/mobile_downloads_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(viewport=dict(width=390,height=844),device_scale_factor=3,has_touch=True,is_mobile=True)
        page.route('http://dl.test/__android_offline/**',lambda r:r.fulfill(content_type='image/svg+xml',body=SVG.format(h=int(r.request.url[-8:-4],16)*37%360)))
        page.route('http://dl.test/android-downloads*',lambda r:r.fulfill(content_type='text/html',body='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'))
        page.goto('http://dl.test/android-downloads')
        for css in (WEB/'static/css').rglob('*.css'):page.add_style_tag(path=str(css))
        page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
        page.locator('[data-downloaded-anime]').first.wait_for();page.wait_for_timeout(300)
        check('Overview: title, facts from the rows and one card per anime',page.locator('h1').inner_text()=='Downloads' and page.locator('[data-downloaded-anime]').count()==3
              and page.locator('.mdl-header p').inner_text().startswith('3 Anime · 6 episodes ·'))
        check('Sizes keep number and unit together (no-break space)',page.evaluate(r"""() => { const t = document.body.innerText
              return /\d (GB|MB)/.test(t) && !/\d (GB|MB)/.test(t) }"""))
        active=page.locator('[data-active-downloads] .mdl-row')
        check('Downloads in progress come first with progress and their own pause / resume',active.count()==2 and page.locator('[aria-label="Pause episode 2"]').count()==1
              and page.locator('[aria-label="Resume episode 1"]').count()==1 and page.locator('[data-active-downloads] [role=progressbar]').first.get_attribute('aria-valuenow')=='42')
        check('Continue offline offers the started episode',page.locator('.mdl-continue-tile').count()==1 and 'at 12:31' in page.locator('.mdl-continue-tile').inner_text())
        check('Paused download keeps its progress visible',page.locator('[data-active-downloads] .mdl-row').nth(1).locator('.mdl-row-meta').inner_text()=='Paused · 12 %'
              and page.locator('[data-active-downloads] .mdl-row').nth(1).locator('[role=progressbar]').count()==1)
        check('Filter chips carry counts while something loads',page.locator('.mdl-chips button').all_text_contents()==['All3','Ready2','Active2'])
        check('Back icon is centred in its 48px target',page.evaluate('''(()=>{const b=document.querySelector('[aria-label="Back to Seanime"]'),r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return r.width>=48&&r.height>=48&&Math.abs(r.left+r.width/2-s.left-s.width/2)<1&&Math.abs(r.top+r.height/2-s.top-s.height/2)<1})()'''))
        check('All buttons are at least 48px',page.evaluate(SMALL_TARGETS)==[])
        shot(page,'downloads-overview-390.png')
        before=page.evaluate('snapshots');page.wait_for_timeout(2600)
        check('Polls every second while a download moves',page.evaluate('snapshots')-before>=2)
        page.evaluate('library=library.map(e=>e.status==="downloading"?{...e,ready:true,status:"ready",progress:100}:e)');page.wait_for_timeout(1300)
        before=page.evaluate('snapshots');page.wait_for_timeout(3000)
        check('Stops polling once nothing moves (only paused / saved left)',page.evaluate('snapshots')==before)
        page.evaluate('dispatchEvent(new Event("seanime:offline-changed"))')
        check('A download queued elsewhere in the app refreshes the list',page.evaluate('snapshots')==before+1)
        page.locator('[aria-label="Pause episode 1"],[aria-label="Resume episode 1"]').first.click()
        check('Resume calls the native action',page.evaluate('actions').pop()==['hm-1','resume'])
        page.locator('[data-downloaded-anime]',has_text='Frieren').click()
        page.locator('[data-downloaded-episode]').first.wait_for();page.wait_for_timeout(300)
        check('Detail: route, object title, three sorted episodes with artwork',page.evaluate('location.search')=='?anime=media-154587' and page.locator('h1').inner_text()=="Frieren: Beyond Journey's End"
              and page.locator('[data-downloaded-episode]').count()==3 and page.evaluate('[...document.querySelectorAll("[data-downloaded-episode] img")].every(i=>i.complete&&i.naturalWidth>0)')
              and 'About this anime' in page.inner_text('body'))
        primary=page.locator('.mdl-primary')
        check('Primary action resumes the started episode',primary.inner_text().strip()=='Resume episode 2 at 12:31')
        shot(page,'downloads-detail-390.png')
        primary.click()
        check('Primary action plays offline',page.evaluate('actions').pop()==['fr-2','play'])
        page.locator('[data-downloaded-episode] button').first.click()
        check('First button of an episode row plays it',page.evaluate('actions').pop()==['fr-1','play'])
        page.locator('[aria-label="Delete episode 1"]').click();page.locator('[data-download-delete-dialog]').wait_for()
        shot(page,'downloads-delete-sheet-390.png')
        page.evaluate('dispatchEvent(new Event("seanime:android-back",{cancelable:true}))');page.locator('[data-download-delete-dialog]').wait_for(state='detached')
        check('Back closes the delete sheet and keeps the episodes',page.locator('[data-downloaded-episode]').count()==3)
        page.locator('[aria-label="Delete episode 3"]').click()
        page.locator('[data-download-delete-dialog] button',has_text='Delete').first.click()
        check('Delete removes exactly that episode',page.evaluate('actions').pop()==['fr-3','remove'])
        page.locator('[aria-label="Back to anime overview"]').click();page.locator('[data-downloaded-anime]').first.wait_for()
        check('Back returns to the overview',page.locator('[data-downloaded-episode]').count()==0)
        page.locator('button',has_text='Select').first.click();page.locator('[data-anime-selection]').wait_for()
        page.locator('[data-downloaded-anime]',has_text='Dandadan').click()
        check('Selection marks the card',page.locator('[data-downloaded-anime][aria-pressed=true]').count()==1)
        shot(page,'downloads-selection-390.png')
        page.locator('[data-anime-selection] button',has_text='Delete selected').click();page.locator('[data-anime-delete-dialog]').wait_for()
        page.locator('[data-anime-delete-dialog] button',has_text='Cancel').click();page.locator('[data-anime-delete-dialog]').wait_for(state='detached')
        check('Cancel keeps every download',not any(a[1]=='remove' and a[0].startswith('dd') for a in page.evaluate('actions')))
        page.locator('[role=tablist] [role=tab]',has_text='Manga').click();page.locator('[data-manga-downloads]').wait_for()
        page.locator('[role=tablist] [role=tab]',has_text='Anime').click();page.locator('[data-downloaded-anime]').first.wait_for()
        check('Switching tab ends selection mode',page.locator('[data-anime-selection]').count()==0 and page.locator('[data-downloaded-anime][aria-pressed]').count()==0)
        page.locator('.mdl-chips button',has_text='Active').click()
        page.evaluate('library=library.map(e=>e.ready?e:{...e,ready:true,status:"ready",progress:100});dispatchEvent(new Event("seanime:offline-changed"))');page.wait_for_timeout(300)
        check('Chips disappear when nothing is pending',page.locator('.mdl-chips').count()==0)
        page.evaluate('library=[...library,{...library[0],id:"new-1",episode:"9",ready:false,status:"queued",progress:0}];dispatchEvent(new Event("seanime:offline-changed"))');page.wait_for_timeout(300)
        check('A new download does not bring back the old Active filter',page.locator('.mdl-chips button[aria-pressed=true]').inner_text().startswith('All') and page.locator('[data-downloaded-anime]').count()==3)
        page.locator('[role=tablist][aria-label="Download type"] [role=tab]',has_text='Manga').click()
        page.locator('[data-downloaded-manga]').first.wait_for();page.wait_for_timeout(300)
        check('Manga tab: cover card and queue with its actions',page.evaluate('[...document.querySelectorAll("[data-downloaded-manga] img")].some(i=>i.complete&&i.naturalWidth>0)')
              and page.locator('[data-manga-queue] button').count()==2 and page.evaluate(SMALL_TARGETS)==[])
        shot(page,'downloads-manga-390.png')
        page.locator('[data-downloaded-manga]').click()
        page.locator('[aria-label="Read chapter 2"]:not(:disabled)').wait_for()
        check('Manga detail: chapters readable, back label names the manga overview',page.locator('[data-downloaded-chapter]').count()==3 and page.locator('[aria-label="Back to manga overview"]').count()==1)
        shot(page,'downloads-manga-detail-390.png')
        page.locator('[aria-label="Delete chapter 1"]').click();page.get_by_role('dialog').wait_for()
        page.evaluate('dispatchEvent(new Event("seanime:android-back",{cancelable:true}))');page.get_by_role('dialog').wait_for(state='detached')
        check('Android back closes the chapter delete sheet and stays on the manga',page.locator('[data-downloaded-chapter]').count()==3 and 'manga=30013' in page.evaluate('location.search'))
        page.locator('[aria-label="Read chapter 2"]').click()
        check('Read opens the reader',page.locator('[data-chapter-reader-drawer-content]').count()==1)
        page.set_viewport_size(dict(width=320,height=740));page.evaluate('document.documentElement.style.fontSize="200%"');page.wait_for_timeout(300)
        check('320px / 200% text: manga detail without page overflow',page.evaluate(NO_OVERFLOW))
        for url,name in (('/android-downloads','overview'),('/android-downloads?anime=media-154587','detail')):
            page.evaluate(f'history.pushState(null,"","{url}");dispatchEvent(new PopStateEvent("popstate"))');page.wait_for_timeout(400)
            check(f'320px / 200% text: {name} without page overflow',page.evaluate(NO_OVERFLOW))
            shot(page,f'downloads-{name}-320-200.png')
        late=browser.new_page(viewport=dict(width=390,height=844))
        late.route('http://dl.test/android-downloads*',lambda r:r.fulfill(content_type='text/html',body='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'))
        late.goto('http://dl.test/android-downloads#late-token');late.add_style_tag(path=str(bundle.with_suffix('.css')));late.add_script_tag(path=str(bundle))
        late.locator('[data-downloaded-anime]').first.wait_for(timeout=5000)
        check('Cold start: the list appears once the bridge token arrives late',late.locator('[data-downloaded-anime]').count()==3)
        browser.close()
print(json.dumps(checks,indent=2))
