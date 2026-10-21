"""Search tab (Android phones) on the real TanStack router: the phone screen instead of the desktop page, header facts and
actions, field first, Anime / Manga tabs, debounced search field, sort radios, filter sheet (draft applied on close, single
choices as radios, chips that keep their width, the genre / tag rule), removable filter chips in one row, AniList variables
(anime score ×10), cover cards (list status, progress, airing, score, new chapters, local files, names for screen readers),
endless loading with one "Load more" button, status announcements, URL params on arrival and while open, Back to the same
results and scroll position, Back to another page with the same params, loading / empty / error states, German texts, 48px
targets, 390px and 320px with 200% text, Android Back through the native script. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, copy
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,f'{name} {detail!r}' if detail is not None else name
def shot(page,name,full=True):
    if shots: page.screenshot(path=str(shots/name),full_page=full)
STATUS=dict(isOffline=False,settings=dict(anilist=dict(enableAdultContent=True,blurAdultContent=True),library=dict(enableOnlinestream=True)))
COLLECTIONS=dict(
    animeListData={'1000':dict(status='CURRENT',progress=10),'1001':dict(status='PLANNING',progress=0),'1002':dict(status='COMPLETED',progress=14,score=85),
        '1006':dict(status='PAUSED',progress=3)},
    library=dict(lists=[dict(type='CURRENT',status='CURRENT',entries=[dict(mediaId=1003,listData=dict(status='CURRENT',progress=5),
        libraryData=dict(sharedPath='/storage/anime/Steins;Gate',allFilesLocked=False,unwatchedCount=10,mainFileCount=15))])]),
    manga=dict(lists=[dict(type='CURRENT',status='CURRENT',entries=[dict(mediaId=5000,listData=dict(status='CURRENT',progress=40))]),
        dict(type='COMPLETED',status='COMPLETED',entries=[dict(mediaId=5001,listData=dict(status='COMPLETED',progress=101))])]),
    # The manga tab's latest chapters: Berserk (5000) is at chapter 45 on the provider the user picked
    chapters=dict(latestChapterNumbers={'5000':[dict(provider='mangadex',scanlator='',language='',number=45)]},storedProviders={'5000':'mangadex'},storedFilters={}))
FIXTURE=dict(serverStatus=STATUS,collections=COLLECTIONS,server=dict(total=150,delay=150,failNext=False),customSources=[dict(id='mangadex')],streaming=True,
    requests=[],routes=[],previews=[],playlist=[],explorer=[])
SVG='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="hsl({h} 32% 30%)"/><circle cx="128" cy="104" r="44" fill="hsl({h} 45% 56%)"/></svg>'
SHELL='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
# AndroidNavigation.backScript: what the app runs when the Android Back button is pressed.
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>b.textContent||b.getAttribute("aria-label")))'''
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
ATTR='(([sel,attr])=>[...document.querySelectorAll(sel)].map(e=>e.getAttribute(attr)))'
OPEN='document.querySelectorAll(".UI-Modal__content[data-state=open]").length'
FOCUS='document.activeElement?.hasAttribute'
# What sticks out of the sheet, named for a failing overflow check
SHEET_WIDER='(()=>{const s=document.querySelector(".ps-sheet"),r=s.getBoundingClientRect();return [...s.querySelectorAll("*")].filter(e=>e.getBoundingClientRect().right>r.right+1).slice(0,6).map(e=>e.tagName+"."+e.className+" "+(e.textContent||"").slice(0,30))})()'
COLUMNS='new Set([...document.querySelectorAll("[data-phone-card]")].map(c=>Math.round(c.getBoundingClientRect().left))).size'
SORT_IN_SIGHT='(()=>{const r=document.querySelector("[data-search-sort]").getBoundingClientRect();const c=document.querySelector("[data-search-sort] [aria-checked=true]").getBoundingClientRect();return c.left>=r.left-1&&c.right<=r.right+1})()'
IDLE='!document.querySelector(".pq-grid[aria-busy=true],[data-search-results] .ps-loading,[data-search-loading-more]")'
GEO='(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return [Math.round(r.width*10)/10,Math.round(r.left),Math.round(r.top)]})'
CARD='(([id,sel])=>{const e=document.querySelector(`[data-phone-card="${id}"] ${sel}`);return e?e.textContent.trim():null})'
# Active filters: all in one row that scrolls sideways
ONE_ROW='(()=>{const r=document.querySelector("[data-search-active-filters]");return new Set([...r.children].map(e=>Math.round(e.getBoundingClientRect().top))).size===1&&r.scrollWidth>r.clientWidth})()'
def reqs(page): return page.evaluate('requests')
def last(page): return page.evaluate('requests[requests.length-1]')
def strip(r): return {k:v for k,v in r.items() if k not in ('endpoint','page','perPage')}
def idle(page,extra=150):
    page.wait_for_function(IDLE);page.wait_for_timeout(extra)
def card(page,id,sel): return page.evaluate(CARD,[str(id),sel])
with tempfile.TemporaryDirectory(prefix='seanime-search-') as tmp:
    bundle=Path(tmp)/'search.js'
    subprocess.run(['node',str(root/'tests/mobile_search_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,query='',language=None,fixture=None,ready='[data-phone-card]',offline=False,path='/search'):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script('Object.assign(window,%s)'%json.dumps(fixture or copy.deepcopy(FIXTURE)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            if offline: page.add_init_script('Object.defineProperty(navigator,"onLine",{get:()=>false})')
            page.route('http://search.test/cover/**',lambda r:r.fulfill(content_type='image/svg+xml',body=SVG.format(h=int(r.request.url.split('/')[-1].split('.')[0])*47%360)))
            page.route(f'http://search.test{path}*',lambda r:r.fulfill(content_type='text/html',body=SHELL))
            page.goto(f'http://search.test{path}{query}')
            for css in (root/'backend/seanime-web/out/static/css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator(ready).first.wait_for();page.wait_for_timeout(400)
            return page
        def back(page):
            ok=page.evaluate(NATIVE_BACK);page.wait_for_timeout(350);return ok
        def sort(page,label):
            page.locator('[data-search-sort] button',has_text=label).click();idle(page)
        def open_sheet(page):
            page.locator('[data-search-filter-button]').click();page.locator('[data-search-filters]').wait_for();page.wait_for_timeout(350)
        def show(page):
            page.locator('[data-search-show]').click();page.locator('[data-search-filters]').wait_for(state='detached');idle(page)

        page=open_page()
        # The screen
        check('Phone screen replaces the desktop page',page.locator('h1').inner_text()=='Search' and page.locator('[data-phone-screen="search"]').count()==1
              and page.locator('[data-desktop-search-list],[data-desktop-banner]').count()==0)
        check('Header: the results title as facts and the filter button as its one 48dp action',page.locator('[data-phone-facts]').inner_text()=='Highest rated anime'
              and page.locator('[data-search-filter-button]').get_attribute('aria-label')=='Filters' and page.locator('[data-search-filter-button] .ps-dot').count()==0
              and page.locator('.ps-header .ps-actions > *').count()==1)
        check('Custom sources: a labelled text action on the results heading',page.locator('[data-search-results] .ps-section-head [data-search-custom-sources]').inner_text()=='Custom sources'
              and page.locator('[data-search-custom-sources]').get_attribute('href')=='/custom-sources')
        check('Search field first, labelled by its placeholder, not focused on arrival',page.locator('[data-search-field]').get_attribute('placeholder')=='Search anime'
              and page.evaluate('!!document.querySelector(".pq-controls").firstElementChild.querySelector("[data-search-field]")') and page.evaluate('document.activeElement===document.body'))
        check('Type tabs under the field: Anime | Manga, Anime chosen',page.evaluate(TEXT,'[data-search-type-tabs] [role=tab]')==['Anime','Manga']
              and page.locator('[data-search-type-tabs] [aria-selected=true]').inner_text()=='Anime')
        check('Sort: a radio group of five for anime, Highest score chosen',page.locator('[data-search-sort]').get_attribute('role')=='radiogroup'
              and page.evaluate(TEXT,'[data-search-sort] [role=radio]')==['Highest score','Trending','Popular','Newest','Most episodes']
              and page.evaluate(TEXT,'[data-search-sort] [aria-checked=true]')==['Highest score'] and page.locator('[data-search-sort] [aria-pressed]').count()==0
              and page.get_by_role('radio',name='Highest score',exact=True,checked=True).count()==1)
        check('No active filters row without filters',page.locator('[data-search-active-filters]').count()==0)
        check('First request: anime endpoint, score sort, no adult titles, 48 per page',reqs(page)==[dict(endpoint='/api/v1/anilist/list-anime',sort=['SCORE_DESC'],isAdult=False,page=1,perPage=48)])
        check('Results heading counts the loaded covers (more to come)',page.locator('[data-search-results] h2').inner_text().replace('\n','')=='Results48+'
              and page.locator('[data-phone-card]').count()==48)
        check('Screen readers hear how the search turned out',page.locator('[data-search-status]').get_attribute('role')=='status'
              and page.locator('[data-search-status]').inner_text()=='More than 48 results')
        check('Cards on a list: status and year in the accent, progress tag, bar while started',card(page,1000,'.ps-card-meta')=='Watching · 2024'
              and page.locator('[data-phone-card="1000"] .ps-card-meta').get_attribute('data-tone')=='accent' and card(page,1000,'[data-phone-tag]')=='10/12'
              and page.locator('[data-phone-card="1000"] .ps-card-progress').count()==1 and card(page,1000,'[data-phone-badge]') is None
              and card(page,1001,'.ps-card-meta')=='Planning · 2023' and card(page,1001,'[data-phone-tag]') is None and page.locator('[data-phone-card="1001"] .ps-card-progress').count()==0
              and card(page,1006,'.ps-card-meta')=='Paused · 2018' and card(page,1006,'[data-phone-tag]')=='3/18')
        check('Completed: progress tag as on the old card, the user\'s score as the accent badge, no bar',card(page,1002,'.ps-card-meta')=='Completed · 2022'
              and card(page,1002,'[data-phone-tag]')=='14/14' and card(page,1002,'[data-phone-badge]')=='★ 8.5' and page.locator('[data-phone-card="1002"] .ps-card-progress').count()==0)
        check('Local files are marked under the title',page.locator('[data-phone-card="1003"] .ps-card-meta [data-search-local]').count()==1
              and card(page,1003,'.ps-card-meta')=='Watching · 2021' and page.locator('[data-search-local]').count()==1)
        check('Not on a list: series by season, other forms by name and year; airing and upcoming on the cover',card(page,1007,'.ps-card-meta')=='Fall 2017'
              and card(page,1007,'[data-phone-tag]')=='Airing' and card(page,1005,'.ps-card-meta')=='OVA · 2019' and card(page,1005,'[data-phone-tag]')=='Upcoming'
              and page.locator('[data-phone-card="1005"] .ps-card-meta').get_attribute('data-tone') is None
              and card(page,1010,'.ps-card-meta')=='ONA · 2023' and card(page,1010,'[data-phone-tag]') is None and card(page,1010,'[data-phone-badge]') is None)
        check('A card names everything it shows for screen readers',page.locator('[data-phone-card="1002"]').get_attribute('aria-label')
              =='Fullmetal Alchemist: Brotherhood, Completed, 14 of 14 episodes watched, your score 8.5, Summer 2022, Movie'
              and page.locator('[data-phone-card="1003"]').get_attribute('aria-label')=='Steins;Gate, Watching, 5 of 15 episodes watched, in your library, Fall 2021, TV'
              and page.locator('[data-phone-card="1007"]').get_attribute('aria-label')=='BLEACH: Thousand-Year Blood War - The Calamity, Fall 2017, TV, Airing')
        check('Cards link to the entry page and keep list data and the MAL id for DOM plugins',page.locator('[data-phone-card="1000"]').get_attribute('href')=='/entry?id=1000'
              and json.loads(page.locator('[data-phone-card="1000"]').get_attribute('data-list-data'))['status']=='CURRENT'
              and page.locator('[data-phone-card="1000"]').get_attribute('data-media-mal-id')=='91000')
        check('The line under the title stays one line and is not clipped at the corner',page.evaluate('new Set([...document.querySelectorAll("[data-phone-card] .ps-card-meta")].map(e=>Math.round(e.getBoundingClientRect().height))).size')==1
              and page.evaluate('getComputedStyle(document.querySelector("[data-phone-card]")).borderRadius')=='0px')
        check('Adult covers are veiled (blur setting on)',page.locator('[data-phone-card="1004"] [data-adult-veil]').count()==1 and page.locator('[data-adult-veil]').count()==1)
        check('Every button, link and field is at least 48px',page.evaluate(SMALL,'[data-phone-screen] button,[data-phone-screen] a,[data-phone-screen] input')==[])
        check('390px: three cover columns, no page overflow',page.evaluate(COLUMNS)==3 and page.evaluate(NO_OVERFLOW))
        page.locator('[data-search-field]').focus()
        check('The focused field shows one focus mark (no second form ring)',page.evaluate('getComputedStyle(document.activeElement).boxShadow')=='none'
              and page.evaluate('getComputedStyle(document.activeElement).outlineStyle')=='solid')
        page.evaluate('document.activeElement.blur()')
        shot(page,'search-390.png',full=False)

        # Endless results
        check('"Load more" is a real button under the grid',page.locator('[data-search-load-more]').evaluate('b=>b.tagName')=='BUTTON')
        page.evaluate('document.querySelector("[data-search-load-more]").focus({preventScroll:true})');page.keyboard.press('Enter');page.wait_for_timeout(60)
        check('Load more by keyboard keeps the focus on the button while the page loads',page.evaluate(f'{FOCUS}("data-search-loading-more")'))
        idle(page)
        check('Load more asks for page 2; a title AniList repeats is shown once',last(page)['page']==2 and page.locator('[data-phone-card]').count()==96
              and len(set(page.evaluate(ATTR,['[data-phone-card]','data-phone-card'])))==96 and page.evaluate(f'{FOCUS}("data-search-load-more")'))
        check('A further page is not announced again',page.locator('[data-search-status]').inner_text()=='More than 48 results')
        page.evaluate('server.delay=900');page.evaluate('scrollTo(0,document.body.scrollHeight)')
        page.locator('[data-search-loading-more]').wait_for(timeout=3000)
        check('Scrolling near the end loads the next page by itself and says "Loading more…"',page.locator('[data-search-loading-more]').inner_text()=='Loading more…'
              and last(page)['page']==3 and page.locator('[data-search-load-more][aria-disabled=true]').count()==1)
        shot(page,'search-loading-more-390.png',full=False)
        idle(page);page.evaluate('server.delay=150;scrollTo(0,document.body.scrollHeight)');page.wait_for_timeout(300);idle(page,400)
        check('The end says so: "That\'s all", no more requests',page.locator('[data-search-end]').inner_text()=="That's all" and page.locator('[data-search-load-more]').count()==0
              and [r['page'] for r in reqs(page)]==[1,2,3,4] and page.locator('[data-phone-card]').count()==150
              and page.locator('[data-search-results] h2').inner_text().replace('\n','')=='Results150')
        page.evaluate('scrollTo(0,document.body.scrollHeight)');page.wait_for_timeout(200);shot(page,'search-end-390.png',full=False)
        top=page.locator('[data-search-top]')
        check('After a long scroll a 48dp "Back to top" button sits above the bottom bar',top.count()==1 and top.get_attribute('aria-label')=='Back to top'
              and page.evaluate(SMALL,'[data-search-top]')==[] and page.evaluate('innerHeight-document.querySelector("[data-search-top]").getBoundingClientRect().bottom')>=5.75*16-1)
        top.click();page.wait_for_function('scrollY===0',timeout=3000);page.wait_for_timeout(200)
        check('Back to top returns to the controls and hands the focus to the page title',page.locator('[data-search-top]').count()==0
              and page.evaluate('document.activeElement?.tagName')=='H1')

        # Sort, type
        said=page.evaluate('document.querySelector("[data-search-status]").textContent')
        page.evaluate('server.delay=700');page.locator('[data-search-sort] button',has_text='Trending').click();page.wait_for_timeout(150)
        check('A new search keeps the previous covers dimmed until it arrives',page.locator('.pq-grid[aria-busy=true]').count()==1 and page.locator('.ps-loading').count()==0)
        shot(page,'search-stale-390.png',full=False)
        idle(page);page.evaluate('server.delay=150')
        check('Sort chip: Trending is sent and named in the facts',strip(last(page))==dict(sort=['TRENDING_DESC'],isAdult=False)
              and page.locator('[data-phone-facts]').inner_text()=='Trending anime' and page.locator('.pq-grid[aria-busy=true]').count()==0)
        now=page.evaluate('document.querySelector("[data-search-status]").textContent')
        check('Each new search is announced, the same words again too (the text changes, so it is read)',now!=said and now.strip()==said.strip()=='More than 48 results',[said,now])
        sort(page,'Newest')
        check('Newest: named like its chip',page.locator('[data-phone-facts]').inner_text()=='Newest anime')
        sort(page,'Most episodes')
        page.evaluate('server.delay=700');page.locator('[data-search-type-tabs] [role=tab]',has_text='Manga').click();page.wait_for_timeout(150)
        check('Switching to manga shows bones, not anime covers',page.locator('[data-search-results] .ps-loading[aria-busy=true]').count()==1 and page.locator('[data-phone-card]').count()==0)
        idle(page);page.evaluate('server.delay=150')
        check('Manga: own endpoint, the episodes sort falls back, chapters instead',last(page)['endpoint']=='/api/v1/manga/anilist/list' and strip(last(page))==dict(sort=['SCORE_DESC'],isAdult=False)
              and page.evaluate(TEXT,'[data-search-sort] button')[-1]=='Most chapters' and page.evaluate(TEXT,'[data-search-sort] [aria-checked=true]')==['Highest score']
              and page.locator('[data-search-field]').get_attribute('placeholder')=='Search manga' and page.locator('[data-phone-facts]').inner_text()=='Highest rated manga')
        check('The chosen sort scrolls back into sight when it changes',page.evaluate(SORT_IN_SIGHT))
        shot(page,'search-manga-390.png',full=False)
        check('Manga cards: reading status from the manga collection, chapters, new chapters from the manga tab\'s data',card(page,5000,'.ps-card-meta')=='Reading · 2020'
              and card(page,5000,'[data-phone-tag]')=='40/100' and card(page,5000,'[data-phone-badge]')=='5 new' and card(page,5001,'.ps-card-meta')=='Completed · 2019'
              and card(page,5001,'[data-phone-tag]')=='101/101' and card(page,5001,'[data-phone-badge]') is None and page.locator('[data-phone-card="5000"]').get_attribute('href')=='/manga/entry?id=5000')
        check('Manga by start year; the form only when it is not a plain manga; publishing on the cover',card(page,5002,'.ps-card-meta')=='2018'
              and card(page,5003,'.ps-card-meta')=='One shot · 2017' and card(page,5007,'[data-phone-tag]')=='Publishing' and card(page,5005,'[data-phone-tag]')=='Upcoming')
        page.locator('[data-search-type-tabs] [role=tab]',has_text='Anime').click();idle(page)

        # Title
        n=len(reqs(page))
        page.locator('[data-search-field]').press_sequentially('frieren',delay=60);page.wait_for_timeout(150)
        check('Typing waits for a pause before searching',len(reqs(page))==n)
        idle(page,600)
        check('After the pause one request ranks by match first, then by the sort',[r.get('search') for r in reqs(page)[n:]]==['frieren']
              and strip(last(page))==dict(sort=['SEARCH_MATCH','SCORE_DESC'],search='frieren',isAdult=False))
        check('Title search: facts and the order explained',page.locator('[data-phone-facts]').inner_text()=='Results for “frieren”'
              and page.locator('[data-search-results] .ps-section-note').inner_text()=='Best matches first' and page.locator('[data-search-end]').count()==1)
        check('Announced: how many matched',page.locator('[data-search-status]').inner_text()=='12 results')
        page.locator('[data-search-field]').fill('zzz');page.locator('[data-search-field]').press('Enter');page.wait_for_timeout(100)
        check('Enter searches at once and closes the keyboard',last(page).get('search')=='zzz' and page.evaluate('document.activeElement===document.body'))
        page.locator('[data-search-empty]').wait_for()
        check('Empty: what is missing and a way on',page.evaluate(TEXT,'[data-search-empty] p')==['No anime match','Nothing on AniList matches “zzz”.']
              and page.evaluate(TEXT,'[data-search-empty] button')==['Try other words'])
        page.wait_for_timeout(100)
        check('Announced: nothing matched',page.locator('[data-search-status]').inner_text()=='No anime match')
        shot(page,'search-empty-390.png',full=False)
        page.locator('[data-search-empty] button').click()
        check('"Try other words" puts the cursor into the field with the words selected',page.evaluate(f'{FOCUS}("data-search-field")')
              and page.evaluate('[document.activeElement.selectionStart,document.activeElement.selectionEnd]')==[0,3])
        page.locator('[data-search-field]').fill('boom');page.locator('[data-search-field]').press('Enter');page.locator('[data-search-error]').wait_for()
        check('Error: the search failed, try again (the desktop showed nothing)',page.locator('[data-search-error] p').inner_text()=='The search failed.'
              and page.locator('[data-search-error]').get_attribute('role')=='alert')
        shot(page,'search-error-390.png',full=False)
        n=len(reqs(page));page.get_by_role('button',name='Try again').click();page.wait_for_timeout(400)
        check('Try again asks AniList again',len(reqs(page))==n+1 and last(page).get('search')=='boom')
        page.locator('.ps-search-clear').click();page.wait_for_timeout(60)
        check('Clearing the field searches without a title at once (the loaded pages come from the cache)',page.locator('[data-search-field]').input_value()==''
              and page.locator('[data-phone-facts]').inner_text()=='Highest rated anime' and page.locator('[data-phone-card]').count()==150)
        check('The ✕ leaves the focus (and the keyboard) in the field',page.evaluate(f'{FOCUS}("data-search-field")'))
        page.evaluate('document.activeElement.blur()');idle(page)

        # Filter sheet
        open_sheet(page)
        check('Filter sheet takes the focus itself, not its first chip',page.evaluate('document.activeElement?.getAttribute("role")')=='dialog')
        check('Sheet: genres, format, season, year, status, score, adult, tags',page.evaluate(TEXT,'[data-search-filters] .ps-sheet-head h3')
              ==['Genres','Format','Season','Year','Airing status','Minimum score','Tags'] and page.locator('[data-search-adult]').count()==1
              and page.locator('[data-search-genres] button').count()==18 and page.evaluate(TEXT,'[data-search-format] button')==['TV','Movie','ONA','OVA','TV short','Special'])
        check('Airing status: the running one reads "Airing", not the list words',page.evaluate(TEXT,'[data-search-status] button')==['Finished','Airing','Upcoming','Hiatus','Cancelled'])
        check('One choice is a radio group without check marks, several are toggles',page.evaluate(ATTR,['[data-search-filters] [data-search-format],[data-search-filters] [data-search-season],[data-search-filters] [data-search-status],[data-search-filters] [data-search-genres]','role'])
              ==['group','radiogroup','radiogroup','radiogroup'] and page.locator('[data-search-format] [role=radio]').count()==6
              and page.locator('[data-search-genres] [aria-pressed=false]').count()==18 and page.locator('[data-search-format] svg').count()==0)
        check('Genres and tags say that every chosen one must match (AniList narrows)',all(note in page.evaluate(TEXT,'[data-search-filters] .ps-sheet-note')
              for note in ('Titles must have every selected genre.','Titles must have every selected tag.')))
        check('Tags: 30 of 349 shown, all one tap away',page.locator('[data-search-tags] button').count()==30 and page.locator('[data-search-all-tags]').inner_text()=='Show all 349')
        check('Year: any plus 70 years; score: any, 9+ … 1+',page.locator('[data-search-year] option').count()==71 and page.evaluate(TEXT,'[data-search-score] option')
              ==['Any score','9+','8+','7+','6+','5+','4+','3+','2+','1+'])
        small=page.evaluate(SMALL,'.ps-sheet button,.ps-sheet select,.ps-sheet input')
        check('Sheet buttons and fields are at least 48px (short choices like "TV" too)',small==[],small)
        shot(page,'search-sheet-390.png',full=False)
        n=len(reqs(page))
        before=[page.evaluate(GEO,f'[data-search-genres] [data-chip="{chip}"]') for chip in ('Action','Comedy','Drama','Ecchi','Fantasy')]+[page.evaluate(GEO,'[data-search-format] [data-chip="TV"]')]
        for genre in ('Action','Comedy'): page.locator(f'[data-search-genres] [data-chip="{genre}"]').click()
        page.locator('[data-search-format] [data-chip="TV"]').click()
        after=[page.evaluate(GEO,f'[data-search-genres] [data-chip="{chip}"]') for chip in ('Action','Comedy','Drama','Ecchi','Fantasy')]+[page.evaluate(GEO,'[data-search-format] [data-chip="TV"]')]
        check('A chosen chip keeps its width: nothing moves under the finger',before==after and page.locator('[data-search-genres] [aria-pressed=true] svg').count()==2,[before,after])
        check('Chips are read once by name with their state (the width reserve stays silent)',page.get_by_role('button',name='Action',exact=True,pressed=True).count()==1
              and page.get_by_role('radio',name='TV',exact=True,checked=True).count()==1 and page.get_by_role('radio',name='Movie',exact=True,checked=False).count()==1)
        page.locator('[data-search-format] [data-chip="MOVIE"]').click()
        check('A second format replaces the first (radios: one checked)',page.evaluate(TEXT,'[data-search-format] [aria-checked=true]')==['Movie'])
        page.locator('[data-search-format] [data-chip="MOVIE"]').click()
        check('Tapping the chosen one again means any format',page.locator('[data-search-format] [aria-checked=true]').count()==0)
        page.locator('[data-search-format] [data-chip="TV"]').click();page.locator('[data-search-season] [data-chip="FALL"]').click()
        page.locator('[data-search-year]').select_option('2024');page.locator('[data-search-status] [data-chip="RELEASING"]').click()
        page.locator('[data-search-score]').select_option('7')
        page.locator('[data-search-tag-field]').fill('isek');page.wait_for_timeout(150)
        check('Tag search narrows the chips, names starting with the words first',page.evaluate(TEXT,'[data-search-tags] button')==['Isekai','Reverse Isekai']
              and page.locator('[data-search-all-tags]').count()==0)
        page.locator('[data-search-tags] [data-chip="Isekai"]').click();page.locator('[data-search-filters] .ps-search-clear').click();page.wait_for_timeout(150)
        check('The tag field\'s ✕ keeps the focus in it',page.evaluate(f'{FOCUS}("data-search-tag-field")') and page.locator('[data-search-tag-field]').input_value()=='')
        check('Chosen tags come first',page.evaluate(TEXT,'[data-search-tags] button')[0]=='Isekai' and page.locator('[data-search-tags] [aria-pressed=true]').count()==1)
        check('Nothing is searched while the sheet is open',len(reqs(page))==n)
        page.evaluate('document.activeElement.blur()');page.evaluate('document.querySelector(".ps-sheet").scrollTop=0');page.wait_for_timeout(100)
        shot(page,'search-sheet-chosen-390.png',full=False)
        show(page)
        check('Show results applies everything in one request, the anime score ×10',len(reqs(page))==n+1 and strip(last(page))==dict(sort=['SCORE_DESC'],isAdult=False,status=['RELEASING'],
              genres=['Action','Comedy'],tags=['Isekai'],format='TV',season='FALL',seasonYear=2024,averageScore_greater=70))
        check('Focus returns to the filter button',page.evaluate(f'{FOCUS}("data-search-filter-button")'))
        check('Active filters: one removable chip each, named "Remove …", and Clear filters',page.evaluate(TEXT,'[data-search-active-filters] .pq-chip')
              ==['Action','Comedy','TV','Fall','2024','Airing','7+','#Isekai'] and page.evaluate(ATTR,['[data-search-active-filters] .pq-chip','aria-label'])[:2]==['Remove Action','Remove Comedy']
              and page.evaluate(ATTR,['[data-search-active-filters] .pq-chip','aria-label'])[6:]==['Remove score 7+','Remove tag Isekai']
              and page.locator('[data-search-clear-filters]').inner_text()=='Clear filters')
        check('Active filters stay in one row that scrolls sideways, so the results start higher',page.evaluate(ONE_ROW)
              and page.evaluate('document.querySelector("[data-search-results]").getBoundingClientRect().top+scrollY')<430,
              page.evaluate('document.querySelector("[data-search-results]").getBoundingClientRect().top+scrollY'))
        check('Filter chips look unlike the chosen sort: raised, the accent only on the ✕',page.evaluate('getComputedStyle(document.querySelector(".pq-chip")).backgroundColor')
              !=page.evaluate('getComputedStyle(document.querySelector("[data-search-sort] [aria-checked=true]")).backgroundColor')
              and page.evaluate('getComputedStyle(document.querySelector(".pq-chip > svg:last-child")).color')==page.evaluate('getComputedStyle(document.querySelector("[data-search-sort] [aria-checked=true]")).color'))
        check('The filter button says how many are active and shows the dot',page.locator('[data-search-filter-button]').get_attribute('aria-label')=='Filters, 8 active'
              and page.locator('[data-search-filter-button] .ps-dot').count()==1)
        check('Facts: genres, season and year in the desktop title',page.locator('[data-phone-facts]').inner_text()=='Highest rated Action, Comedy anime from Fall 2024')
        check('Filter chips are at least 48px; no overflow with filters',page.evaluate(SMALL,'[data-search-active-filters] button')==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'search-filters-390.png',full=False)
        page.locator('[data-search-active-filters] [data-filter="genre:Comedy"]').click();idle(page)
        check('Removing a chip searches without it',last(page)['genres']==['Action'] and page.locator('[data-filter="genre:Comedy"]').count()==0)
        check('Focus moves on to the next chip',page.evaluate('document.activeElement?.getAttribute("data-filter")')=='format')
        page.locator('[data-search-active-filters] [data-filter="tag:Isekai"]').click();idle(page)
        check('Removing the last chip hands the focus to the one before it',page.evaluate('document.activeElement?.getAttribute("data-filter")')=='minScore')
        open_sheet(page);page.locator('[data-search-genres] [data-chip="Drama"]').click()
        check('Back closes the sheet (native script)',back(page) and page.evaluate(OPEN)==0)
        idle(page)
        check('Closing by Back keeps what was chosen',last(page)['genres']==['Action','Drama'])
        open_sheet(page);page.locator('[data-search-reset]').click();page.wait_for_timeout(100)
        check('Reset clears the draft in the sheet',page.locator('[data-search-genres] [aria-pressed=true]').count()==0 and page.locator('[data-search-reset]').is_disabled())
        show(page)
        check('Shown after Reset: no filters, the sort stays',page.locator('[data-search-active-filters]').count()==0 and page.locator('[data-phone-facts]').inner_text()=='Highest rated anime'
              and page.locator('[data-search-filter-button]').get_attribute('aria-label')=='Filters')
        open_sheet(page);page.locator('[data-search-adult]').click();page.wait_for_timeout(100)
        check('Adult titles add the 68 adult tags',page.locator('[data-search-all-tags]').inner_text()=='Show all 417')
        page.locator('[data-search-all-tags]').click();page.wait_for_timeout(200)
        check('Show all lists every tag',page.locator('[data-search-tags] button').count()==417 and page.locator('[data-search-all-tags]').count()==0)
        page.locator('[data-search-tags] [data-chip="Bondage"]').click();show(page)
        check('Adult titles only: isAdult and the adult tag are sent, the chip says Adult',last(page)['isAdult'] is True and last(page)['tags']==['Bondage']
              and page.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['#Bondage','Adult'])
        page.locator('[data-filter="adult"]').click();idle(page)
        check('Removing Adult drops the adult tags with it',page.locator('[data-search-active-filters]').count()==0 and page.locator('[data-search-filter-button] .ps-dot').count()==0)
        check('… and the focus goes to the filter button, not lost with the row',page.evaluate(f'{FOCUS}("data-search-filter-button")'))
        open_sheet(page);page.locator('[data-search-genres] [data-chip="Horror"]').click();page.locator('[data-search-status] [data-chip="FINISHED"]').click();show(page)
        page.locator('[data-search-field]').fill('fate');page.locator('[data-search-field]').press('Enter');idle(page)
        page.locator('[data-search-clear-filters]').click();idle(page)
        check('Clear filters hands the focus to the filter button',page.evaluate(f'{FOCUS}("data-search-filter-button")'))
        check('Clear filters keeps the title and the sort',strip(last(page))==dict(sort=['SEARCH_MATCH','SCORE_DESC'],search='fate',isAdult=False)
              and page.locator('[data-search-field]').input_value()=='fate')
        page.locator('.ps-search-clear').click();page.evaluate('document.activeElement.blur()');idle(page)

        # Card menu
        page.locator('[data-phone-card="1003"]').dispatch_event('contextmenu',dict(clientX=120,clientY=500,button=2))
        page.get_by_role('menuitem',name='Preview').wait_for();page.wait_for_timeout(400)
        check('Long press: preview, the desktop card\'s playlist and explorer entries, plugin actions',page.evaluate(TEXT,'[role=menu] [role=menuitem]')
              ==['Preview','Add to playlist','Open in library explorer'] and page.locator('[role=menu] [data-plugin-card-items]').count()==1)
        check('Menu entries are touch sized',page.evaluate(SMALL,'[role=menu] [role=menuitem]')==[])
        shot(page,'search-card-menu-390.png',full=False)
        check('Back closes the card menu',back(page) and page.locator('[role=menu]').count()==0)
        page.locator('[data-phone-card="1003"]').dispatch_event('contextmenu',dict(clientX=120,clientY=500,button=2))
        page.get_by_role('menuitem',name='Open in library explorer').click()
        page.locator('[data-phone-card="1003"]').dispatch_event('contextmenu',dict(clientX=120,clientY=500,button=2))
        page.get_by_role('menuitem',name='Add to playlist').click()
        page.locator('[data-phone-card="1010"]').dispatch_event('contextmenu',dict(clientX=120,clientY=500,button=2))
        page.get_by_role('menuitem',name='Preview').wait_for()
        check('Without list data or local files only Preview stays',page.evaluate(TEXT,'[role=menu] [role=menuitem]')==['Preview'])
        page.get_by_role('menuitem',name='Preview').click()
        check('Menu entries reach the explorer, the playlist editor and the preview',page.evaluate('explorer')==['/storage/anime/Steins;Gate'] and page.evaluate('playlist')==[1003]
              and page.evaluate('previews')==[[1010,'anime']])
        check('Back with nothing open leaves the page to the app',back(page) is False)

        # Large text, narrow screens
        page.evaluate('document.querySelector("[data-page-wrapper-container]").style.setProperty("--ps-text-zoom","2")');page.wait_for_timeout(200)
        check('Text zoom 2: two cover columns',page.evaluate(COLUMNS)==2 and page.evaluate(NO_OVERFLOW))
        page.evaluate('document.querySelector("[data-page-wrapper-container]").style.removeProperty("--ps-text-zoom")')
        open_sheet(page);page.locator('[data-search-genres] [data-chip="Slice of Life"]').click();page.locator('[data-search-format] [data-chip="TV_SHORT"]').click();show(page)
        page.set_viewport_size(dict(width=320,height=720));page.evaluate('document.documentElement.style.fontSize="200%"');page.wait_for_timeout(300)
        check('320px with 200% text: no page overflow',page.evaluate(NO_OVERFLOW))
        check('320px with 200% text: the placeholder ends in "…", with no room kept for the hidden ✕',page.evaluate('getComputedStyle(document.querySelector("[data-search-field]")).paddingRight')=='32px'
              and page.evaluate('getComputedStyle(document.querySelector("[data-search-field]")).textOverflow')=='ellipsis')
        shot(page,'search-320-200.png',full=False)
        page.evaluate('scrollTo(0,0)');open_sheet(page)
        check('Sheet at 320px with 200% text: no overflow',page.evaluate('(e=>e.scrollWidth<=e.clientWidth+1)(document.querySelector(".ps-sheet"))') and page.evaluate(NO_OVERFLOW),page.evaluate(SHEET_WIDER))
        shot(page,'search-sheet-320-200.png',full=False)
        page.evaluate('document.querySelector(".ps-sheet").scrollTop=1e6');page.wait_for_timeout(200)
        shot(page,'search-sheet-tags-320-200.png',full=False)
        page.close()

        # Links: on arrival, while open, Back to the same entry, a new link with the same params
        p=open_page(query='?genre=Action&sorting=TRENDING_DESC&format=MANGA')
        check('Genre badge link: format=MANGA means manga; the first request already has the link\'s search',p.locator('[data-search-type-tabs] [aria-selected=true]').inner_text()=='Manga'
              and reqs(p)==[dict(endpoint='/api/v1/manga/anilist/list',sort=['TRENDING_DESC'],isAdult=False,genres=['Action'],page=1,perPage=48)]
              and p.locator('[data-phone-facts]').inner_text()=='Trending Action manga' and p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['Action'])
        p.evaluate('navigate("/search?sorting=SCORE_DESC&season=WINTER&year=2024")');idle(p)
        check('A new link while the page is open applies at once (the desktop read params only on mount)',p.locator('[data-phone-facts]').inner_text()=='Highest rated anime from Winter 2024'
              and strip(last(p))==dict(sort=['SCORE_DESC'],isAdult=False,season='WINTER',seasonYear=2024) and p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['Winter','2024'])
        p.evaluate('navigate("/search?type=manga&sorting=TRENDING_DESC&country=JP&genre=Drama")');idle(p)
        check('Discover\'s manga link: country',strip(last(p))==dict(sort=['TRENDING_DESC'],isAdult=False,genres=['Drama'],countryOfOrigin='JP')
              and p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['Drama','Japan'])
        p.evaluate('navigate("/search?sorting=SCORE_DESC&format=TV&season=FALL&year=2026")');idle(p)
        check('Rankings link: format, season, year',strip(last(p))==dict(sort=['SCORE_DESC'],isAdult=False,format='TV',season='FALL',seasonYear=2026))
        p.evaluate('navigate("/search?genre=Hentai&sorting=TRENDING_DESC")');idle(p)
        check('The Hentai genre of adult entries turns adult titles on (the desktop found nothing)',strip(last(p))==dict(sort=['TRENDING_DESC'],isAdult=True,genres=['Hentai'])
              and p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['Hentai','Adult'])
        p.evaluate('navigate("/search?type=manga")');idle(p)
        sort(p,'Popular');n=len(reqs(p))
        p.evaluate('scrollTo(0,1500)');p.wait_for_timeout(300)
        target=p.evaluate('[...document.querySelectorAll("[data-phone-card]")].find(c=>c.getBoundingClientRect().top>120)?.getAttribute("data-phone-card")')
        y=p.evaluate('scrollY');p.locator(f'[data-phone-card="{target}"]').click();p.locator('[data-other-page]').wait_for()
        # The router scrolls after the page has rendered: wait for it rather than read the position in between (flaky before)
        p.wait_for_function('scrollY===0',timeout=3000)
        check('A card opens its entry page (the router scrolls it to the top)',p.evaluate('routes').pop()==f'/manga/entry?id={target}' and p.evaluate('scrollY')==0)
        p.evaluate('history.back()');p.locator('[data-phone-card]').first.wait_for();p.wait_for_timeout(500)
        check('Back to the link\'s entry keeps what was changed since (sort Popular stays)',p.evaluate(TEXT,'[data-search-sort] [aria-checked=true]')==['Popular']
              and p.locator('[data-search-type-tabs] [aria-selected=true]').inner_text()=='Manga')
        check('Back lands on the same results and scroll position, after the router\'s own scroll to the top, without asking AniList again',
              abs(p.evaluate('scrollY')-y)<=60 and len(reqs(p))==n,[p.evaluate('scrollY'),y])
        p.evaluate('scrollTo(0,900)');p.wait_for_timeout(200);y=p.evaluate('scrollY')
        p.evaluate('navigate("/discover")');p.locator('[data-other-page="/discover"]').wait_for();p.wait_for_timeout(200)
        p.evaluate('history.back()');p.locator('[data-phone-card]').first.wait_for();p.wait_for_timeout(500)
        check('The position is kept however the page was left (here the bottom bar), not only by a card',abs(p.evaluate('scrollY')-y)<=60,[p.evaluate('scrollY'),y])
        p.evaluate('scrollTo(0,0)');p.locator('[data-search-field]').fill('berserk');p.locator('[data-search-field]').press('Enter');idle(p)
        p.locator('[data-phone-card]').first.click();p.locator('[data-other-page]').wait_for()
        p.evaluate('history.back()');p.locator('[data-phone-card]').first.wait_for();p.wait_for_timeout(400)
        check('Back keeps the typed title',p.locator('[data-search-field]').input_value()=='berserk' and p.locator('[data-phone-facts]').inner_text()=='Results for “berserk”')
        p.evaluate('navigate("/search?type=manga")');idle(p)
        check('The URL already open, linked again, is no new history entry (router): the search stays, as on the desktop',p.locator('[data-search-field]').input_value()=='berserk')
        p.evaluate('navigate("/discover")');p.locator('[data-to-search-manga]').click();p.locator('[data-phone-card]').first.wait_for();idle(p)
        check('A new link with the same params from another page starts fresh',p.locator('[data-search-field]').input_value()==''
              and p.evaluate(TEXT,'[data-search-sort] [aria-checked=true]')==['Highest score'] and p.locator('[data-search-type-tabs] [aria-selected=true]').inner_text()=='Manga')
        p.close()
        # Discover's Manga tab has /discover?type=manga: Back there passes those params to the still-mounted search first
        p=open_page(path='/discover',query='?type=manga',ready='[data-to-search-manga]')
        p.locator('[data-to-search-manga]').click();p.locator('[data-phone-card]').first.wait_for();idle(p)
        p.locator('[data-search-field]').fill('berserk');p.locator('[data-search-field]').press('Enter');idle(p)
        open_sheet(p);p.locator('[data-search-genres] [data-chip="Drama"]').click();show(p)
        p.evaluate('history.back()');p.locator('[data-other-page="/discover"]').wait_for();p.wait_for_timeout(400)
        p.evaluate('navigate("/search")');p.locator('[data-phone-card]').first.wait_for();idle(p)
        check('Back to /discover?type=manga (same param names) is no new arrival: the bottom bar\'s /search afterwards still has the search',
              p.locator('[data-search-field]').input_value()=='berserk' and p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['Drama']
              and p.locator('[data-search-type-tabs] [aria-selected=true]').inner_text()=='Manga')
        p.close()
        p=open_page(query='?q=Frieren&type=anime&tags=Time%20Skip')
        check('?q= searches a title, tags arrive as chips',strip(last(p))==dict(sort=['SEARCH_MATCH','SCORE_DESC'],search='Frieren',isAdult=False,tags=['Time Skip'])
              and p.locator('[data-search-field]').input_value()=='Frieren' and p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['#Time Skip'])
        p.close()
        p=open_page(query='?year=1950&type=manga');open_sheet(p)
        check('A year outside the list (from a link) stays selected in the sheet',p.locator('[data-search-year]').input_value()=='1950'
              and strip(reqs(p)[0])==dict(sort=['SCORE_DESC'],isAdult=False,year=1950))
        check('Manga: publishing status words in the sheet',p.evaluate(TEXT,'[data-search-status] button')==['Finished','Publishing','Upcoming','Hiatus','Cancelled'])
        p.close()

        # States
        fixture=copy.deepcopy(FIXTURE);fixture['server']['delay']=4000;fixture['customSources']=[]
        p=open_page(fixture=fixture,ready='[data-search-results] .ps-loading')
        check('Loading: grid bones under the results heading; header, tabs, field and sort stay',p.locator('[data-search-results] .ps-loading[aria-busy=true] .ps-bone').count()==6
              and p.locator('h1').inner_text()=='Search' and p.locator('[data-search-type-tabs],[data-search-field],[data-search-sort]').count()==3)
        check('No custom sources: no link to them',p.locator('[data-search-custom-sources]').count()==0)
        shot(p,'search-loading-390.png',full=False);p.close()
        p=open_page(query='?q=boom',ready='[data-search-error]',offline=True)
        check('Offline error names the missing connection',p.locator('[data-search-error] p').inner_text()=='No internet connection, so the search failed.')
        p.close()
        fixture=copy.deepcopy(FIXTURE);fixture['server']['failNext']=True
        p=open_page(fixture=fixture)
        p.evaluate('scrollTo(0,document.body.scrollHeight)');p.locator('[data-search-more-error]').wait_for();p.wait_for_timeout(800)
        check('A failed next page keeps the covers, says so and does not retry by itself',p.locator('[data-phone-card]').count()==48
              and [r['page'] for r in reqs(p)]==[1,2] and p.locator('[data-search-more-error] button').inner_text()=='Try again'
              and p.locator('[data-search-more-error] [role=alert]').inner_text()=='More results could not be loaded.')
        p.evaluate('server.failNext=false;server.delay=900');n=len(reqs(p))
        retry=p.locator('[data-search-load-more]');retry.click();p.wait_for_timeout(100)
        for _ in range(2): retry.click(force=True)
        p.wait_for_timeout(100)
        check('Try again shows the loading state at once and asks only once, however often it is tapped',len(reqs(p))==n+1
              and p.locator('[data-search-loading-more]').inner_text()=='Loading more…' and p.locator('[data-search-more-error]').count()==0
              and p.evaluate(f'{FOCUS}("data-search-load-more")'))
        idle(p)
        check('Try again loads the page; the focus stays on the button',p.locator('[data-phone-card]').count()==96 and p.locator('[data-search-more-error]').count()==0
              and p.evaluate(f'{FOCUS}("data-search-load-more")'))
        p.close()
        p=open_page(query='?genre=Action&status=CANCELLED&q=zzz',ready='[data-search-empty]')
        check('Empty with filters: clear them or try other words',p.evaluate(TEXT,'[data-search-empty] button')==['Clear filters','Try other words']
              and p.locator('[data-search-empty] p').nth(1).inner_text()=='Nothing matches “zzz” with these filters.')
        p.locator('[data-search-empty] button',has_text='Clear filters').click();idle(p)
        check('Clear filters keeps the title',strip(last(p))==dict(sort=['SEARCH_MATCH','SCORE_DESC'],search='zzz',isAdult=False))
        p.close()

        # German (with the theme's unwatched counts on)
        fixture=copy.deepcopy(FIXTURE);fixture['serverStatus']['themeSettings']=dict(showAnimeUnwatchedCount=True)
        de=open_page(language='de',fixture=fixture)
        check('German: header, tabs, field, sort chips, heading',de.locator('h1').inner_text()=='Suche' and de.locator('[data-phone-facts]').inner_text()=='Bestbewertete Anime'
              and de.locator('[data-search-field]').get_attribute('placeholder')=='Anime suchen'
              and de.evaluate(TEXT,'[data-search-sort] button')==['Beste Wertung','Im Trend','Beliebt','Neueste','Meiste Folgen']
              and de.locator('[data-search-results] h2').inner_text().replace('\n','')=='Ergebnisse48+' and de.locator('[data-search-load-more]').inner_text()=='Mehr laden'
              and de.locator('[data-search-custom-sources]').inner_text()=='Eigene Quellen' and de.locator('[data-search-status]').inner_text()=='Mehr als 48 Ergebnisse')
        check('German cards: list words, score with a comma, airing',card(de,1000,'.ps-card-meta')=='Schaue ich · 2024' and card(de,1002,'.ps-card-meta')=='Fertig · 2022'
              and card(de,1002,'[data-phone-badge]')=='★ 8,5' and card(de,1006,'.ps-card-meta')=='Pausiert · 2018' and card(de,1007,'.ps-card-meta')=='Herbst 2017'
              and card(de,1007,'[data-phone-tag]')=='Läuft' and card(de,1005,'[data-phone-tag]')=='Demnächst' and card(de,1005,'.ps-card-meta')=='OVA · 2019')
        check('Theme "unwatched counts" on: new episodes as the badge, from the local files when there are any',card(de,1003,'[data-phone-badge]')=='10 neu'
              and card(de,1000,'[data-phone-badge]')=='2 neu' and 'deine Wertung 8,5' in de.locator('[data-phone-card="1002"]').get_attribute('aria-label'))
        shot(de,'search-de-390.png',full=False)
        open_sheet(de);shot(de,'search-sheet-de-390.png',full=False)
        check('German: filter sheet',de.evaluate(TEXT,'[data-search-filters] .ps-sheet-head h3')==['Genres','Format','Saison','Jahr','Ausstrahlung','Mindestwertung','Tags']
              and de.evaluate(TEXT,'.ps-sheet-actions button')==['Zurücksetzen','Ergebnisse zeigen'] and de.locator('.ps-sheet .UI-Modal__title').inner_text()=='Filter'
              and de.locator('[data-search-all-tags]').inner_text()=='Alle 349 zeigen' and de.locator('[data-search-genres] [data-chip="Adventure"]').inner_text()=='Abenteuer')
        check('German: statuses that do not read like list statuses; the genre rule',de.evaluate(TEXT,'[data-search-status] button')==['Abgeschlossen','Läuft','Demnächst','Unterbrochen','Eingestellt']
              and 'Titel müssen alle gewählten Genres haben.' in de.evaluate(TEXT,'[data-search-filters] .ps-sheet-note'))
        de.locator('[data-search-genres] [data-chip="Adventure"]').click();de.locator('[data-search-season] [data-chip="FALL"]').click();show(de)
        check('German: chips, facts, filter label',de.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['Abenteuer','Herbst']
              and de.evaluate(ATTR,['[data-search-active-filters] .pq-chip','aria-label'])==['Abenteuer entfernen','Herbst entfernen']
              and de.locator('[data-search-clear-filters]').inner_text()=='Filter zurücksetzen' and de.locator('[data-phone-facts]').inner_text()=='Bestbewertete Anime aus dem Herbst: Abenteuer'
              and de.locator('[data-search-filter-button]').get_attribute('aria-label')=='Filter, 2 aktiv')
        de.locator('[data-search-field]').fill('zzz');de.locator('[data-search-field]').press('Enter');de.locator('[data-search-empty]').wait_for()
        check('German: empty state',de.evaluate(TEXT,'[data-search-empty] p')==['Keine passenden Anime','Mit diesen Filtern passt nichts zu „zzz“.']
              and de.evaluate(TEXT,'[data-search-empty] button')==['Filter zurücksetzen','Anderen Suchbegriff versuchen'])
        de.locator('[data-search-field]').fill('frieren');de.locator('[data-search-field]').press('Enter');idle(de)
        check('German: title search and the end',de.locator('[data-phone-facts]').inner_text()=='Treffer für „frieren“' and de.locator('[data-search-end]').inner_text()=='Das war alles'
              and de.locator('[data-search-results] .ps-section-note').inner_text()=='Beste Treffer zuerst' and de.locator('[data-search-status]').inner_text()=='12 Ergebnisse')
        de.locator('[data-search-field]').fill('');de.wait_for_timeout(100);idle(de)
        de.evaluate('server.delay=900');de.evaluate('scrollTo(0,document.body.scrollHeight)');de.locator('[data-search-loading-more]').wait_for(timeout=3000)
        check('German: loading more',de.locator('[data-search-loading-more]').inner_text()=='Weitere Ergebnisse werden geladen …')
        de.close()

        # Tablets and desktop keep the desktop page
        d=open_page(width=1280,height=800,ready='[data-desktop-search-list]')
        check('Wider screens keep the desktop page',d.locator('[data-phone-screen]').count()==0 and d.locator('[data-desktop-search-options]').count()==1 and d.get_by_text('Discover series').count()==1)
        d.close()
        browser.close()
check('No script errors on any page',errors==[],errors)
print(json.dumps(checks,indent=2))
