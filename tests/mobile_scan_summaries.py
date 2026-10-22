"""Scan summaries on Android phones: the phone screen instead of the desktop page, the newest scan first with its facts,
older scans in a native picker, files without an anime and the anime found (file counts, AniList state, errors and
warnings), a file's parsed name and scanner notes on demand, the filename search, the empty state with the scanner,
German texts, 48px targets and no overflow at 390px and at 320px with 200% text. Optional arg: screenshot dir."""
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
    if shots: page.screenshot(path=str(shots/name),full_page=True)

A='/storage/emulated/0/Anime'
def lf(path,title,ep,**more): return dict(path=path,name=path.split('/')[-1],parsedInfo=dict(original=path.split('/')[-1],title=title,episode=ep,**more),
    parsedFolderInfo=[dict(title=path.split('/')[-2])],locked=False,ignored=False,mediaId=0)
def f(id,path,title,ep,logs=(),**more): return dict(id=id,localFile=lf(path,title,ep,**more),logs=[dict(id=f'{id}-{i}',filePath=path,level=l,message=m) for i,(l,m) in enumerate(logs)])
COVER='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>'
NEW=dict(id='s2',groups=[
    dict(id='g1',mediaId=154587,mediaTitle='Sousou no Frieren',mediaImage=COVER,mediaIsInCollection=True,files=[
        f('a1',f'{A}/Frieren/Frieren - 01.mkv','Frieren','1',[('info','Matched to Sousou no Frieren (score 0.98)')]),
        f('a2',f'{A}/Frieren/Frieren - 02.mkv','Frieren','2',[('warning','Episode number above the anime\'s count, kept as 2')])]),
    dict(id='g2',mediaId=21,mediaTitle='One Piece',mediaImage=COVER,mediaIsInCollection=False,files=[
        f('b1',f'{A}/One Piece/OP 1000.mkv','One Piece','1000',[('error','Could not read the episode number')])])],
    unmatchedFiles=[f('u1',f'{A}/Misc/random clip.mp4','random clip','',[('info','No anime with a matching title')])])
OLD=dict(id='s1',groups=[dict(id='g0',mediaId=16498,mediaTitle='Shingeki no Kyojin',mediaImage=COVER,mediaIsInCollection=True,
    files=[f('c1',f'{A}/AoT/AoT 01.mkv','AoT','1')])],unmatchedFiles=[])
STATUS=dict(version='3.10.4',os='android',user=dict(viewer=dict(name='Nick'),isSimulated=False),themeSettings=dict(id=1),
    settings=dict(library=dict(libraryPath=A,libraryPaths=None,autoScan=False),anilist=dict(enableAdultContent=False)))
SERVER=dict(status=STATUS,collection=dict(lists=[],unmatchedLocalFiles=[],unmatchedGroups=[],unknownGroups=[],ignoredLocalFiles=[]),media={},suggestions={},
    scanSummaries=[dict(createdAt='2026-10-20T09:00:00Z',scanSummary=OLD),dict(createdAt='2026-10-22T10:30:00Z',scanSummary=NEW)])
INIT='''(()=>{Object.assign(window,{server:%s,routes:[],requests:[],toasts:[],previews:[],command:[],explorer:[],completed:0})})()'''
STATIC=root/'backend/seanime-web/out/static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>(b.textContent||b.getAttribute("aria-label")||b.tagName).trim().slice(0,40)))'''
TARGETS='[data-phone-screen] :is(button,a,select,input)'

