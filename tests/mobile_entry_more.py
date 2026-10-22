"""Anime page "More", long-press menus and the preview on Android phones: the More sheet instead of the desktop dropdown
(the anime on AniList, AniDB and MyAnimeList, filler and specials, the local files, plugin actions), filler fetch and
removal, the specials' series link (the parent suggested, saved, unlinked), unmatching and deleting picked files after one
confirmation, no file actions outside the library view; long-press menus with the phone surface, 48px rows, 16px from the
edges and a two-line title; the preview as a sheet (facts, list state, synopsis, trailer, the page), for anime and manga;
German texts, no overflow at 390px and at 320px with 200% text. Optional arg: screenshot dir."""
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

A='/storage/emulated/0/Anime/Frieren'
COVER='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>'
def files(n): return [dict(path=f'{A}/Frieren - {i:02d}.mkv',name=f'Frieren - {i:02d}.mkv',metadata=dict(episode=i),locked=False,ignored=False,mediaId=154587) for i in range(n,0,-1)]
FRIEREN=dict(mediaId=154587,anidbId=17617,libraryData=dict(allFilesLocked=False),listData=dict(status='CURRENT',progress=10),localFiles=files(3),
    media=dict(id=154587,idMal=52991,format='TV',season='FALL',seasonYear=2023,episodes=28,status='FINISHED',genres=['Adventure','Drama','Fantasy'],
        title=dict(userPreferred='Sousou no Frieren'),coverImage=dict(large=COVER),trailer=dict(id='qgQ3Bg2mY6s',site='youtube'),
        description='The adventure is over but life goes on for an elf mage just beginning to learn what living is all about.<br><br>'+'Elf mage Frieren and her courageous fellow adventurers have defeated the Demon King. '*4))
SPECIAL=dict(mediaId=999,anidbId=0,libraryData=None,listData=None,localFiles=[],
    media=dict(id=999,format='SPECIAL',seasonYear=2024,title=dict(userPreferred='Frieren: Mini Specials'),coverImage=dict(large=COVER)))
MANGA=dict(mediaId=30002,listData=dict(status='CURRENT',progress=120),media=dict(id=30002,format='MANGA',startDate=dict(year=1989),chapters=364,status='FINISHED',
    title=dict(userPreferred='Berserk'),coverImage=dict(large=COVER),genres=['Action'],description='Guts, a former mercenary.'))
STATUS=dict(version='3.10.4',os='android',isOffline=False,user=dict(viewer=dict(name='Nick')),themeSettings=dict(id=1),settings=dict(library=dict()))
SERVER=dict(status=STATUS,anime={'154587':FRIEREN,'999':SPECIAL},manga={'30002':MANGA},parents={},
    details=dict(id=999,relations=dict(edges=[dict(relationType='PARENT',node=dict(id=154587))])),pluginItems=[dict(id='p1',label='Send to Trakt',extensionId='trakt')])
INIT='''(()=>{Object.assign(window,{server:%s,view:%s,entryId:%s,previewId:154587,previewType:"anime",routes:[],requests:[],toasts:[],clipboard:[],tabs:[],pluginClicks:[]})})()'''
STATIC=root/'backend/seanime-web/out/static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SHEET='.UI-Modal__content[data-state=open]'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>(b.textContent||b.getAttribute("aria-label")||b.tagName).trim().slice(0,40)))'''
TARGETS=f'{SHEET} :is(button,a,input), [data-anime-meta-section-buttons-row] button'
SHEETS='document.querySelectorAll(".UI-Modal__content[data-state=open]").length'
def reqs(page,method,endpoint): return [r[2] for r in page.evaluate('requests') if r[0]==method and r[1]==endpoint]

