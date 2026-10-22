"""Local library on Android phones: Home's header action and queue rows, the "Local library" sheet (facts, queues, scan
options and Refresh, the jobs on all files with a confirmation before removing folders, scan summaries), the unmatched
files sheet (folders, suggestions, search, AniList ID, picked files, Match and Ignore), hidden anime (add one or all,
unmatch), ignored files, the bulk modal gone, scan progress and the library watcher above the bottom bar, Android Back,
German texts, 48px targets and no overflow at 390px and at 320px with 200% text. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, copy
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];warnings=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name):
    if shots: page.screenshot(path=str(shots/name))

def lf(path,ep): return dict(path=path,name=path.split('/')[-1],parsedInfo=dict(original=path.split('/')[-1],episode=ep),locked=False,ignored=False,mediaId=0)
def anime(id,title,fmt,year,eps): return dict(id=id,title=dict(romaji=title,userPreferred=title),format=fmt,startDate=dict(year=year),episodes=eps,
    coverImage=dict(medium=f'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>'))
A='/storage/emulated/0/Anime'
FRIEREN=f'{A}/Sousou no Frieren'; JJK=f'{A}/Jujutsu Kaisen S2'
COLLECTION=dict(lists=[dict(type='CURRENT',status='CURRENT',entries=[dict(mediaId=16498)])],
    stats=dict(totalEntries=12,totalFiles=148,totalShows=10,totalMovies=2,totalSpecials=0,totalSize='61.2 GB'),
    unmatchedLocalFiles=[lf(f'{FRIEREN}/[SubsPlease] Frieren - 02.mkv','2'),lf(f'{FRIEREN}/[SubsPlease] Frieren - 01.mkv','1'),lf(f'{JJK}/JJK S2 - 01.mkv','1')],
    unmatchedGroups=[dict(dir=FRIEREN,localFiles=[lf(f'{FRIEREN}/[SubsPlease] Frieren - 02.mkv','2'),lf(f'{FRIEREN}/[SubsPlease] Frieren - 01.mkv','1')]),
        dict(dir=JJK,localFiles=[lf(f'{JJK}/JJK S2 - 01.mkv','1')])],
    unknownGroups=[dict(mediaId=21,localFiles=[lf(f'{A}/One Piece/OP 1000.mkv','1000'),lf(f'{A}/One Piece/OP 1001.mkv','1001')]),
        dict(mediaId=113415,localFiles=[lf(f'{A}/JJK/JJK 01.mkv','1')])],
    ignoredLocalFiles=[dict(lf(f'{A}/Extras/NCOP.mkv',''),ignored=True)])
MEDIA={154587:anime(154587,'Sousou no Frieren','TV',2023,28),21:anime(21,'One Piece','TV',1999,None),113415:anime(113415,'Jujutsu Kaisen','TV',2020,24),
    16498:anime(16498,'Shingeki no Kyojin','TV',2013,25),145064:anime(145064,'Jujutsu Kaisen 2nd Season','TV',2023,23)}
STATUS=dict(version='3.10.4',os='android',isOffline=False,user=dict(viewer=dict(name='Nick'),isSimulated=False),themeSettings=dict(id=1),
    settings=dict(library=dict(libraryPath=f'{A}',libraryPaths=['/storage/emulated/0/Download/Seanime'],autoScan=False),anilist=dict(enableAdultContent=False)))
SERVER=dict(status=STATUS,collection=COLLECTION,media={str(k):v for k,v in MEDIA.items()},suggestions={FRIEREN:[154587]},userMedia=[MEDIA[16498]])
INIT='''(()=>{Object.assign(window,{server:%s,routes:[],requests:[],toasts:[],previews:[],command:[],completed:0})})()'''
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
STATIC=root/'backend/seanime-web/out/static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
TARGETS=':is(button,a,select,input,[role=switch],[role=radio],[role=checkbox])'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>(b.textContent||b.getAttribute("aria-label")||b.tagName).trim().slice(0,40)))'''
SHEETS='[...document.querySelectorAll(".UI-Modal__content[data-state=open]")].length'
SHEET='.UI-Modal__content[data-state=open]'

def reqs(page,method,endpoint): return [r[2] for r in page.evaluate('requests') if r[0]==method and r[1]==endpoint]
def ws(page,type,payload): page.evaluate('([t,p])=>dispatchEvent(new CustomEvent("ws",{detail:{type:t,payload:p}}))',[type,payload]);page.wait_for_timeout(200)

with tempfile.TemporaryDirectory(prefix='seanime-library-') as tmp:
    bundle=Path(tmp)/'library.js'
    subprocess.run(['node',str(root/'tests/mobile_library_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,language=None,server=None,html_style=''):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.on('console',lambda m:warnings.append(m.text[:300]) if m.type=='error' else None)
            page.add_init_script(INIT%json.dumps(server or copy.deepcopy(SERVER)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            page.route('http://library.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            html=f'<html class="dark" lang="en" style="{html_style}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
            page.route('http://library.test/',lambda r:r.fulfill(content_type='text/html',body=html))
            page.goto('http://library.test/')
            for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator('[data-library-phone-action]').wait_for();page.evaluate('document.fonts.ready');page.wait_for_timeout(600)
            return page
        def back(page):
            ok=page.evaluate(NATIVE_BACK);page.wait_for_timeout(400);return ok
        def tap(page,sel,wait=400):
            page.locator(sel).first.click();page.wait_for_timeout(wait)
        def small(page): return page.evaluate(SMALL,f'{SHEET} {TARGETS}, [data-library-phone-attention] {TARGETS}, [data-home-navbar] {TARGETS}, .ps-float {TARGETS}')
        def sheet_text(page): return page.locator(SHEET).inner_text()

        # Home: header action with its mark, queue rows
        page=open_page()
        action=page.locator('[data-library-phone-action]')
        box=action.bounding_box()
        check('Home: the library is one 48dp header action, marked while queues wait',box['width']>=48 and box['height']>=48
              and action.get_attribute('aria-label')=='Local library, 5 need attention' and action.locator('.plib-dot').count()==1)
        rows=page.locator('[data-library-phone-attention] .ps-action')
        check('Home: one row per queue, counted in words',rows.count()==2 and 'files have no anime yet' in rows.nth(0).inner_text()
              and rows.nth(0).inner_text().startswith('3 files') and rows.nth(1).inner_text().startswith('2 anime are hidden'))
        check('Home: 48px targets, no overflow, no desktop toolbar or bulk modal',small(page)==[] and page.evaluate(NO_OVERFLOW)
              and page.locator('text=Resolve unmatched').count()==0 and page.locator('text=Bulk actions').count()==0)
        shot(page,'library-home-390.png')

        # The Local library sheet
        tap(page,'[data-library-phone-action]',600)
        sheet=page.locator('[data-library-phone-sheet]')
        check('Sheet: opens as the one sheet with its title',page.evaluate(SHEETS)==1 and page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Local library')
        facts=page.locator('[data-library-facts]').inner_text()
        check('Sheet: both folders in full and the library facts',f'{A}' in facts and '/storage/emulated/0/Download/Seanime' in facts
              and '12' in facts and '148 files · 61.2 GB' in facts)
        check('Sheet: queues with counts in the attention tone',page.evaluate('[...document.querySelectorAll("[data-library-group=queues] .ps-action")].map(r=>[r.dataset.libraryOpen,r.dataset.tone,r.querySelector(".ps-action-value").textContent])')
              ==[['unmatched','attention','3'],['hidden','attention','2']])
        switches=page.evaluate('[...document.querySelectorAll("[data-library-option]")].filter(e=>e.getAttribute("role")=="switch").map(e=>[e.dataset.libraryOption,e.getAttribute("aria-checked")])')
        check('Sheet: scan options default on, the source choice hidden while only AniList-list anime are matched',
              switches==[['skip-locked','true'],['skip-ignored','true'],['list-only','true']] and page.locator('[data-library-option=source]').count()==0)
        check('Sheet: Refresh is the one primary action, in the footer',page.locator(f'{SHEET} .ps-primary').count()==1
              and page.locator('[data-library-scan]').inner_text().strip()=='Refresh library' and page.locator('.ps-sheet-actions [data-library-scan]').count()==1)
        check('Sheet: 48px targets, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'library-sheet-390.png')
        page.locator(f'{SHEET} .ps-sheet-body').evaluate('e=>e.parentElement.scrollTop=9999');page.wait_for_timeout(200)
        shot(page,'library-sheet-end-390.png')
        tap(page,'[data-library-scan]',700)
        check('Refresh: scans with the options shown and closes the sheet',reqs(page,'POST','/api/v1/library/scan')==[dict(enhanced=False,skipLockedFiles=True,skipIgnoredFiles=True,enhanceWithOfflineDatabase=True)]
              and page.evaluate(SHEETS)==0)
        tap(page,'[data-library-phone-action]',600)
        tap(page,'[data-library-option=list-only]')
        check('Matching all of AniList shows where titles come from, the offline database chosen',
              page.evaluate('[...document.querySelectorAll("[data-library-source]")].map(e=>[e.dataset.librarySource,e.getAttribute("role"),e.getAttribute("aria-checked")])')
              ==[['database','radio','true'],['anilist','radio','false']] and page.locator('[data-library-option=source][role=radiogroup]').count()==1)
        tap(page,'[data-library-source=anilist]');tap(page,'[data-library-option=skip-locked]')
        tap(page,'[data-library-scan]',700)
        check('Refresh: the changed options reach the scan',reqs(page,'POST','/api/v1/library/scan')[-1]==dict(enhanced=True,skipLockedFiles=False,skipIgnoredFiles=True,enhanceWithOfflineDatabase=False))
        tap(page,'[data-library-phone-action]',600)
        tap(page,'[data-library-bulk=lock]',500)
        check('Lock all files: one request, a toast, the sheet stays',reqs(page,'POST','/api/v1/library/local-files')==[dict(action='lock')]
              and ['success','All files locked'] in page.evaluate('toasts') and page.evaluate(SHEETS)==1)
        tap(page,'[data-library-bulk=remove-empty]')
        check('Remove empty folders asks first, in the same sheet',page.locator('[data-library-phone-confirm]').count()==1 and page.evaluate(SHEETS)==1
              and page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Remove empty folders?' and reqs(page,'DELETE','/api/v1/library/empty-directories')==[])
        check('Confirm: 48px targets',small(page)==[])
        shot(page,'library-confirm-390.png')
        tap(page,'[data-library-phone-confirm] .ps-secondary')
        check('Cancel returns to the library sheet',page.locator('[data-library-phone-sheet]').count()==1)
        tap(page,'[data-library-bulk=remove-empty]');tap(page,'[data-library-confirm-remove]',600)
        check('Remove: one request, back on the library sheet',len(reqs(page,'DELETE','/api/v1/library/empty-directories'))==1 and page.locator('[data-library-phone-sheet]').count()==1)
        check('Scan summaries is a link to its page',page.locator('[data-library-open=summaries]').get_attribute('href')=='/scan-summaries')
        check('Back closes the sheet',back(page) and page.evaluate(SHEETS)==0)

        # Unmatched files
        tap(page,'[data-library-phone-action]',600)
        tap(page,f'{SHEET} [data-library-open=unmatched]',900)
        check('A queue opens in its own sheet, the library sheet closed',page.evaluate(SHEETS)==1 and page.locator('[data-library-unmatched]').count()==1)
        check('Unmatched: the first folder, 1 of 2, its suggestions asked for',page.locator('[data-unmatched-folder]').inner_text().startswith('Sousou no Frieren')
              and page.locator('[data-unmatched-folder] small').inner_text()=='Folder 1 of 2 · Anime' and reqs(page,'POST','/api/v1/library/anime-entry/suggestions')[-1]==dict(dir=FRIEREN))
        files=page.evaluate('[...document.querySelectorAll("[data-unmatched-file]")].map(e=>[e.querySelector(".ps-pick-text > span").textContent,e.getAttribute("aria-checked")])')
        check('Unmatched: files by episode, all picked',files==[['[SubsPlease] Frieren - 01.mkv','true'],['[SubsPlease] Frieren - 02.mkv','true']])
        check('Unmatched: the suggestion as a radio with cover and facts',page.evaluate('[...document.querySelectorAll("[data-unmatched-choice]")].map(e=>[e.getAttribute("role"),e.innerText.replace(/\\s+/g," ").trim(),!!e.querySelector(".ps-pick-cover img")])')
              ==[['radio','Sousou no Frieren TV · 2023 · 28 episodes',True]])
        check('Unmatched: Match waits for an anime',page.locator('[data-unmatched-match]').is_disabled() and page.locator('[data-unmatched-match]').inner_text().strip()=='Match 2 files')
        check('Unmatched: 48px targets, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'library-unmatched-390.png')
        page.locator('[data-unmatched-file]').nth(1).click();page.wait_for_timeout(200)
        check('Unpicking a file updates the count and the action',page.locator('[data-unmatched-files] .ps-sheet-note').inner_text()=='1 of 2 picked'
              and page.locator('[data-unmatched-match]').inner_text().strip()=='Match 1 file')
        tap(page,'[data-unmatched-choice="154587"]',200)
        tap(page,'[data-unmatched-match]',800)
        check('Match: the picked file to the chosen anime, a toast',reqs(page,'POST','/api/v1/library/anime-entry/manual-match')==[dict(paths=[f'{FRIEREN}/[SubsPlease] Frieren - 01.mkv'],mediaId=154587)]
              and ['success','Files matched'] in page.evaluate('toasts'))
        page.wait_for_timeout(600)
        check('After a match the queue refreshes: the folder keeps its last file',page.evaluate('[...document.querySelectorAll("[data-unmatched-file]")].length')==1
              and 'Folder 1 of 2' in page.locator('[data-unmatched-folder]').inner_text())
        tap(page,'[data-unmatched-next]',800)
        check('Next: the second folder, no suggestions, a hint to search',page.locator('[data-unmatched-folder]').inner_text().startswith('Jujutsu Kaisen S2')
              and page.locator('[data-unmatched-none]').inner_text()=='No suggestions for this folder. Search above.')
        page.locator('[data-unmatched-search]').fill('jujutsu');page.wait_for_timeout(900)
        check('Search: AniList titles, no adult results',reqs(page,'POST','/api/v1/anilist/list-anime')[-1]==dict(search='jujutsu',page=1,perPage=8,isAdult=False)
              and page.evaluate('[...document.querySelectorAll("[data-unmatched-choice]")].map(e=>+e.dataset.unmatchedChoice)')==[113415,145064])
        page.locator('[data-unmatched-search]').fill('145064');page.wait_for_timeout(900)
        check('An AniList ID finds that anime',any(r[1]=='/api/v1/library/anime-entry/145064' for r in page.evaluate('requests'))
              and page.evaluate('[...document.querySelectorAll("[data-unmatched-choice]")].map(e=>+e.dataset.unmatchedChoice)')==[145064])
        shot(page,'library-unmatched-search-390.png')
        tap(page,'[data-unmatched-ignore]',800)
        check('Ignore: the picked files are ignored',reqs(page,'PATCH','/api/v1/library/local-files')==[dict(paths=[f'{JJK}/JJK S2 - 01.mkv'],action='ignore')]
              and ['success','Files ignored'] in page.evaluate('toasts'))
        page.wait_for_timeout(600)
        check('Back on the first folder, still open',page.locator('[data-unmatched-folder]').inner_text().startswith('Sousou no Frieren'))
        check('Back closes the unmatched sheet',back(page) and page.evaluate(SHEETS)==0)
        check('Home rows follow the queue',page.locator('[data-library-phone-attention] .ps-action').nth(0).inner_text().startswith('1 file has no anime yet'))

        # Hidden anime
        tap(page,'[data-library-open=hidden]',900)
        check('Hidden: one block per anime with its title from AniList and its file count',
              page.evaluate('[...document.querySelectorAll("[data-hidden-anime] .ps-pick-text > span")].map(e=>e.textContent)')==['One Piece','Jujutsu Kaisen']
              and page.locator('[data-hidden-anime="21"] small').inner_text().startswith('2 files'))
        tap(page,'[data-hidden-anime="21"] .plib-hidden-head',300)
        check('Hidden: the files show on demand',page.locator('[data-hidden-anime="21"] .plib-files li').count()==2
              and page.locator('[data-hidden-anime="21"] .plib-hidden-head').get_attribute('aria-expanded')=='true')
        check('Hidden: Add all in the footer, 48px targets, no overflow',page.locator('[data-hidden-add-all]').inner_text().strip()=='Add all 2 to AniList'
              and small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'library-hidden-390.png')
        tap(page,'[data-hidden-anime="113415"] [data-hidden-unmatch]',800)
        check('Unmatch: that anime\'s files',reqs(page,'PATCH','/api/v1/library/anime-entry/bulk-action')==[dict(mediaId=113415,action='unmatch')]
              and ['success','Files unmatched'] in page.evaluate('toasts'))
        page.wait_for_timeout(500)
        tap(page,'[data-hidden-anime="21"] [data-hidden-add]',900)
        check('Add: that anime to AniList; the last one leaves an empty queue and the sheet closes',reqs(page,'POST','/api/v1/library/unknown-media')==[dict(mediaIds=[21])]
              and page.evaluate(SHEETS)==0 and page.evaluate('completed')>=2)

        # Ignored files
        tap(page,'[data-library-phone-action]',600)
        tap(page,f'{SHEET} [data-library-open=ignored]',900)
        names=page.evaluate('[...document.querySelectorAll("[data-ignored-file] .ps-pick-text > span")].map(e=>e.textContent)')
        check('Ignored: every ignored file, none picked, the action waits',names==['NCOP.mkv','JJK S2 - 01.mkv'] and page.locator('[data-ignored-unignore]').is_disabled())
        tap(page,'[data-ignored-all]',200)
        check('Pick all names the count',page.locator('[data-ignored-unignore]').inner_text().strip()=='Stop ignoring 2 files')
        shot(page,'library-ignored-390.png')
        tap(page,'[data-ignored-unignore]',800)
        check('Stop ignoring: one request with the picked files',reqs(page,'PATCH','/api/v1/library/local-files')[-1]==dict(paths=[f'{A}/Extras/NCOP.mkv',f'{JJK}/JJK S2 - 01.mkv'],action='unignore'))
        page.wait_for_timeout(500)
        check('Empty: the queue says so',page.locator(f'{SHEET} .ps-empty').inner_text().startswith('No ignored files') and page.locator('[data-ignored-unignore]').count()==0)
        back(page)

        # Scan progress and the library watcher, above the bottom bar
        page.evaluate('store.set(atoms.scanning,true)');page.wait_for_timeout(200)
        ws(page,'scan-progress',42);ws(page,'scan-status','Matching files…')
        fl=page.locator('[data-library-status=scanning]')
        nav=page.locator('#__seanime_bottom_nav').bounding_box();fb=fl.bounding_box()
        check('Scanning: a status with the percentage above the bottom bar, not over it',fl.count()==1 and '42 % · Matching files…' in fl.inner_text()
              and fb['y']+fb['height']<=nav['y']-8 and fb['x']>=15 and page.locator('[data-scan-progress-bar-card]').count()==0)
        shot(page,'library-scanning-390.png')
        page.evaluate('store.set(atoms.scanning,false)');page.wait_for_timeout(200)
        ws(page,'library-watcher-file-added','/storage/emulated/0/Anime/new.mkv')
        ch=page.locator('[data-library-status=changed]')
        check('Watcher: a change found offers Refresh and Later, 48px',ch.count()==1 and 'Your library folder changed' in ch.inner_text() and small(page)==[])
        shot(page,'library-changed-390.png')
        tap(page,'[data-library-status-refresh]',600)
        check('Watcher: Refresh opens the library sheet and the status goes',page.locator('[data-library-phone-sheet]').count()==1 and ch.count()==0)
        back(page)
        page.close()

        # No folder: the sheet says where to set one
        server=copy.deepcopy(SERVER);server['status']['settings']['library'].update(libraryPath='',libraryPaths=None)
        page=open_page(server=server)
        tap(page,'[data-library-phone-action]',600)
        check('No folder: the sheet points to the settings, Refresh disabled',page.locator(f'{SHEET} .ps-empty').inner_text().startswith('No library folder')
              and page.locator(f'{SHEET} .ps-empty a').get_attribute('href')=='/settings?tab=library' and page.locator('[data-library-scan]').is_disabled())
        page.close()

        # German, 320px with 200% text
        page=open_page(width=320,height=640,language='de',html_style='-webkit-text-size-adjust:200%;text-size-adjust:200%')
        check('German: header action and rows',page.locator('[data-library-phone-action]').get_attribute('aria-label')=='Lokale Bibliothek, 5 brauchen dich'
              and page.locator('[data-library-phone-attention] .ps-action').nth(0).inner_text().startswith('3 Dateien haben noch keinen Anime'))
        check('320px, 200% text: Home without overflow',page.evaluate(NO_OVERFLOW))
        tap(page,'[data-library-phone-action]',600)
        check('German: the sheet',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Lokale Bibliothek' and page.locator('[data-library-scan]').inner_text().strip()=='Bibliothek aktualisieren')
        check('320px, 200% text: sheet without overflow, 48px',page.evaluate(NO_OVERFLOW) and small(page)==[])
        shot(page,'library-sheet-320-200.png')
        back(page)
        tap(page,'[data-library-phone-attention] [data-library-open=unmatched]',900)
        check('320px, 200% text: unmatched without overflow, German action',page.evaluate(NO_OVERFLOW) and page.locator('[data-unmatched-match]').inner_text().strip()=='2 Dateien zuordnen')
        shot(page,'library-unmatched-320-200.png')
        page.close()

        check('No page errors',errors==[])
        browser.close()
print(json.dumps(checks,indent=2))
print(f'{sum(c["passed"] for c in checks)}/{len(checks)} passed')
if warnings: print('console errors:',json.dumps(warnings[:5],indent=1))