with tempfile.TemporaryDirectory(prefix='seanime-scans-') as tmp:
    bundle=Path(tmp)/'scans.js'
    subprocess.run(['node',str(root/'tests/mobile_library_bundle.cjs'),str(bundle),'mobile_scan_summaries_harness.tsx'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,language=None,server=None,html_style=''):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True,locale='en-GB',timezone_id='Europe/Berlin')
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script(INIT%json.dumps(server or copy.deepcopy(SERVER)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            page.route('http://scans.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            html=f'<html class="dark" lang="en" style="{html_style}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
            page.route('http://scans.test/',lambda r:r.fulfill(content_type='text/html',body=html))
            page.goto('http://scans.test/')
            for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator('[data-phone-screen="scan-summaries"] h1').wait_for();page.wait_for_timeout(700)
            return page
        def small(page): return page.evaluate(SMALL,TARGETS)

        page=open_page()
        check('Phone screen replaces the desktop page',page.locator('[data-desktop-banner]').count()==0 and page.locator('[data-phone-screen="scan-summaries"] h1').inner_text()=='Scan summaries')
        facts=page.locator('[data-phone-facts]').inner_text()
        check('Facts: the newest scan, its anime and its files without one',facts.endswith('2 anime · 1 not matched') and '22 Oct 2026' in facts)
        check('Picker: scans newest first, the newest chosen',page.evaluate('[...document.querySelectorAll("[data-scan-picker] option")].map(o=>o.value)')==['s2','s1']
              and page.locator('[data-scan-picker]').input_value()=='s2')
        check('Sections: not matched first, then the anime found, with counts',page.evaluate('[...document.querySelectorAll("[data-scan-section]")].map(s=>s.dataset.scanSection)')==['unmatched','found']
              and page.locator('#pss-unmatched').inner_text()=='Not matched1' and page.locator('#pss-found').inner_text()=='Anime found2')
        groups=page.evaluate('[...document.querySelectorAll("[data-scan-group]")].map(g=>g.querySelector(".pss-group-head").innerText.replace(/\\s+/g," ").trim())')
        check('Anime: sorted by title, files, AniList state and problems',groups==['One Piece 1 file · not on your AniList 1 error','Sousou no Frieren 2 files · on your AniList 1 warning'])
        check('48px targets, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'scans-390.png')
        page.locator('[data-scan-group="154587"] .pss-group-head').click();page.wait_for_timeout(200)
        check('An anime opens its files and a link to it',page.locator('[data-scan-group="154587"] [data-scan-file]').count()==2
              and page.locator('[data-scan-group="154587"] .pss-open').get_attribute('href')=='/entry?id=154587'
              and page.locator('[data-scan-group="154587"] .pss-group-head').get_attribute('aria-expanded')=='true')
        row=page.locator(f'[data-scan-file="{A}/Frieren/Frieren - 02.mkv"]')
        check('A file with a warning says so',row.get_attribute('data-level')=='warning' and row.locator('small').inner_text()=='Warnings')
        row.locator('.pss-file-head').click();page.wait_for_timeout(200)
        body=row.locator('.pss-file-body').inner_text()
        check('A file opens its path, what was read and the notes',f'{A}/Frieren/Frieren - 02.mkv' in body and 'Episode\n2' in body and 'Title\nFrieren · Frieren' in body
              and "Episode number above the anime's count" in body and 'Part\n–' in body)
        check('Open: 48px targets, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'scans-open-390.png')
        page.locator('[data-scan-search]').fill('op 10');page.wait_for_timeout(600)
        check('Search: only the matching file, opened',page.evaluate('[...document.querySelectorAll("[data-scan-group]")].map(g=>+g.dataset.scanGroup)')==[21]
              and page.locator('[data-scan-section=unmatched]').count()==0 and page.locator(f'[data-scan-file="{A}/One Piece/OP 1000.mkv"] .pss-file-body').count()==1)
        page.locator('[data-scan-search]').fill('nothing like this');page.wait_for_timeout(600)
        check('Search with no hit says so',page.locator('[data-scan-nothing]').count()==1 and page.locator('[data-scan-section]').count()==0)
        page.locator('[data-scan-search]').fill('');page.wait_for_timeout(500)
        page.locator('[data-scan-picker]').select_option('s1');page.wait_for_timeout(300)
        check('Picker: an older scan',page.locator('[data-phone-facts]').inner_text().endswith('1 anime') and page.evaluate('[...document.querySelectorAll("[data-scan-group]")].map(g=>+g.dataset.scanGroup)')==[16498])
        page.close()

        server=copy.deepcopy(SERVER);server['scanSummaries']=[]
        page=open_page(server=server)
        check('No scans: says what will show here, offers the scan',page.locator('[data-scan-empty]').inner_text().startswith('No scans yet') and page.locator('[data-scan-start]').count()==1)
        page.locator('[data-scan-start]').click();page.wait_for_timeout(500)
        check('Scan library opens the local library sheet',page.locator('[data-library-phone-sheet]').count()==1)
        page.close()

        page=open_page(width=320,height=640,language='de',html_style='-webkit-text-size-adjust:200%;text-size-adjust:200%')
        check('German',page.locator('h1').inner_text()=='Scan-Berichte' and page.locator('#pss-unmatched').inner_text()=='Ohne Anime1' and page.locator('[data-phone-facts]').inner_text().endswith('2 Anime · 1 ohne Anime'))
        page.locator('[data-scan-group="21"] .pss-group-head').click();page.wait_for_timeout(200)
        page.locator('[data-scan-group="21"] .pss-file-head').click();page.wait_for_timeout(200)
        check('320px, 200% text: no overflow, 48px',page.evaluate(NO_OVERFLOW) and small(page)==[])
        shot(page,'scans-320-200.png')
        page.close()
        check('No page errors',errors==[])
        browser.close()
print(json.dumps(checks,indent=2))
print(f'{sum(c["passed"] for c in checks)}/{len(checks)} passed')
