"""Manga tab (Android phones): continue reading and its hand-off to the manga page, status tabs with counts, cover grid,
filter / sort sheet, Back, plugin menu and card menu, source refresh sheet, loading / empty / error states, German texts,
48px targets, grid columns with a large system font, 320px. Optional arg: screenshot dir."""
from pathlib import Path
from web_build import WEB
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, time
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
checks=[];errors=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name):
    if shots: page.screenshot(path=str(shots/name),full_page=True)
NOW=int(time.time())
def entry(i,title,status,progress,minutes_ago,genres,chapters=None,adult=False):
    return dict(mediaId=i,media=dict(id=i,title=dict(userPreferred=title),coverImage=dict(large=f'/cover/{i}.svg'),genres=genres,chapters=chapters,
        startDate=dict(year=2020),isAdult=adult,status='RELEASING'),listData=dict(status=status,progress=progress,updatedAt=NOW-minutes_ago*60))
LISTS=[
    dict(type='CURRENT',status='CURRENT',entries=[entry(1,'Overgeared','CURRENT',12,60,['Action','Fantasy']),entry(2,'Solo Leveling','CURRENT',200,30,['Action'],200),
        entry(3,'Omniscient Reader','CURRENT',0,600,['Action','Fantasy']),entry(4,"Adam's Sweet Agony",'CURRENT',0,10,['Comedy','Romance'],adult=True),
        entry(11,'Blue Lock','REPEATING',30,5,['Sports'])]),
    dict(type='PLANNING',status='PLANNING',entries=[entry(5,'The Divine Ring Descends','PLANNING',0,0,['Fantasy']),entry(6,'Meizi Tai Duo','PLANNING',0,0,['Romance'])]),
    dict(type='COMPLETED',status='COMPLETED',entries=[entry(7,'Berserk','COMPLETED',380,0,['Action','Drama'],380),entry(8,'Yotsuba&!','COMPLETED',110,0,['Comedy']),
        entry(9,'Blue Period','COMPLETED',60,0,['Drama'],60)]),
    dict(type='DROPPED',status='DROPPED',entries=[entry(10,'Tower of God','DROPPED',50,0,['Fantasy'])]),
    dict(type='PAUSED',status='PAUSED',entries=[]),
]
FIXTURE=dict(collectionState=dict(data=dict(lists=LISTS),isLoading=False,isError=False),
    latestChapterNumbers={'1':[dict(provider='p',scanlator='',language='',number=15)],'11':[dict(provider='p',scanlator='',language='',number=30)]},
    theme=dict(showMangaUnreadCount=True,mangaLibraryCollectionDefaultSorting='TITLE',libraryScreenBannerType='dynamic'),
    refreshJob=None,pluginItems=[dict(id='sync',label='Sync with MangaUpdates',style={},extensionId='mu')],
    routes=[],fetches=[],themeUpdates=[],refreshCalls=[],previews=[],pluginClicks=[],injected=[],refetches=0)
