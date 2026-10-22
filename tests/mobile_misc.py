"""Smaller desktop leftovers on Android phones: the /custom-sources phone screen (source picker, Anime / Manga, title
search, the phone cover grid, Previous / Next pages, the empty, error and no-source states), LuffyError as the phone kit's
empty block (title, text, Try again; no Luffy picture), and the issue recorder as a panel above the bottom bar (scan logs
switch, Start, the running recording with its note sheet); German texts, 48px targets, no overflow at 390px and at 320px
with 200% text. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, copy
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name):
    if shots: page.screenshot(path=str(shots/name))

COVER='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>'
def m(id,title,fmt='TV',year=2020): return dict(id=id,title=dict(userPreferred=title,romaji=title),format=fmt,startDate=dict(year=year),coverImage=dict(large=COVER),isAdult=False)
SOURCES=[dict(id='kitsu',name='Kitsu',settings=dict(supportsAnime=True,supportsManga=True)),dict(id='mdx',name='MangaDex+',settings=dict(supportsAnime=False,supportsManga=True))]
MEDIA={'kitsu':dict(anime=[m(2147483648+i,f'Kitsu Show {i}') for i in range(1,41)],manga=[m(2147483700,'Kitsu Manga','MANGA')]),'mdx':dict(manga=[m(2147483800,'Dex Manga','MANGA')])}
STATUS=dict(version='3.10.4',os='android',isOffline=False,user=dict(viewer=dict(name='Nick')),themeSettings=dict(id=1),settings=dict(library=dict(),anilist=dict(blurAdultContent=False)))
SERVER=dict(status=STATUS,collection=dict(lists=[],unmatchedLocalFiles=[],unmatchedGroups=[],unknownGroups=[],ignoredLocalFiles=[]),media={},suggestions={},
    customSources=SOURCES,customMedia=MEDIA)
INIT='''(()=>{Object.assign(window,{server:%s,view:%s,routes:[],requests:[],toasts:[],tabs:[],clipboard:[],previews:[],command:[],explorer:[],completed:0})})()'''
STATIC=root/'backend/seanime-web/out/static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SHEET='.UI-Modal__content[data-state=open]'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>(b.textContent||b.getAttribute("aria-label")||b.tagName).trim().slice(0,40)))'''
def reqs(page,method,endpoint): return [r[2] for r in page.evaluate('requests') if r[0]==method and r[1]==endpoint]

with tempfile.TemporaryDirectory(prefix='seanime-misc-') as tmp:
    bundle=Path(tmp)/'misc.js'
    subprocess.run(['node',str(root/'tests/mobile_library_bundle.cjs'),str(bundle),'mobile_misc_harness.tsx'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(view,width=390,height=844,language=None,server=None,html_style='',path='/',ready=None):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script(INIT%(json.dumps(server or copy.deepcopy(SERVER)),json.dumps(view)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            page.route('http://misc.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            html=f'<html class="dark" lang="en" style="{html_style}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
            page.route('http://misc.test/**',lambda r:r.fulfill(content_type='text/html',body=html) if '/static/' not in r.request.url else r.continue_())
            page.goto('http://misc.test'+path)
            for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            if ready: page.locator(ready).first.wait_for()
            page.wait_for_timeout(700)
            return page
        def small(page,sel): return page.evaluate(SMALL,sel)

        # Custom sources
        page=open_page('custom',path='/custom-sources?provider=kitsu',ready='[data-phone-screen="custom-sources"] h1')
        check('Custom sources: the phone screen, the source from the link',page.locator('[data-desktop-banner]').count()==0 and page.locator('[data-custom-sources-source]').input_value()=='kitsu'
              and page.locator('[data-phone-facts]').inner_text()=='Kitsu · 30 on this page · page 1 of 2')
        check('Grid: the phone cover cards with format and year',page.locator('[data-custom-sources-grid] [data-phone-card]').count()==30
              and page.locator('[data-custom-sources-grid] .ps-card-meta').first.inner_text()=='TV · 2020')
        check('Anime / Manga as a segment for a source with both',page.evaluate('[...document.querySelectorAll("[data-custom-sources-type] [role=tab]")].map(e=>[e.textContent,e.getAttribute("aria-selected")])')==[['Anime','true'],['Manga','false']])
        check('48px targets, no overflow',small(page,'[data-phone-screen] :is(button,select,input,a.ps-primary)')==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'custom-390.png')
        page.locator('[data-custom-sources-next]').click();page.wait_for_timeout(600)
        check('Next: page 2',reqs(page,'POST','/api/v1/custom-source/provider/list/anime')[-1]['page']==2 and page.locator('[data-custom-sources-grid] [data-phone-card]').count()==10
              and page.locator('[data-custom-sources-next]').is_disabled())
        page.locator('[data-custom-sources-search]').fill('show 1');page.locator('[data-custom-sources-search]').press('Enter');page.wait_for_timeout(600)
        last=reqs(page,'POST','/api/v1/custom-source/provider/list/anime')[-1]
        check('Search: from page 1 with the title',last['search']=='show 1' and last['page']==1 and page.locator('[data-custom-sources-grid] [data-phone-card]').count()==11)
        page.locator('[data-custom-sources-type] [role=tab]').nth(1).click();page.wait_for_timeout(600)
        check('Manga: the source\'s manga',reqs(page,'POST','/api/v1/custom-source/provider/list/manga')[-1]['provider']=='kitsu')
        page.locator('[data-custom-sources-search]').fill('');page.locator('[data-custom-sources-search]').press('Enter');page.wait_for_timeout(500)
        page.locator('[data-custom-sources-source]').select_option('mdx');page.wait_for_timeout(600)
        check('Another source: manga only, no type switch',page.locator('[data-custom-sources-type]').count()==0
              and reqs(page,'POST','/api/v1/custom-source/provider/list/manga')[-1]['provider']=='mdx' and page.locator('[data-custom-sources-grid] [data-phone-card]').count()==1)
        page.locator('[data-custom-sources-search]').fill('zzz');page.locator('[data-custom-sources-search]').press('Enter');page.wait_for_timeout(600)
        check('No result says so',page.locator('[data-custom-sources-empty]').inner_text().startswith('Nothing found'))
        page.evaluate('window.failWhen=["custom-source/provider"]');page.locator('[data-custom-sources-search]').fill('dex');page.locator('[data-custom-sources-search]').press('Enter');page.wait_for_timeout(700)
        check('A failing source: one sentence and Try again',page.locator('[data-custom-sources-error]').inner_text().startswith('MangaDex+ did not answer.'))
        page.close()
        server=copy.deepcopy(SERVER);server['customSources']=[]
        page=open_page('custom',server=server,path='/custom-sources',ready='[data-phone-screen="custom-sources"] h1')
        check('No source: what it is and the way to Extensions',page.locator('[data-custom-sources-none]').inner_text().startswith('No custom sources')
              and page.locator('[data-custom-sources-none] a').get_attribute('href')=='/extensions')
        page.close()
        page=open_page('custom',width=320,height=640,language='de',html_style='-webkit-text-size-adjust:200%;text-size-adjust:200%',path='/custom-sources?provider=kitsu',ready='[data-phone-screen="custom-sources"] h1')
        check('German, 320px with 200% text: no overflow',page.locator('h1').inner_text()=='Eigene Quellen' and page.evaluate(NO_OVERFLOW))
        shot(page,'custom-320-200.png')
        page.close()

        # LuffyError
        page=open_page('luffy',ready='[data-luffy-error]')
        block=page.locator('[data-luffy-error]')
        check('LuffyError: the kit\'s empty block, no picture, title and text',block.get_attribute('class').startswith('ps-empty') and page.locator('[data-luffy-error-image]').count()==0
              and block.inner_text().split()[:6]==['Transcoding','not','enabled','Turn','it','on'])
        check('LuffyError: Try again at 48px',page.locator('[data-luffy-error-content-button-reset]').inner_text()=='Try again' and small(page,'[data-luffy-error] button')==[])
        shot(page,'luffy-390.png')
        page.close()

        # Issue recorder
        page=open_page('recorder')
        page.evaluate('openRecorder()');page.wait_for_timeout(300)
        ready=page.locator('[data-issue-recorder=ready]');rb=ready.bounding_box();nav=page.locator('#__seanime_bottom_nav').bounding_box()
        check('Recorder: a panel above the bottom bar with Close and Start',ready.count()==1 and rb['y']+rb['height']<=nav['y']-8 and rb['x']>=15
              and page.locator('[data-issue-recorder-start]').inner_text()=='Start')
        check('Recorder: the scan logs switch above it, 48px targets',page.locator('[data-issue-recorder-scan-logs]').get_attribute('aria-checked')=='false'
              and small(page,'.ps-float button, .issue-phone-option button')==[])
        shot(page,'recorder-ready-390.png')
        page.locator('[data-issue-recorder-start]').click();page.wait_for_timeout(1300)
        rec=page.locator('[data-issue-recorder=recording]')
        check('Recording: time and events, Note and Stop',rec.count()==1 and 'Recording · 00:0' in rec.inner_text() and page.locator('[data-issue-recorder-stop]').inner_text()=='Stop')
        shot(page,'recorder-recording-390.png')
        page.locator('[data-issue-recorder-note]').click();page.wait_for_timeout(500)
        page.locator('[data-issue-recorder-description]').fill('The player froze');page.wait_for_timeout(100)
        check('The recording panel waits under the open sheet',page.locator('[data-issue-recorder=recording]').is_hidden())
        check('Note sheet: the note, a screenshot, discard; 48px',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Note and screenshot'
              and page.locator('[data-issue-recorder-screenshot]').count()==1 and small(page,f'{SHEET} :is(button,textarea)')==[])
        shot(page,'recorder-note-390.png')
        page.locator(f'{SHEET} .ps-primary').click();page.wait_for_timeout(400)
        check('Done keeps the note on the recording',page.locator('[data-issue-recorder=recording] .ps-float-text small').inner_text().endswith('note added'))
        page.locator('[data-issue-recorder-note]').click();page.wait_for_timeout(400);page.locator('[data-issue-recorder-cancel]').click();page.wait_for_timeout(400)
        check('Discard ends the recording',page.locator('[data-issue-recorder=recording]').count()==0 and page.locator('[data-issue-recorder=ready]').count()==1)
        page.close()
        check('No page errors',errors==[])
        browser.close()
print(json.dumps(checks,indent=2))
print(f'{sum(c["passed"] for c in checks)}/{len(checks)} passed')