with tempfile.TemporaryDirectory(prefix='seanime-entry-more-') as tmp:
    bundle=Path(tmp)/'more.js'
    subprocess.run(['node',str(root/'tests/mobile_entry_more_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,language=None,view='library',entry=154587,html_style=''):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script(INIT%(json.dumps(copy.deepcopy(SERVER)),json.dumps(view),json.dumps(entry)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            page.route('http://more.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            html=f'<html class="dark" lang="en" style="{html_style}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
            page.route('http://more.test/',lambda r:r.fulfill(content_type='text/html',body=html))
            page.goto('http://more.test/')
            for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator('[data-anime-entry-dropdown-menu-trigger]').wait_for();page.wait_for_timeout(500)
            return page
        def tap(page,sel,wait=450):
            page.locator(sel).first.click();page.wait_for_timeout(wait)
        def small(page): return page.evaluate(SMALL,TARGETS)

        page=open_page()
        trig=page.locator('[data-anime-entry-dropdown-menu-trigger]');tb=trig.bounding_box()
        check('More: a 48dp button with a name, no desktop dropdown',tb['width']>=48 and tb['height']>=48 and trig.get_attribute('aria-label')=='More for this anime'
              and page.locator('[data-anime-entry-dropdown-menu]').count()==0)
        tap(page,'[data-anime-entry-dropdown-menu-trigger]')
        check('More: one sheet titled More',page.evaluate(SHEETS)==1 and page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='More')
        links=page.evaluate('[...document.querySelectorAll("[data-entry-link]")].map(a=>[a.dataset.entryLink,a.getAttribute("href"),a.target])')
        check('Elsewhere: AniList, AniDB and MyAnimeList open outside the app',links==[['AniList','https://anilist.co/anime/154587','_blank'],
              ['AniDB','https://anidb.net/anime/17617','_blank'],['MyAnimeList','https://myanimelist.net/anime/52991','_blank']])
        groups=page.evaluate('[...document.querySelectorAll(".UI-Modal__content[data-state=open] .ps-sheet-head h3")].map(h=>h.textContent)')
        check('Groups: elsewhere, episodes, the files on this phone, plugins',groups==['Elsewhere','Episodes','Files on this phone','Plugins']
              and '3 files' in page.locator(f'{SHEET}').inner_text())
        check('Delete carries the danger tone; 48px targets, no overflow',page.locator('[data-entry-open=delete]').get_attribute('data-tone')=='danger'
              and small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'more-390.png')
        tap(page,'[data-entry-plugin=p1]')
        check('A plugin action runs and the sheet closes',page.evaluate('pluginClicks')==['p1'] and page.evaluate(SHEETS)==0)

        # Filler
        tap(page,'[data-anime-entry-dropdown-menu-trigger]');tap(page,'[data-entry-open=metadata]',700)
        check('Filler and specials opens alone; a series with AniDB data has no specials link',page.evaluate(SHEETS)==1 and page.locator('[data-entry-metadata]').count()==1
              and page.locator('[data-metadata-group=parent]').count()==0 and page.locator('[data-metadata-parent-save]').count()==0)
        tap(page,'[data-metadata-filler=fetch]',500);tap(page,'[data-metadata-filler=remove]',500)
        check('Filler: fetch and remove for this anime',reqs(page,'POST','/api/v1/metadata-provider/filler')==[dict(mediaId=154587)]
              and reqs(page,'DELETE','/api/v1/metadata-provider/filler')==[dict(mediaId=154587)])
        check('Filler: 48px targets',small(page)==[])
        page.keyboard.press('Escape');page.wait_for_timeout(400)

        # Unmatch
        tap(page,'[data-anime-entry-dropdown-menu-trigger]');tap(page,'[data-entry-open=unmatch]',700)
        names=page.evaluate('[...document.querySelectorAll("[data-entry-file] .ps-pick-text > span")].map(e=>e.textContent)')
        check('Unmatch: files by episode, none picked, the action waits',names==['Frieren - 01.mkv','Frieren - 02.mkv','Frieren - 03.mkv']
              and page.locator('[data-entry-files-action]').is_disabled() and page.locator('[data-entry-files-action]').inner_text()=='Pick files')
        tap(page,'[data-entry-files-all]',200)
        check('Pick all names the count',page.locator('[data-entry-files-action]').inner_text()=='Unmatch 3 files')
        shot(page,'more-unmatch-390.png')
        tap(page,'[data-entry-files-action]')
        check('Unmatch asks first, in the same sheet',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Unmatch 3 files?' and reqs(page,'PATCH','/api/v1/library/local-files')==[])
        tap(page,'[data-entry-files-confirm-action]',600)
        check('Unmatch: the picked files, the sheet closes',reqs(page,'PATCH','/api/v1/library/local-files')==[dict(paths=[f'{A}/Frieren - 01.mkv',f'{A}/Frieren - 02.mkv',f'{A}/Frieren - 03.mkv'],action='unmatch')]
              and page.evaluate(SHEETS)==0)

        # Delete
        tap(page,'[data-anime-entry-dropdown-menu-trigger]');tap(page,'[data-entry-open=delete]',700)
        page.locator('[data-entry-file]').nth(1).click();page.wait_for_timeout(200)
        check('Delete: one picked, the danger action names it',page.locator('[data-entry-files-action]').inner_text()=='Delete 1 file'
              and page.locator('[data-entry-files-action]').get_attribute('data-tone')=='danger')
        tap(page,'[data-entry-files-action]')
        check('Delete asks first and says it cannot be undone',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Delete 1 file?' and "can't be undone" in page.locator(SHEET).inner_text())
        shot(page,'more-delete-confirm-390.png')
        tap(page,f'{SHEET} .ps-secondary',300)
        check('Back returns to the picked files',page.locator('[data-entry-files=delete]').count()==1 and page.locator('[data-entry-files-action]').inner_text()=='Delete 1 file')
        tap(page,'[data-entry-files-action]');tap(page,'[data-entry-files-confirm-action]',600)
        check('Delete: the picked file',reqs(page,'DELETE','/api/v1/library/local-files')==[dict(paths=[f'{A}/Frieren - 02.mkv'])] and page.evaluate(SHEETS)==0)

        # Long-press menu and the preview
        page.locator('[data-cover]').click(button='right');page.wait_for_timeout(500)
        menu=page.locator('[data-sea-context-menu-content]')
        mb=menu.bounding_box();vw=page.evaluate('innerWidth')
        rows=page.evaluate('[...document.querySelectorAll("[data-sea-context-menu-content] [role=menuitem]")].map(e=>e.getBoundingClientRect().height)')
        label=page.evaluate('(()=>{const l=document.querySelector("[data-phone-menu] .UI-ContextMenu__label");return {h:l.getBoundingClientRect().height,lh:parseFloat(getComputedStyle(l).lineHeight)}})()')
        vh=page.evaluate('innerHeight')
        check('Long press: an action sheet above the bottom bar, 16px margins, 48px rows, the title on two lines',menu.get_attribute('data-phone-menu')=='true'
              and all(h>=48 for h in rows) and abs(mb['x']-16)<1 and abs(mb['x']+mb['width']-(vw-16))<1 and mb['y']+mb['height']<=vh-88 and label['h']>=label['lh']*1.9)
        shot(page,'longpress-390.png')
        tap(page,'[data-menu-preview]',900)
        sheet=page.locator('[data-media-preview-phone]')
        text=page.locator(SHEET).inner_text()
        check('Preview: a sheet with the title, facts and list state',page.evaluate(SHEETS)==1 and sheet.count()==1
              and page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Sousou no Frieren' and 'TV · Fall 2023 · 28 episodes · Finished' in text
              and page.locator('[data-preview-status]').inner_text()=='Watching · 10 / 28')
        syn=page.locator('[data-preview-synopsis]')
        check('Preview: the synopsis as text, clamped with More',syn.inner_text().startswith('The adventure is over') and '<br>' not in syn.inner_text()
              and syn.evaluate('e=>e.scrollHeight>e.clientHeight+2'))
        tap(page,f'{SHEET} .mpp-synopsis .ps-text-action',200)
        check('More opens the whole synopsis',syn.get_attribute('data-open')=='true' and syn.evaluate('e=>e.scrollHeight<=e.clientHeight+2'))
        check('Preview: trailer outside the app, 48px targets, no overflow',page.locator('[data-preview-trailer]').get_attribute('href')=='https://www.youtube.com/watch?v=qgQ3Bg2mY6s'
              and small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'preview-390.png')
        tap(page,'[data-preview-open]',500)
        check('Open page goes to the anime and closes the preview',page.evaluate('routes')[-1]=='/entry?id=154587' and page.evaluate(SHEETS)==0)
        page.evaluate('window.previewId=30002;window.previewType="manga"')
        page.locator('[data-cover]').click(button='right');page.wait_for_timeout(400);tap(page,'[data-menu-preview]',900)
        check('Manga preview: chapters, reading state, its page',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Berserk' and '364 chapters' in page.locator(SHEET).inner_text()
              and page.locator('[data-preview-status]').inner_text()=='Reading · 120 / 364' and page.locator('[data-preview-open]').get_attribute('href')=='/manga/entry?id=30002'
              and page.locator('[data-preview-trailer]').count()==0)
        page.close()

        # Specials without AniDB data, outside the library view
        page=open_page(view='onlinestream',entry=999)
        tap(page,'[data-anime-entry-dropdown-menu-trigger]')
        check('Outside the library view: no file actions; no AniDB or MAL without their IDs',page.locator('[data-entry-open=unmatch]').count()==0
              and page.evaluate('[...document.querySelectorAll("[data-entry-link]")].map(a=>a.dataset.entryLink)')==['AniList'])
        tap(page,'[data-entry-open=metadata]',800)
        check('Specials: filler off with the reason, the series link offered',page.locator('[data-metadata-filler=fetch]').is_disabled()
              and 'only covers TV and web series' in page.locator('[data-metadata-group=filler]').inner_text() and page.locator('[data-metadata-parent-save]').is_disabled())
        tap(page,'[data-metadata-parent-suggest]',200)
        page.locator('[data-metadata-offset]').fill('1x');page.wait_for_timeout(100)
        check('The parent series fills the field; the offset keeps digits only',page.locator('[data-metadata-parent-id]').input_value()=='154587'
              and page.locator('[data-metadata-offset]').input_value()=='1' and page.locator('[data-metadata-parent-id]').get_attribute('inputmode')=='numeric')
        shot(page,'more-specials-390.png')
        tap(page,'[data-metadata-parent-save]',800)
        check('Save: the series link',reqs(page,'POST','/api/v1/metadata/parent')==[dict(mediaId=999,parentId=154587,specialOffset=1)]
              and page.locator('[data-metadata-parent-remove]').count()==1)
        tap(page,'[data-metadata-parent-remove]',600)
        check('Unlink removes it',reqs(page,'DELETE','/api/v1/metadata/parent')==[dict(mediaId=999)])
        check('Specials: 48px targets, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        page.close()

        # German, 320px with 200% text
        page=open_page(width=320,height=640,language='de',html_style='-webkit-text-size-adjust:200%;text-size-adjust:200%')
        tap(page,'[data-anime-entry-dropdown-menu-trigger]')
        check('German: More',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Mehr' and 'Dateien auf diesem Handy' in page.locator(SHEET).inner_text())
        check('320px, 200% text: no overflow, 48px',page.evaluate(NO_OVERFLOW) and small(page)==[])
        shot(page,'more-320-200.png')
        page.keyboard.press('Escape');page.wait_for_timeout(400)
        page.locator('[data-cover]').click(button='right');page.wait_for_timeout(400);tap(page,'[data-menu-preview]',900)
        check('German preview, 320px 200%: no overflow',page.locator('[data-preview-status]').inner_text()=='Schaue ich · 10 / 28' and page.evaluate(NO_OVERFLOW))
        shot(page,'preview-320-200.png')
        page.close()
        check('No page errors',errors==[])
        browser.close()
print(json.dumps(checks,indent=2))
print(f'{sum(c["passed"] for c in checks)}/{len(checks)} passed')