INIT='''(()=>{const f=%s;Object.assign(window,f);if(!localStorage.getItem("seed")){localStorage.setItem("seed","1");
localStorage.setItem("sea-manga-entry-provider",JSON.stringify({"1":"p","11":"p"}));
localStorage.setItem("sea-manga-resume-locations",JSON.stringify({"3":{chapterId:"c1",provider:"p",pageIndex:4,updatedAt:Date.now()-60000}}))}})()'''%json.dumps(FIXTURE)
SVG='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="hsl({h} 35% 32%)"/><circle cx="130" cy="110" r="46" fill="hsl({h} 45% 55%)"/></svg>'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>b.textContent||b.getAttribute("aria-label")))'''
COLUMNS='new Set([...document.querySelectorAll("[data-manga-card]")].map(c=>Math.round(c.getBoundingClientRect().left))).size'
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
BACK='(()=>{const e=new Event("seanime:android-back",{cancelable:true});dispatchEvent(e);return e.defaultPrevented})()'
with tempfile.TemporaryDirectory(prefix='seanime-manga-library-') as tmp:
    bundle=Path(tmp)/'manga.js'
    subprocess.run(['node',str(root/'tests/mobile_manga_library_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,hash='',language=None):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script(INIT)
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            page.route('http://manga.test/cover/**',lambda r:r.fulfill(content_type='image/svg+xml',body=SVG.format(h=int(r.request.url.split('/')[-1].split('.')[0])*47%360)))
            page.route('http://manga.test/manga*',lambda r:r.fulfill(content_type='text/html',body='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'))
            page.goto('http://manga.test/manga'+hash)
            for css in (WEB/'static/css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator('[data-mobile-manga-library]').wait_for();page.wait_for_timeout(700)
            return page
        page=open_page()
        check('Phone screen replaces the desktop library',page.locator('[data-desktop-library]').count()==0 and page.locator('h1').inner_text()=='Manga')
        check('Facts count every list and the manga with new chapters',page.locator('.mml-header p').inner_text()=='11 Manga · 1 with new chapters')
        check('Continue reading: started manga with something to read, latest activity first (a saved page counts)',
              page.evaluate(TEXT,'.mml-continue-title')==['Omniscient Reader','Overgeared'])
        check('Continue card shows chapter progress, new chapters and one action',page.locator('[data-manga-continue="1"]').inner_text().split('\n')==['Overgeared','Chapter 12 / 15','3 new chapters','Continue']
              and page.locator('[data-manga-continue="1"] .mml-progress').count()==1)
        check('Status tabs: lists that hold manga, fixed order, counts',page.evaluate(TEXT,'[data-manga-status]')==['Reading5','Planning2','Completed3','Dropped1']
              and page.locator('[data-manga-status="CURRENT"][aria-selected=true]').count()==1)
        check('Grid: Reading sorted by the library sorting (title)',page.evaluate(TEXT,'[data-manga-card] .mml-card-title')==["Adam's Sweet Agony",'Blue Lock','Omniscient Reader','Overgeared','Solo Leveling'])
        check('Cards: chapter state, new-chapter badge in the accent, adult cover veiled',page.locator('[data-manga-card="1"] .mml-card-meta').inner_text()=='Ch. 12 / 15'
              and page.locator('[data-manga-card="1"] [data-manga-unread]').inner_text()=='3 new' and page.locator('[data-manga-card] [data-manga-unread]').count()==1
              and page.locator('[data-manga-card="4"] [data-adult-veil]').count()==1 and page.locator('[data-manga-card="3"] .mml-card-meta').inner_text()=='2020')
        check('Plugin slot and command palette entries stay',page.locator('[data-plugin-slot="manga-screen-bottom"]').count()==1 and 'currently-reading-manga' in page.evaluate('injected'))
        check('Every button and link is at least 48px',page.evaluate(SMALL,'[data-mobile-manga-library] button,[data-mobile-manga-library] a')==[])
        check('390px: three cover columns, no page overflow',page.evaluate(COLUMNS)==3 and page.evaluate(NO_OVERFLOW))
        shot(page,'manga-390.png')
        page.locator('[data-manga-continue="1"]').click()
        check('Continue opens the manga page and hands over the reading intent',page.evaluate('routes').pop()=='/manga/entry?id=1' and page.evaluate('intent&&intent.mediaId')==1)
        page.locator('[data-manga-card="1"]').click()
        check('Card opens the manga page',page.evaluate('routes').pop()=='/manga/entry?id=1')
        page.locator('[data-manga-status="COMPLETED"]').click();page.wait_for_timeout(200)
        check('Status tab switches the grid and is remembered',page.evaluate(TEXT,'[data-manga-card] .mml-card-title')==['Berserk','Blue Period','Yotsuba&!']
              and page.evaluate('localStorage.getItem("sea-mobile-manga-library-status")')=='"COMPLETED"')
        page.locator('[data-manga-card="7"]').dispatch_event('contextmenu',dict(clientX=120,clientY=500,button=2))
        page.get_by_role('menuitem',name='Preview').wait_for()
        check('Long press keeps the card menu with preview and plugin actions',page.locator('[data-plugin-card-items]').count()==1)
        page.get_by_role('menuitem',name='Preview').click()
        check('Preview opens for that manga',page.evaluate('previews').pop()==[7,'manga'])
        page.locator('[data-manga-library-menu]').click();page.get_by_role('menuitem',name='Sync with MangaUpdates').wait_for()
        check('Back is taken by the open plugin menu',page.evaluate(BACK))
        page.get_by_role('menuitem').first.wait_for(state='detached',timeout=3000)
        check('Back closes the plugin menu',page.get_by_role('menuitem').count()==0)
        page.locator('[data-manga-library-menu]').click();page.get_by_role('menuitem',name='Sync with MangaUpdates').click()
        check('Plugin library actions stay in a menu',page.evaluate('pluginClicks')==['sync'])
        page.locator('[data-manga-filter-button]').click();page.locator('[data-manga-filters]').wait_for();page.wait_for_timeout(300)
        check('Filter sheet: sort, two switches, genres with the shown list\'s counts',page.locator('[data-manga-sort]').input_value()=='TITLE'
              and page.locator('[data-manga-filters] [role=switch]').count()==2 and page.evaluate(TEXT,'[data-manga-genre]')[:3]==['Action1','Comedy1','Drama2'])
        check('Sheet buttons are at least 48px',page.evaluate(SMALL,'[data-manga-filters] button')==[])
        check('The unread switch is named by its label and described by its note',page.evaluate('(b=>[document.getElementById(b.getAttribute("aria-labelledby"))?.textContent,document.getElementById(b.getAttribute("aria-describedby"))?.textContent])(document.querySelector("[data-manga-unread-only]"))')
              ==['Only manga with new chapters','A list without any keeps showing all its manga.'])
        check('Opening the sheet focuses the sheet, not the sort picker',page.evaluate('document.activeElement?.getAttribute("role")')=='dialog')
        shot(page,'manga-filter-sheet-390.png')
        page.locator('[data-manga-genre="Drama"]').click();page.wait_for_timeout(200)
        check('Genre narrows every list; tab counts and the done button follow',page.evaluate(TEXT,'[data-manga-status]')==['Reading0','Planning0','Completed2','Dropped0']
              and page.locator('[data-manga-filter-done]').inner_text()=='Show 2 manga')
        check('Back closes the sheet first',page.evaluate(BACK));page.locator('[data-manga-filters]').wait_for(state='detached')
        check('Focus returns to the filter button when the sheet closes',page.evaluate('document.activeElement?.hasAttribute("data-manga-filter-button")'))
        check('Active filter is marked on its button',page.locator('[data-manga-filter-button] .mml-dot').count()==1 and page.evaluate(TEXT,'[data-manga-card] .mml-card-title')==['Berserk','Blue Period'])
        page.locator('[data-manga-status="CURRENT"]').click();page.wait_for_timeout(200)
        check('An emptied list keeps its tab and offers to reset the filter',page.locator('[data-manga-status-empty]').count()==1)
        shot(page,'manga-filter-empty-390.png')
        page.locator('[data-manga-status-empty] button').click();page.wait_for_timeout(200)
        check('Reset brings the list back',page.locator('[data-manga-card]').count()==5 and page.locator('[data-manga-filter-button] .mml-dot').count()==0)
        page.locator('[data-manga-filter-button]').click();page.locator('[data-manga-filters]').wait_for()
        page.locator('[data-manga-genre="Action"]').click();page.locator('[data-manga-unread-only]').click();page.wait_for_timeout(400)
        check('Only new chapters keeps the chosen genre',page.locator('[data-manga-genre="Action"][aria-pressed=true]').count()==1
              and page.locator('[data-manga-unread-only][aria-checked=true]').count()==1 and page.locator('[data-manga-filter-done]').inner_text()=='Show 1 manga')
        page.locator('[data-manga-sort]').select_option('PROGRESS_DESC');page.wait_for_timeout(200)
        check('Sorting saves the library setting',page.evaluate('themeUpdates').pop()['mangaLibraryCollectionDefaultSorting']=='PROGRESS_DESC')
        page.locator('[data-manga-filters] button',has_text='Reset').click();page.locator('[data-manga-filter-done]').click()
        page.locator('[data-manga-filters]').wait_for(state='detached');page.wait_for_timeout(200)
        check('Sorted grid after the sheet closes',page.evaluate(TEXT,'[data-manga-card] .mml-card-title')[:3]==['Solo Leveling','Blue Lock','Overgeared'])
        page.locator('[data-manga-source-refresh]').click();page.get_by_role('dialog').wait_for();page.wait_for_timeout(300)
        check('Source refresh opens as a sheet',page.locator('.mml-refresh-sheet').count()==1 and page.get_by_role('dialog').get_by_text('Refresh manga sources').count()==1)
        shot(page,'manga-refresh-sheet-390.png')
        page.get_by_role('button',name='Start refresh').click()
        check('Starting the refresh calls the server',page.evaluate('refreshCalls').pop()==['start',{'mode':'refresh_selected'}])
        check('Back closes the refresh sheet',page.evaluate(BACK));page.get_by_role('dialog').wait_for(state='detached')
        for width,zoom,columns in ((390,'1.3',3),(390,'2',2),(360,'2',2),(320,'1',2)):
            page.set_viewport_size(dict(width=width,height=800))
            page.evaluate(f'document.querySelector("[data-page-wrapper-container]").style.setProperty("--mml-text-zoom","{zoom}")');page.wait_for_timeout(200)
            check(f'{width}px, text zoom {zoom}: {columns} cover columns, no overflow',page.evaluate(COLUMNS)==columns and page.evaluate(NO_OVERFLOW))
        page.evaluate('document.documentElement.style.fontSize="200%"');page.wait_for_timeout(300)
        check('320px / 200% text: no page overflow',page.evaluate(NO_OVERFLOW))
        shot(page,'manga-320-200.png')
        page.close()
        for hash,selector,name in (('#loading','.mml-loading[aria-busy=true]','loading'),('#empty','[data-manga-library-empty]','empty'),('#error','[data-manga-library-error]','error'),
                                   ('#offline','[data-manga-library-error]','offline')):
            state={'#loading':dict(data=None,isLoading=True,isError=False),'#empty':dict(data=dict(lists=[]),isLoading=False,isError=False),
                   '#error':dict(data=None,isLoading=False,isError=True),'#offline':dict(data=None,isLoading=False,isError=True)}[hash]
            p=browser.new_page(viewport=dict(width=390,height=844),device_scale_factor=3,has_touch=True,is_mobile=True)
            p.add_init_script(INIT);p.add_init_script(f'collectionState={json.dumps(state)}')
            if name=='offline': p.add_init_script('Object.defineProperty(navigator,"onLine",{get:()=>false})')
            p.route('http://manga.test/manga*',lambda r:r.fulfill(content_type='text/html',body='<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'))
            p.goto('http://manga.test/manga'+hash)
            for css in (WEB/'static/css').rglob('*.css'):p.add_style_tag(path=str(css))
            p.add_style_tag(path=str(bundle.with_suffix('.css')));p.add_script_tag(path=str(bundle));p.locator(selector).wait_for();p.wait_for_timeout(300)
            check(f'{name.capitalize()} state keeps the title and the actions',p.locator('h1').inner_text()=='Manga' and p.locator('[data-manga-filter-button]').count()==1)
            if name=='empty': check('Empty: one sentence and the way to find manga',p.locator('[data-manga-library-empty] a').get_attribute('href')=='/discover?type=manga')
            if name=='offline': check('Offline: the error names the missing connection',p.locator('[data-manga-library-error] p').inner_text().startswith('No internet connection'))
            if name=='error':
                p.get_by_role('button',name='Try again').click()
                check('Error: retry reloads, downloads stay reachable, no redirect to Home',p.evaluate('refetches')==1 and p.evaluate('routes')==[]
                      and p.locator('[data-manga-library-error] a').get_attribute('href')=='/android-downloads?kind=manga')
            shot(p,f'manga-{name}-390.png');p.close()
        de=open_page(language='de')
        check('German: facts, sections, tabs, cards',de.locator('.mml-header p').inner_text()=='11 Manga · 1 mit neuen Kapiteln'
              and de.evaluate(TEXT,'.mml-section-head h2')==['Weiterlesen','Deine Liste'] and de.evaluate(TEXT,'[data-manga-status]')==['Lese ich5','Geplant2','Fertig3','Abgebrochen1']
              and de.locator('[data-manga-card="1"] .mml-card-meta').inner_text()=='Kap. 12 / 15' and de.locator('[data-manga-card="1"] [data-manga-unread]').inner_text()=='3 neu'
              and de.locator('[data-manga-continue="1"] .mml-continue-action').inner_text()=='Weiterlesen')
        de.locator('[data-manga-source-refresh]').click();de.get_by_role('dialog').wait_for()
        check('German: source refresh sheet',de.get_by_role('dialog').get_by_text('Manga-Quellen aktualisieren').count()==1 and de.get_by_role('button',name='Aktualisieren').count()==1)
        de.close()
        browser.close()
check('No script errors on any page',errors==[])
print(json.dumps(checks,indent=2))
