"""My lists tab (Android phones): header facts and actions, Anime | Manga switch with the stats beside it, status tabs with counts,
live search that follows its hits, cover grid (progress, new episodes, next airing, release status, score, library mark, unread
chapters), paging and unloading of long grids, card links and long-press menu (preview, continue, playlist, plugins), filter & sort
sheet, AniList refresh, stats, Android Back through the native back script, loading / empty / error states, German texts, 48px
targets, 390px, Android text zoom and 320px with 200% text. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, time, copy
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];warnings=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name,full=True):
    if shots: page.screenshot(path=str(shots/name),full_page=full)
NOW=int(time.time());YEAR=time.localtime().tm_year;H=3600;D=86400

def media(i,title,status='FINISHED',episodes=None,chapters=None,season=None,year=None,genres=(),fmt='TV',airing=None,adult=False,**kw):
    m=dict(id=i,title=dict(userPreferred=title,romaji=title,english=kw.pop('english',None)),synonyms=kw.pop('synonyms',[]),status=status,
        episodes=episodes,chapters=chapters,season=season,seasonYear=year,startDate=dict(year=year or kw.pop('start',None),month=1),format=fmt,
        genres=list(genres),isAdult=adult,coverImage=dict(large=f'http://lists.test/cover/{i}.svg'))
    if airing: m['nextAiringEpisode']=dict(episode=airing[0],airingAt=NOW+airing[1],timeUntilAiring=airing[1])
    m.update(kw);return m
def entry(m,status,progress=0,score=0,**kw):
    return dict(id=m['id']*10,media=m,status=status,progress=progress,score=score,**kw)

OVERGEARED=media(101,'Overgeared','RELEASING',12,season='FALL',year=2026,genres=['Action','Fantasy'],airing=(7,2*D+600),idMal=59000)
RETURNER=media(102,"A Returner's Magic Should Be Special",'FINISHED',12,season='FALL',year=2023,genres=['Action','Adventure','Fantasy'],english='Returner Magic')
HELL=media(103,'HELL MODE: The Hardcore Gamer Dominates in Another World with Garbage Balancing','RELEASING',13,season='SUMMER',year=2026,
    genres=['Action','Fantasy'],airing=(11,5*H+300))
MUSHOKU=media(104,'Mushoku Tensei: Jobless Reincarnation Season 3','RELEASING',None,season='SUMMER',year=2026,genres=['Drama','Fantasy'],airing=(5,3*D+600),
    synonyms=['Jobless Reincarnation III'])
VELVET=media(105,'Velvet Night','FINISHED',6,season='SPRING',year=2021,genres=['Romance'],adult=True)
OPM=media(106,'One-Punch Man','FINISHED',12,season='FALL',year=2015,genres=['Action','Comedy'])
BLUELOCK=media(107,'BLUE LOCK NEO EGOIST LEAGUE','NOT_YET_RELEASED',None,season='FALL',year=2026,genres=['Sports'])
DUNGEON=media(108,'Delicious in Dungeon Season 2','NOT_YET_RELEASED',None,season='WINTER',year=2027,genres=['Adventure','Comedy','Fantasy'])
FATE=media(109,'Fate/stay night: Unlimited Blade Works','FINISHED',12,season='FALL',year=2014,genres=['Action','Fantasy'])
FRIEREN=media(110,"Frieren: Beyond Journey's End",'FINISHED',28,season='FALL',year=2023,genres=['Adventure','Drama','Fantasy'])
BERSERK=media(111,'Berserk','FINISHED',25,season='FALL',year=1997,genres=['Action','Drama','Horror'])
BEBOP=media(112,'Cowboy Bebop','FINISHED',26,season='SPRING',year=1998,genres=['Action','Drama','Sci-Fi'])
YOURNAME=media(113,'Your Name.','FINISHED',1,season='SUMMER',year=2016,genres=['Drama','Romance'],fmt='MOVIE')
GHOUL=media(114,'Tokyo Ghoul','FINISHED',12,season='SUMMER',year=2014,genres=['Action','Horror'])
FILLER=[entry(media(200+i,f'Zz Completed Show {i:02d}','FINISHED',12,season='WINTER',year=2000+i%20,genres=['Slice of Life']),'COMPLETED',12,70,
    completedAt=dict(year=2020+i%5,month=1+i%12,day=1)) for i in range(67)]
ANIME=dict(MediaListCollection=dict(lists=[
    dict(status='COMPLETED',isCustomList=False,name='Completed',entries=[entry(BERSERK,'COMPLETED',25,85,completedAt=dict(year=2024,month=5,day=2)),
        entry(BEBOP,'COMPLETED',26,100,completedAt=dict(year=2022,month=3,day=9)),entry(YOURNAME,'COMPLETED',1,0)]+FILLER),
    dict(status='CURRENT',isCustomList=False,name='Watching',entries=[entry(OVERGEARED,'CURRENT',4),entry(RETURNER,'CURRENT',6),entry(HELL,'CURRENT',10),
        entry(MUSHOKU,'CURRENT',4),entry(VELVET,'CURRENT',0),dict(id=9,media=None,status='CURRENT')]),
    dict(status='REPEATING',isCustomList=False,name='Rewatching',entries=[entry(OPM,'REPEATING',7)]),
    dict(status='PLANNING',isCustomList=False,name='Planning',entries=[entry(BLUELOCK,'PLANNING'),entry(DUNGEON,'PLANNING'),entry(FATE,'PLANNING')]),
    dict(status='PAUSED',isCustomList=False,name='Paused',entries=[entry(FRIEREN,'PAUSED',10,90,startedAt=dict(year=2024,month=1,day=3))]),
    dict(status='DROPPED',isCustomList=False,name='Dropped',entries=[entry(GHOUL,'DROPPED',3)]),
    dict(isCustomList=True,name='Favourites',entries=[entry(BERSERK,'COMPLETED',25,85),entry(BEBOP,'COMPLETED',26,100),entry(OVERGEARED,'CURRENT',4)]),
]))
THEMES={200+i:[f'Theme {i%30:02d}'] for i in range(67)}
ANIME_TAGS={**{str(k):v for k,v in THEMES.items()},'101':['Isekai','Magic','Male Protagonist'],'102':['Magic','Time Manipulation'],'103':['Isekai','Video Games'],
    '104':['Isekai','Magic','Reincarnation'],'105':['Bondage','Nudity'],'106':['Super Power']}
MANGA=dict(MediaListCollection=dict(lists=[
    dict(status='CURRENT',isCustomList=False,entries=[entry(media(301,'Overgeared','RELEASING',chapters=344,start=2020,genres=['Action'],fmt='MANGA'),'CURRENT',12),
        entry(media(302,'Solo Leveling','FINISHED',chapters=200,start=2018,genres=['Action'],fmt='MANGA'),'CURRENT',0),
        entry(media(303,'Omniscient Reader','RELEASING',start=2020,genres=['Fantasy'],fmt='MANGA'),'CURRENT',50)]),
    dict(status='PLANNING',isCustomList=False,entries=[entry(media(304,'Meizi Tai Duo','RELEASING',start=2020,genres=['Romance'],fmt='MANGA'),'PLANNING')]),
    dict(status='COMPLETED',isCustomList=False,entries=[entry(media(305,'Berserk','HIATUS',chapters=380,start=1989,genres=['Action','Drama'],fmt='MANGA'),'COMPLETED',380,90)]),
]))
# Chapter numbers Home or the Manga tab loaded: the saved source of 301 has chapter 20 (8 unread at chapter 12).
MANGA_CHAPTERS=dict(latestChapterNumbers={'301':[dict(provider='comick',scanlator='',language='en',number=20)]},storedProviders={'301':'comick'},storedFilters={})
def stat_list(key,pairs,**extra): return [dict({key:k,'count':c,'meanScore':80,'minutesWatched':c*300,'chaptersRead':c*40},**extra) for k,c in pairs]
STATS=dict(
    animeStats=dict(count=186,minutesWatched=59400,episodesWatched=2400,meanScore=78.4,
        scores=stat_list('score',[(100,12),(90,30),(85,20),(80,40),(70,25)]),
        statuses=stat_list('status',[('COMPLETED',120),('PLANNING',40),('CURRENT',6),('DROPPED',10),('PAUSED',8),('REPEATING',2)]),
        formats=stat_list('format',[('TV',150),('MOVIE',20),('ONA',16)]),
        genres=stat_list('genre',[(f'Genre {i:02d}',100-i*5) for i in range(14)]),
        startYears=stat_list('startYear',[(YEAR,12),(YEAR-1,30),(YEAR-2,60),(YEAR-3,84)]),
        releaseYears=stat_list('releaseYear',[(1990+i,i+1) for i in range(36)]),
        studios=[dict(studio=dict(id=i,name=f'Studio {i}',isAnimationStudio=True),count=30-i,meanScore=75,minutesWatched=0,chaptersRead=0) for i in range(12)]),
    mangaStats=dict(count=12,chaptersRead=5320,meanScore=81,scores=stat_list('score',[(90,4),(80,8)]),
        statuses=stat_list('status',[('COMPLETED',6),('CURRENT',3),('PLANNING',3)]),genres=stat_list('genre',[('Action',8),('Drama',4)]),
        startYears=stat_list('startYear',[(YEAR,5)]),releaseYears=stat_list('releaseYear',[(2020,6),(2018,4)])))
STATUS=dict(user=dict(viewer=dict(name='Nick'),isSimulated=False),isOffline=False,
    settings=dict(library=dict(enableManga=True),anilist=dict(enableAdultContent=True,blurAdultContent=True)))
SERVER=dict(status=STATUS,anime=ANIME,manga=MANGA,animeTags=ANIME_TAGS,mangaTags={'301':['Isekai']},stats=STATS,streaming=True,states={},mangaChapters=MANGA_CHAPTERS)
def server(**patch):
    s=copy.deepcopy(SERVER);s.update(copy.deepcopy(patch));return s
def completed(n,start=1000):
    return dict(MediaListCollection=dict(lists=[dict(status='COMPLETED',isCustomList=False,
        entries=[entry(media(start+i,f'Completed {i:04d}',genres=['Drama']),'COMPLETED',12,70) for i in range(n)])]))
INIT='''(()=>{Object.assign(window,{server:%s,routes:[],requested:[],refetches:[],mutations:[],invalidated:[],toasts:[],previews:[],playNext:[],playlist:[]})})()'''
# AndroidNavigation.backScript: what the app runs when the Android Back button is pressed.
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
SVG='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="hsl({h} 35% 32%)"/><circle cx="130" cy="110" r="46" fill="hsl({h} 45% 55%)"/></svg>'
# Android's font size setting zooms text only, not lengths; mobile Chromium's text-size-adjust does the same.
TEXT_ZOOM='-webkit-text-size-adjust:200%;text-size-adjust:200%'
STATIC=root/'backend/seanime-web/out/static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>b.textContent||b.getAttribute("aria-label")))'''
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
# Android's long press as the WebView fires it: one contextmenu MouseEvent at the finger (dispatch_event's has no point) on
# a card nothing pressed before. The menu's items, and whether it opens beside the finger (2 px side offset) and level with it.
FIRST_PRESS='''(async sel=>{const e=document.querySelector(sel);e.scrollIntoView({block:"nearest",inline:"nearest"});const r=e.getBoundingClientRect();
    const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/3);e.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:x,clientY:y,button:2}));
    const t0=performance.now();while(!document.querySelector("[data-sea-context-menu-content]")&&performance.now()-t0<3000)await new Promise(f=>requestAnimationFrame(f));
    await new Promise(f=>setTimeout(f,300));const m=document.querySelector("[data-sea-context-menu-content]"),b=m&&m.getBoundingClientRect();
    return {items:m?[...m.querySelectorAll("[role=menuitem]")].map(i=>i.textContent.trim()):[],point:[x,y],menu:b&&[b.left,b.top,b.right,b.bottom].map(Math.round),
        at:!!b&&Math.abs(b.left-16)<=1&&Math.abs(b.right-(innerWidth-16))<=1&&b.bottom<=innerHeight-76-11}})'''
TITLES='[...document.querySelectorAll("[data-lists-grid] .ps-card-title")].map(e=>e.textContent)'
COLUMNS='new Set([...document.querySelectorAll("[data-phone-card]")].map(c=>Math.round(c.getBoundingClientRect().left))).size'
OPEN='document.querySelectorAll(".UI-Modal__content[data-state=open]").length'
FACTS='document.querySelector("[data-phone-facts]")?.textContent'
SELECTED='document.querySelector("[data-lists-status-tabs] [aria-selected=true]")?.dataset.tabValue'
FOCUSED_TAB='document.activeElement?.closest("[data-lists-status-tabs]")?document.activeElement.dataset.tabValue:null'
CELLS='document.querySelectorAll("[data-lists-grid] .pl-cell").length'
CARDS='document.querySelectorAll("[data-lists-grid] [data-phone-card]").length'
TOP='(sel=>Math.round(document.querySelector(sel).getBoundingClientRect().top))'
ROWS='(sel=>new Set([...document.querySelectorAll(sel)].map(b=>Math.round(b.getBoundingClientRect().top))).size)'
IN_ROW='''(()=>{const row=document.querySelector("[data-lists-status-tabs]"),tab=row.querySelector("[aria-selected=true]");const a=row.getBoundingClientRect(),b=tab.getBoundingClientRect();
    return b.left>=a.left-1&&b.right<=a.right+1})()'''
def card(page,id,part): return page.locator(f'[data-lists-grid] [data-phone-card="{id}"] {part}')

with tempfile.TemporaryDirectory(prefix='seanime-lists-') as tmp:
    bundle=Path(tmp)/'lists.js'
    subprocess.run(['node',str(root/'tests/mobile_lists_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,language=None,server=None,storage=None,offline=False,ready='[data-phone-screen="lists"]',html_style=''):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.on('console',lambda m:warnings.append(m.text[:300]) if m.type=='error' else None)
            page.add_init_script(INIT%json.dumps(server or copy.deepcopy(SERVER)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            for key,value in (storage or {}).items(): page.add_init_script(f'localStorage.setItem({json.dumps(key)},{json.dumps(json.dumps(value))})')
            if offline: page.add_init_script('Object.defineProperty(navigator,"onLine",{get:()=>false})')
            page.route('http://lists.test/cover/**',lambda r:r.fulfill(content_type='image/svg+xml',body=SVG.format(h=int(r.request.url.split('/')[-1].split('.')[0])*47%360)))
            # The app's font (Inter), as the built CSS references it.
            page.route('http://lists.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            page.route('http://lists.test/lists*',lambda r:r.fulfill(content_type='text/html',body=f'<html class="dark" lang="en" style="{html_style}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'))
            page.goto('http://lists.test/lists')
            for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator(ready).first.wait_for();page.evaluate('document.fonts.ready');page.wait_for_timeout(600)
            return page
        def back(page):
            ok=page.evaluate(NATIVE_BACK);page.wait_for_timeout(350);return ok
        def open_sheet(page):
            page.locator('[data-lists-filter-button]').click();page.locator('[data-lists-filters]').wait_for();page.wait_for_timeout(300)
        def status_tab(page,value):
            page.locator(f'[data-lists-status-tabs] [data-tab-value="{value}"]').click();page.wait_for_timeout(250)
        def open_stats(page):
            page.locator('[data-lists-stats-button]').click();page.locator('[data-lists-stats] [data-lists-stats-hero], [data-lists-stats] .ps-loading, [data-lists-stats] [data-lists-error], [data-lists-stats] [data-lists-empty]').first.wait_for();page.wait_for_timeout(300)
        def to_bottom(page):
            for _ in range(3): page.evaluate('scrollTo(0,document.documentElement.scrollHeight)');page.wait_for_timeout(450)

        page=open_page()
        # Header, switch, status tabs, grid
        check('Phone screen replaces the desktop lists',page.locator('[data-desktop-lists]').count()==0 and page.locator('[data-desktop-banner]').count()==0
              and page.locator('h1').inner_text()=='My lists')
        check('Facts: titles on the list, watching, running shows with new episodes',page.evaluate(FACTS)=='81 anime · 5 watching · 1 with new episodes')
        check('Header actions: refresh and filter & sort (two, so the title keeps its row)',page.evaluate(TEXT,'.ps-actions > *')==['','']
              and page.locator('.ps-actions [data-lists-refresh]').get_attribute('aria-label')=='Refresh AniList'
              and page.locator('.ps-actions [data-lists-filter-button]').get_attribute('aria-label')=='Filter and sort')
        check('Switch: Anime | Manga as one segment row, the stats switch beside it (not pressed)',page.evaluate(TEXT,'[data-lists-type-tabs] [role=tab]')==['Anime','Manga']
              and page.locator('[data-lists-type-tabs].ps-segment [data-tab-name="Anime"][aria-selected=true]').count()==1
              and page.evaluate(ROWS,'[data-lists-type-tabs] button')==1
              and page.locator('.pl-switch [data-lists-stats-button][aria-pressed=false]').get_attribute('aria-label')=='Stats')
        check('Status tabs: lists that hold anime in a fixed order, custom lists last, with counts',page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')
              ==['Watching5','Rewatching1','Planning3','Paused1','Completed70','Dropped1','Favourites3']
              and page.evaluate(SELECTED)=='CURRENT')
        check('Grid: Watching by the default sort (highest score, then title)',page.evaluate(TITLES)==["A Returner's Magic Should Be Special",
              'HELL MODE: The Hardcore Gamer Dominates in Another World with Garbage Balancing','Mushoku Tensei: Jobless Reincarnation Season 3','Overgeared','Velvet Night'])
        check('Watching cards: progress tag, new episodes, next airing',[card(page,101,'[data-phone-tag]').inner_text(),card(page,101,'[data-phone-badge]').inner_text(),
              card(page,101,'.ps-card-meta').inner_text()]==['4/12','2 new','Ep 7 in 2 d']
              and card(page,103,'.ps-card-meta').inner_text()=='Ep 11 in 5 h' and card(page,103,'[data-phone-badge]').count()==0)
        check('"New" only for running shows: a finished show or one never started has no badge',card(page,102,'[data-phone-badge]').count()==0
              and card(page,102,'.ps-card-meta').inner_text()=='Fall 2023' and card(page,105,'[data-phone-badge]').count()==0)
        check('Unknown episode count: tag 4/–, bar against the aired episodes',card(page,104,'[data-phone-tag]').inner_text()=='4/–'
              and 'scaleX(1)' in card(page,104,'.ps-card-progress > span').get_attribute('style')
              and 'scaleX(0.333' in card(page,101,'.ps-card-progress > span').get_attribute('style'))
        check('Adult cover veiled, entry without media skipped',card(page,105,'[data-adult-veil]').count()==1 and page.locator('[data-lists-grid] [data-phone-card]').count()==5)
        check('Card link, list data for DOM plugins, warm-up and a spoken summary without abbreviations',page.locator('[data-phone-card="101"]').get_attribute('href')=='/entry?id=101'
              and json.loads(page.locator('[data-phone-card="101"]').get_attribute('data-list-data'))=={'progress':4,'score':0,'status':'CURRENT'}
              and page.locator('[data-phone-card="101"]').get_attribute('data-media-mal-id')=='59000' and page.locator('[data-phone-card="101"]').get_attribute('data-media-type')=='anime'
              and page.locator('[data-phone-card="101"]').get_attribute('aria-label')=='Overgeared, 4 of 12 episodes watched, 2 new episodes, episode 7 in 2 days'
              and page.locator('[data-phone-card="103"]').get_attribute('aria-label').endswith('episode 11 in 5 hours')
              and page.locator('[data-phone-card="101"][data-warm]').count()==1)
        check('Meta line not clipped by the card corner',page.evaluate('getComputedStyle(document.querySelector("[data-phone-card]")).borderTopLeftRadius')=='0px')
        check('No classes the native Discover patch rewrites',page.evaluate('document.querySelector(\'[class*="basis-[2"],[data-discover-section]\')') is None)
        check('Every button and link is at least 48px',page.evaluate(SMALL,'[data-phone-screen] button,[data-phone-screen] a')==[])
        check('390px: three cover columns, no page overflow',page.evaluate(COLUMNS)==3 and page.evaluate(NO_OVERFLOW))
        check('A short grid has no "Back to top"',page.locator('[data-lists-top]').count()==0)
        shot(page,'lists-390.png')

        # Status tabs and the other cards
        status_tab(page,'REPEATING')
        check('Rewatching: tag and season, no "new" for a rewatch',[card(page,106,'[data-phone-tag]').inner_text(),card(page,106,'.ps-card-meta').inner_text()]==['7/12','Fall 2015']
              and card(page,106,'[data-phone-badge]').count()==0)
        status_tab(page,'PLANNING')
        check('Planning: upcoming titles say so, the rest show their season',page.evaluate(TEXT,'[data-lists-grid] .ps-card-meta')==['Upcoming','Upcoming','Fall 2014']
              and page.locator('[data-lists-grid] [data-phone-tag]').count()==0)
        status_tab(page,'PAUSED')
        check('Paused: progress tag without a bar, the score as badge',card(page,110,'[data-phone-tag]').inner_text()=='10/28' and card(page,110,'.ps-card-progress').count()==0
              and card(page,110,'[data-phone-badge]').inner_text()=='★ 9' and 'your score 9' in page.locator('[data-phone-card="110"]').get_attribute('aria-label'))
        status_tab(page,'DROPPED')
        check('Dropped: progress tag and season',[card(page,114,'[data-phone-tag]').inner_text(),card(page,114,'.ps-card-meta').inner_text()]==['3/12','Summer 2014'])
        status_tab(page,'custom:Favourites')
        check('Custom list: cards follow their entries\' status',page.evaluate(TITLES)==['Cowboy Bebop','Berserk','Overgeared']
              and card(page,112,'[data-phone-badge]').inner_text()=='★ 10' and card(page,101,'[data-phone-badge]').inner_text()=='2 new')
        check('The chosen tab is scrolled into its row',page.evaluate(IN_ROW))
        status_tab(page,'COMPLETED')
        check('Completed: the score as badge (no trailing .0); 60 covers at first, cards only near the screen',card(page,111,'[data-phone-badge]').inner_text()=='★ 8.5'
              and card(page,112,'[data-phone-badge]').inner_text()=='★ 10' and page.evaluate(CELLS)==60 and 12<=page.evaluate(CARDS)<60
              and page.evaluate(TITLES)[:3]==['Cowboy Bebop','Berserk','Zz Completed Show 00'])
        check('The status tab is remembered per type',page.evaluate('localStorage.getItem("sea-mobile-lists-status-anime")')=='"COMPLETED"')
        to_bottom(page)
        check('The rest of a long list renders near its end; covers far above leave their place empty',page.evaluate(CELLS)==70
              and page.evaluate(TITLES)[-1]=='Your Name.' and card(page,113,'[data-phone-badge]').count()==0
              and page.locator('[data-lists-grid] [data-phone-card="112"]').count()==0
              and page.evaluate('parseFloat(document.querySelector("[data-lists-grid] .pl-cell").style.height)')>150)
        check('"Back to top" ends a long grid and is at least 48px',page.locator('[data-lists-top]').is_visible() and page.evaluate(SMALL,'[data-lists-top]')==[])
        page.locator('[data-lists-top]').click();page.wait_for_timeout(400)
        check('"Back to top" brings the lists back, focus on the chosen one, its covers return',0<=page.evaluate(TOP,'.pl-controls')<=30
              and page.evaluate(FOCUSED_TAB)=='COMPLETED' and page.locator('[data-lists-grid] [data-phone-card="112"]').count()==1)
        page.evaluate('scrollTo(0,0)');status_tab(page,'CURRENT')

        # Long press
        def long_press(page,id,item='Preview'):
            page.locator(f'[data-lists-grid] [data-phone-card="{id}"]').dispatch_event('contextmenu',dict(clientX=200,clientY=700,button=2))
            page.get_by_role('menuitem',name=item).wait_for()
        first=page.evaluate(FIRST_PRESS,'[data-lists-grid] [data-phone-card="101"]')
        check('The first long press on a cover (contextmenu) opens its menu as an action sheet above the bottom bar, Preview first',first['items'][:1]==['Preview'] and first['at'])
        back(page)
        long_press(page,101)
        check('Long press: preview, continue, add to playlist and plugin actions',page.evaluate(TEXT,'[role=menuitem]')==['Preview','Continue','Add to playlist']
              and page.locator('[data-plugin-card-items="anime"]').count()==1)
        # offsetHeight: the menu still zooms in (scale .95) while it opens.
        check('Card menu rows are at least 48px',page.evaluate('[...document.querySelectorAll("[role=menuitem]")].every(e=>e.offsetHeight>=48)'))
        page.wait_for_timeout(300);shot(page,'lists-menu-390.png')
        check('Back closes the card menu',back(page) and page.get_by_role('menuitem').count()==0)
        long_press(page,101,'Continue');page.get_by_role('menuitem',name='Continue').click();page.wait_for_timeout(200)
        check('Continue hands the title to the player and opens its page',page.evaluate('playNext')==[101] and page.evaluate('routes')[-1]=='/entry?id=101')
        long_press(page,101);page.get_by_role('menuitem',name='Preview').click();page.wait_for_timeout(200)
        long_press(page,103,'Add to playlist');page.get_by_role('menuitem',name='Add to playlist').click();page.wait_for_timeout(200)
        check('Preview and playlist open for that title',page.evaluate('previews')==[[101,'anime']] and page.evaluate('playlist')==[103])
        long_press(page,105)
        check('No "Continue" without progress',page.get_by_role('menuitem',name='Continue').count()==0)
        back(page)
        page.locator('[data-lists-grid] [data-phone-card="102"]').click();page.wait_for_timeout(200)
        check('A tap opens the anime page',page.evaluate('routes')[-1]=='/entry?id=102')

        # Search
        page.locator('[data-lists-search]').fill('returner magic');page.wait_for_timeout(300)
        check('Search: English title, every tab counts its hits',page.evaluate(TITLES)==["A Returner's Magic Should Be Special"]
              and page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==['Watching1','Rewatching0','Planning0','Paused0','Completed0','Dropped0','Favourites0'])
        page.locator('[data-lists-search]').fill('  JOBLESS   reincarnation iii ');page.wait_for_timeout(300)
        check('Search: synonyms; case and spaces do not matter',page.evaluate(TITLES)==['Mushoku Tensei: Jobless Reincarnation Season 3'])
        page.locator('[data-lists-search]').fill('zzz nothing');page.wait_for_timeout(300)
        check('No hit in any list: the tab stays and says so',page.locator('[data-lists-empty="filter"] p').first.inner_text()=='No anime match the search')
        page.locator('.ps-search-clear').click();page.wait_for_timeout(300)
        check('Clearing the search brings every anime back and keeps the focus in the field',page.locator('[data-lists-grid] [data-phone-card]').count()==5
              and page.evaluate('document.activeElement?.hasAttribute("data-lists-search")'))
        page.evaluate('document.activeElement.blur();scrollTo(0,0)')

        # Filter & sort sheet
        open_sheet(page)
        check('Sheet takes the focus itself',page.evaluate('document.activeElement?.getAttribute("role")')=='dialog')
        check('Sort: the 16 desktop options, highest score first, the chosen one as readable text',page.locator('[data-lists-sort] option').count()==16
              and page.locator('[data-lists-sort]').input_value()=='SCORE_DESC' and page.locator('.pl-select-text').inner_text()=='Highest score')
        check('The sheet says what its numbers count',page.locator('[data-lists-filter-note]').inner_text()=='Numbers count the titles in Watching. Filters apply to every list.')
        check('Genres on the list, counted in the shown tab; the ones without hits there come last, apart',page.evaluate(TEXT,'[data-lists-genres] [data-chip]')
              ==['Action3','Adventure1','Drama1','Fantasy4','Romance1','Comedy0','Horror0','Sci-Fi0','Slice of Life0','Sports0']
              and page.evaluate(TEXT,'[data-lists-genres] .pl-chips-quiet [data-chip]')==['Comedy0','Horror0','Sci-Fi0','Slice of Life0','Sports0'])
        check('Format, airing and season chips only for values on the list, hits first',page.evaluate(TEXT,'[data-lists-formats] [data-chip]')==['TV5','Movie0']
              and page.evaluate(TEXT,'[data-lists-releases] [data-chip]')==['Finished2','Releasing3','Upcoming0']
              and page.evaluate(TEXT,'[data-lists-seasons] [data-chip]')==['Spring1','Summer2','Fall2','Winter0'])
        check('Year: any year, then the list\'s years, newest first',page.evaluate(TEXT,'[data-lists-year] option')[:5]==['Any year','2027','2026','2023','2021'])
        check('Tags: the list\'s tags by count, 24 shown, a search and "Show all"',page.evaluate(TEXT,'[data-lists-tags] [data-chip]')[:8]==['Isekai3','Magic3',
              'Male Protagonist1','Nudity1','Reincarnation1','Time Manipulation1','Video Games1','Super Power0'] and page.locator('[data-lists-tags] [data-chip]').count()==24
              and page.locator('[data-lists-tag-search]').count()==1 and page.locator('[data-lists-tags-more]').inner_text()=='Show all 38 tags'
              and page.locator('[data-lists-tags] [data-chip="Bondage"]').count()==0)
        check('Adult switch, the result count, one footer button, nothing to reset',page.locator('[data-lists-adult]').count()==1
              and page.locator('[data-lists-filter-done]').inner_text()=='Show 5 anime' and page.locator('.ps-sheet-actions > *').count()==1
              and page.locator('[data-lists-filter-reset]').count()==0)
        check('Sheet buttons are at least 48px',page.evaluate(SMALL,'.ps-sheet button')==[])
        shot(page,'lists-sheet-390.png')
        page.locator('[data-lists-genres] [data-chip="Action"]').click();page.locator('[data-lists-genres] [data-chip="Fantasy"]').click();page.wait_for_timeout(250)
        check('Genres combine (AND) and apply at once: tab counts, result and button state',page.locator('[data-lists-filter-done]').inner_text()=='Show 3 anime'
              and page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==['Watching3','Rewatching0','Planning1','Paused0','Completed0','Dropped0','Favourites1']
              and page.locator('[data-lists-genres] [data-chip="Action"][aria-pressed=true] svg').count()==1
              and page.locator('[data-lists-filter-button]').get_attribute('aria-label')=='Filter and sort, 2 active'
              and page.locator('[data-lists-filter-reset]').count()==1)
        page.locator('[data-lists-adult]').click();page.wait_for_timeout(200)
        check('"Only adult titles" offers adult tags',page.locator('[data-lists-tags] [data-chip="Bondage"]').count()==1
              and page.locator('[data-lists-filter-done]').inner_text()=='Show 0 anime')
        page.locator('[data-lists-tags] [data-chip="Bondage"]').click();page.locator('[data-lists-adult]').click();page.wait_for_timeout(200)
        check('A chosen tag stays visible, first, after the adult switch is off',page.locator('[data-lists-tags] [data-chip="Bondage"][aria-pressed=true]').count()==1
              and page.evaluate(TEXT,'[data-lists-tags] [data-chip]')[0]=='Bondage1')
        page.locator('[data-lists-tag-search]').fill('isek');page.wait_for_timeout(200)
        check('The tag search narrows the chips, chosen ones stay',page.evaluate(TEXT,'[data-lists-tags] [data-chip]')==['Bondage1','Isekai3'])
        page.locator('[data-lists-tag-search]').fill('');page.locator('[data-lists-tags-more]').click();page.wait_for_timeout(200)
        check('"Show all" lists every tag (38 plus the chosen adult one)',page.locator('[data-lists-tags] [data-chip]').count()==39)
        check('Back closes the sheet',back(page) and page.evaluate(OPEN)==0)
        check('Focus returns to the filter button',page.evaluate('document.activeElement?.hasAttribute("data-lists-filter-button")'))
        check('Active filters stay in sight above the grid, by name',page.locator('[data-lists-active-filters] p').inner_text()=='Filtered: Action, Fantasy, Bondage'
              and page.evaluate(SMALL,'[data-lists-active-filters] button')==[])
        check('An emptied tab stays, says so and offers a reset',page.locator('[data-lists-empty="filter"] p').first.inner_text()=='No anime match the filter'
              and page.locator('[data-lists-filter-button] .ps-dot').count()==1)
        shot(page,'lists-filter-empty-390.png')
        page.locator('[data-lists-empty="filter"] button').click();page.wait_for_timeout(250)
        check('Reset brings every anime back; the focus goes to the chosen tab, not the page',page.locator('[data-lists-grid] [data-phone-card]').count()==5
              and page.locator('[data-lists-filter-button] .ps-dot').count()==0 and page.locator('[data-lists-active-filters]').count()==0
              and page.evaluate(FOCUSED_TAB)=='CURRENT')
        page.locator('[data-lists-search]').fill('o');page.wait_for_timeout(200)
        open_sheet(page)
        page.locator('[data-lists-sort]').select_option('TITLE_DESC');page.locator('[data-lists-formats] [data-chip="MOVIE"]').click();page.wait_for_timeout(200)
        page.locator('[data-lists-formats] [data-chip="TV"]').click();page.wait_for_timeout(200)
        check('Format is a single choice',page.locator('[data-lists-formats] [aria-pressed=true]').count()==1 and page.locator('[data-lists-filter-done]').inner_text()=='Show 4 anime')
        page.locator('[data-lists-filter-reset]').click();page.wait_for_timeout(250)
        check('Reset clears the filters and the search, the sort stays; the focus stays in the sheet',page.locator('[data-lists-sort]').input_value()=='TITLE_DESC'
              and page.locator('.pl-select-text').inner_text()=='Title (Z-A)' and page.locator('[data-lists-search]').input_value()==''
              and page.locator('[data-lists-filter-done]').inner_text()=='Show 5 anime' and page.evaluate('document.activeElement?.getAttribute("role")')=='dialog')
        page.locator('[data-lists-filter-done]').click();page.locator('[data-lists-filters]').wait_for(state='detached');page.wait_for_timeout(200)
        check('Title (Z-A) sorts from Z to A and is remembered per type',page.evaluate(TITLES)==['Velvet Night','Overgeared','Mushoku Tensei: Jobless Reincarnation Season 3',
              'HELL MODE: The Hardcore Gamer Dominates in Another World with Garbage Balancing',"A Returner's Magic Should Be Special"]
              and page.evaluate('localStorage.getItem("sea-mobile-lists-sort-anime")')=='"TITLE_DESC"')
        open_sheet(page);page.locator('[data-lists-sort]').select_option('END_DATE_DESC');back(page);status_tab(page,'COMPLETED');page.evaluate('scrollTo(0,0)');page.wait_for_timeout(300)
        first=page.evaluate(TITLES)[0];to_bottom(page)
        check('Completed recently: newest first, titles without a date last instead of hidden',first=='Zz Completed Show 59'
              and page.evaluate(TITLES)[-1]=='Your Name.' and page.locator('[data-lists-status-tabs] [data-tab-value="COMPLETED"]').text_content()=='Completed70')
        page.evaluate('scrollTo(0,0)')

        # Refresh
        page.locator('[data-lists-refresh]').click();page.wait_for_timeout(150)
        check('Refresh asks AniList and spins while it runs',page.evaluate('mutations')==[['POST','/api/v1/anilist/collection']]
              and page.locator('[data-lists-refresh][aria-busy=true] svg.ps-spin').count()==1
              and page.locator('[data-lists-refresh]').get_attribute('aria-label')=='Refreshing AniList')
        page.locator('[data-lists-refresh]').click();page.wait_for_timeout(900)
        check('A second tap while it runs does nothing; the result is toasted and the lists reload',len(page.evaluate('mutations'))==1
              and page.evaluate('toasts')==[['success','AniList is up to date']] and {'ANILIST-get-raw-anime-collection','ANILIST-get-raw-anime-collection-tags',
              'MANGA-get-raw-anilist-manga-collection','ANILIST-get-ani-list-stats'}<=set(page.evaluate('invalidated'))
              and page.locator('[data-lists-refresh] svg.ps-spin').count()==0)

        # Manga
        page.locator('[data-lists-type-tabs] [data-tab-name="Manga"]').click();page.wait_for_timeout(300)
        check('Manga: facts with new chapters, reading list, no search below 8 titles',page.evaluate(FACTS)=='5 manga · 3 reading · 1 with new chapters'
              and page.locator('[data-lists-search]').count()==0 and page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==['Reading3','Planning1','Completed1'])
        check('Manga cards: the chapter once (under the title), unread chapters as badge, links',card(page,301,'[data-phone-tag]').count()==0
              and card(page,301,'.ps-card-meta').inner_text()=='Ch. 12 / 344' and card(page,301,'[data-phone-badge]').inner_text()=='8 new'
              and page.locator('[data-phone-card="301"]').get_attribute('aria-label')=='Overgeared, 12 of 344 chapters read, 8 new chapters'
              and card(page,302,'.ps-card-meta').inner_text()=='200 chapters' and card(page,302,'[data-phone-tag]').count()==0
              and card(page,303,'[data-phone-tag]').count()==0 and card(page,303,'.ps-card-meta').inner_text()=='Ch. 50'
              and page.locator('[data-phone-card="301"]').get_attribute('href')=='/manga/entry?id=301')
        long_press(page,301)
        check('Manga long press: preview and the manga plugin actions only',page.evaluate(TEXT,'[role=menuitem]')==['Preview']
              and page.locator('[data-plugin-card-items="manga"]').count()==1)
        back(page)
        check('The chosen type is remembered; Home\'s My lists type is left alone',page.evaluate('localStorage.getItem("sea-mobile-lists-type")')=='"manga"'
              and page.evaluate('homeType')=='anime')
        shot(page,'lists-manga-390.png')

        # Stats: a view of the chosen type
        check('Stats load only when they open','stats' not in page.evaluate('requested'))
        open_stats(page)
        check('Stats open on the shown type (manga here), the switch pressed, only refresh in the header',page.evaluate(FACTS)=='12 manga · 5,320 chapters read'
              and page.locator('[data-lists-stats="manga"]').count()==1 and page.locator('[data-lists-stats-button][aria-pressed=true]').count()==1
              and page.locator('[data-lists-filter-button]').count()==0 and page.locator('.ps-actions > *').count()==1)
        check('Stats have one Anime | Manga switch',page.locator('[role=tablist]').count()==1 and page.locator('[data-lists-stats-type]').count()==0)
        page.locator('[data-lists-type-tabs] [data-tab-name="Anime"]').click();page.locator('[data-lists-stats="anime"] [data-lists-stats-hero]').wait_for();page.wait_for_timeout(300)
        check('Anime | Manga switches the stats',page.evaluate(FACTS)=='186 anime · 41 days watched')
        check('Stats say up front how fresh they are',page.locator('[data-lists-stats-overview] h2').inner_text()=='Anime stats'
              and page.locator('[data-lists-stats-overview] .ps-section-note').inner_text()=='From AniList, up to an hour old.')
        FACT_ROWS='(sel=>[...document.querySelectorAll(sel+" > div")].map(d=>d.querySelector("dt").textContent+"="+d.querySelector("dd").textContent))'
        check('Stats: key facts',page.evaluate(FACT_ROWS,'[data-lists-stats-hero]')==['Total anime=186','Episodes=2,400','Watch time=41.3 days990 hours','Mean score=7.8',
              f'Started this year=12{YEAR}',f'Started last year=30{YEAR-1}'])
        check('Stats: highlights',page.evaluate(FACT_ROWS,'[data-lists-stats-highlights]')==['Most used score=840 titles','Completion=82%120 of 146 started titles',
              'Top genre=Genre 00100 titles · Score avg 8',f'Peak start year={YEAR-3}84 titles started'])
        SECTIONS='[...document.querySelectorAll("[data-lists-stats-section]")].map(s=>s.dataset.listsStatsSection+":"+s.querySelectorAll("li").length)'
        # 4,461 px before the long sections were cut to five rows (about 5.3 screens of 844 px; now under 4.4).
        check('Stats: ranked bars in the desktop sections, long ones show 5 until "Show all", a shorter page',page.evaluate(SECTIONS)
              ==['scores:5','statuses:6','formats:3','genres:5','start-years:4','release-years:5','studios:5']
              and page.evaluate(TEXT,'[data-lists-stats-more]')==['Show all 10','Show all 12','Show all 10']
              and page.evaluate('document.documentElement.scrollHeight')<3700)
        check('Stats bars: labels, values, detail lines',page.evaluate(TEXT,'[data-lists-stats-section="statuses"] .ps-bars-label')
              ==['Watching','Completed','Planning','Paused','Dropped','Rewatching']
              and page.evaluate(TEXT,'[data-lists-stats-section="scores"] .ps-bars-label')==['10','9','8.5','8','7']
              and page.evaluate(TEXT,'[data-lists-stats-section="release-years"] .ps-bars-label')[:2]==['2025','2024']
              and page.evaluate(TEXT,'[data-lists-stats-section="formats"] li:first-child > span')==['TV','150 titles','','750 h watched · Score avg 8'])
        ACCENT='(sel=>[...document.querySelectorAll(sel+" li")].filter(l=>getComputedStyle(l.querySelector(".ps-bars-track > span")).backgroundColor===getComputedStyle(document.querySelector("[data-lists-stats-section=formats] li .ps-bars-track > span")).backgroundColor).map(l=>l.querySelector(".ps-bars-label").textContent))'
        check('The accent marks the largest bar, also where the list runs by score or year',page.evaluate(ACCENT,'[data-lists-stats-section="statuses"]')==['Completed']
              and page.evaluate(ACCENT,'[data-lists-stats-section="scores"]')==['8'] and page.evaluate(ACCENT,'[data-lists-stats-section="start-years"]')==[str(YEAR-3)])
        page.locator('[data-lists-stats-more="genres"]').click();page.wait_for_timeout(200)
        check('"Show all" opens the whole section',page.locator('[data-lists-stats-section="genres"] li').count()==10 and page.locator('[data-lists-stats-more="genres"]').count()==0)
        check('Stats: buttons at least 48px, no overflow',page.evaluate(SMALL,'[data-phone-screen] button,[data-phone-screen] a')==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'lists-stats-390.png')
        page.locator('[data-lists-type-tabs] [data-tab-name="Manga"]').click();page.wait_for_timeout(300)
        check('Manga stats: facts, no formats or studios, chapters per genre',page.evaluate(FACTS)=='12 manga · 5,320 chapters read'
              and page.evaluate(SECTIONS)==['scores:2','statuses:3','genres:2','start-years:1','release-years:2']
              and page.evaluate(TEXT,'[data-lists-stats-section="genres"] li:first-child > span')==['Action','8 titles','','320 chapters · Score avg 8']
              and page.evaluate(TEXT,'[data-lists-stats-section="statuses"] .ps-bars-label')==['Reading','Completed','Planning'])
        shot(page,'lists-stats-manga-390.png')
        check('Home\'s My lists type is still untouched',page.evaluate('homeType')=='anime')
        check('Back closes the stats and shows the list of the same type',back(page) is True and page.locator('[data-lists-stats]').count()==0
              and page.evaluate(FACTS).startswith('5 manga') and page.locator('[data-lists-stats-button][aria-pressed=false]').count()==1)
        check('Back with nothing open is left to the app',back(page)==False)

        # Large text and narrow screens (the spec's rem-based 200 %)
        page.locator('[data-lists-type-tabs] [data-tab-name="Anime"]').click();page.wait_for_timeout(300);status_tab(page,'CURRENT')
        page.evaluate('document.querySelector("[data-page-wrapper-container]").style.setProperty("--ps-text-zoom","2")');page.wait_for_timeout(200)
        check('Text zoom 2 at 390px: two cover columns',page.evaluate(COLUMNS)==2 and page.evaluate(NO_OVERFLOW))
        page.set_viewport_size(dict(width=320,height=720));page.evaluate('document.documentElement.style.fontSize="200%"');page.wait_for_timeout(300)
        FITS='(sel=>[...document.querySelectorAll(sel)].every(e=>e.scrollWidth<=e.clientWidth+1))'
        check('320px with 200% rem: no page overflow, the switch labels fit',page.evaluate(NO_OVERFLOW) and page.evaluate(FITS,'[data-lists-type-tabs] button'))
        shot(page,'lists-320-rem200.png')
        open_sheet(page)
        check('Sheet at 320px with 200% rem: no overflow',page.evaluate('(e=>e.scrollWidth<=e.clientWidth+1)(document.querySelector(".ps-sheet"))') and page.evaluate(NO_OVERFLOW))
        back(page)
        open_stats(page)
        check('Stats at 320px with 200% rem: no overflow',page.evaluate(NO_OVERFLOW))
        page.close()

        # Android's text zoom (text only, as the phone does it), 320 and 360 px
        for lang,width in (('de',320),('en',320),('de',360)):
            p=open_page(width=width,height=720,language=lang if lang=='de' else None,html_style=TEXT_ZOOM)
            h1=p.evaluate('(h=>({h:h.getBoundingClientRect().height,f:parseFloat(getComputedStyle(h).fontSize)}))(document.querySelector("h1"))')
            name=f'Text zoom 2 ({lang}, {width}px)'
            check(f'{name}: zoom measured, title on one line with its actions, the switch on one row, no overflow',p.evaluate('getComputedStyle(document.querySelector("[data-phone-screen]")).getPropertyValue("--ps-text-zoom").trim()')=='2.00'
                  and h1['h']<h1['f']*1.6 and p.evaluate('document.querySelector(".ps-actions").getBoundingClientRect().top<document.querySelector("h1").getBoundingClientRect().bottom')
                  and p.evaluate(ROWS,'[data-lists-type-tabs] button')==1 and p.evaluate(NO_OVERFLOW))
            check(f'{name}: the first covers start on the first screen',p.evaluate(TOP,'[data-lists-grid]')<=p.evaluate('innerHeight')-200)
            if (lang,width)==('de',320):
                shot(p,'lists-320-200.png',full=False)
                open_sheet(p)
                check(f'{name}: the chosen sort wraps instead of being cut off, the footer keeps one row',p.evaluate(FITS,'.pl-select-text')
                      and p.locator('.pl-select-text').inner_text()=='Höchste eigene Bewertung' and p.evaluate('document.querySelector(".ps-sheet-actions").getBoundingClientRect().height')<110)
                shot(p,'lists-sheet-320-200.png',full=False)
                back(p);open_stats(p)
                check(f'{name}: stats without overflow',p.evaluate(NO_OVERFLOW))
                shot(p,'lists-stats-320-200.png',full=False)
            p.close()

        # Keyboard open: 390 x 524 with the 76px bottom bar above the keyboard
        # (At 844px the Watching page is barely taller than the screen, so only here can the field reach the top.)
        p=open_page(height=524)
        p.locator('[data-lists-search]').click();p.wait_for_timeout(400)
        check('Focusing the search scrolls it to the top of the screen',0<=p.evaluate(TOP,'.pl-search')<=20)
        p.keyboard.type('a');p.wait_for_timeout(400)
        check('Typing a search: the field moves to the top, the first hits with their titles show above the keyboard',0<=p.evaluate(TOP,'.pl-search')<=20
              and p.evaluate('document.querySelector("[data-lists-grid] .ps-card-title").getBoundingClientRect().bottom')<=524-76)
        shot(p,'lists-ime-390.png',full=False)
        p.locator('[data-lists-search]').fill('returner');p.wait_for_timeout(400)
        check('A search down to one hit keeps the field and the hit with its title above the keyboard',0<=p.evaluate(TOP,'.pl-search')<=524-76
              and p.evaluate('document.querySelector("[data-lists-grid] .ps-card-title").getBoundingClientRect().bottom')<=524-76)
        p.close()

        # Remembered choices, a search that follows its hits
        p=open_page(storage={'sea-mobile-lists-status-anime':'COMPLETED','sea-mobile-lists-sort-anime':'TITLE'})
        check('A new visit opens the remembered tab and sort, the tab in sight',p.evaluate(SELECTED)=='COMPLETED' and p.evaluate(IN_ROW)
              and p.evaluate(TITLES)[:2]==['Berserk','Cowboy Bebop'])
        shot(p,'lists-remembered-390.png',full=False)
        p.locator('[data-lists-search]').fill('returner');p.wait_for_timeout(300)
        check('A search without hits in the shown list shows the list with hits; the remembered list stays',p.evaluate(SELECTED)=='CURRENT' and p.evaluate(IN_ROW)
              and p.evaluate(TITLES)==["A Returner's Magic Should Be Special"] and p.evaluate('localStorage.getItem("sea-mobile-lists-status-anime")')=='"COMPLETED"')
        p.locator('[data-lists-search]').fill('');p.wait_for_timeout(300)
        check('Clearing the search returns to the remembered list',p.evaluate(SELECTED)=='COMPLETED')
        p.locator('[data-lists-search]').fill('returner');p.wait_for_timeout(300);status_tab(p,'COMPLETED')
        check('A tapped list without hits says where the hits are',p.evaluate(SELECTED)=='COMPLETED'
              and p.locator('[data-lists-empty="elsewhere"] p').first.inner_text()=='No hits in Completed'
              and p.locator('[data-lists-show-hits]').inner_text()=='Show Watching (1)')
        p.locator('[data-lists-show-hits]').click();p.wait_for_timeout(300)
        check('…and goes there, with the focus on that tab',p.evaluate(SELECTED)=='CURRENT' and p.evaluate(TITLES)==["A Returner's Magic Should Be Special"]
              and p.evaluate(FOCUSED_TAB)=='CURRENT')
        p.close()
        p=open_page(storage={'sea-mobile-lists-status-anime':'custom:Gone','sea-mobile-lists-sort-anime':'AIRDATE'})
        check('A remembered list or sort that is gone falls back',p.evaluate(SELECTED)=='CURRENT' and p.evaluate(TITLES)[0]=="A Returner's Magic Should Be Special")
        p.close()

        # Settings: adult content, streaming, library, theme
        plain=server();plain['status']['settings']['anilist']=dict(enableAdultContent=False,blurAdultContent=False);plain['streaming']=False
        plain['library']=dict(lists=[dict(status='CURRENT',entries=[dict(mediaId=103,libraryData=dict(mainFileCount=3,unwatchedCount=2,sharedPath='',allFilesLocked=False))])])
        p=open_page(server=plain)
        check('Adult content off: adult titles leave the counts',p.evaluate(FACTS)=='80 anime · 4 watching · 1 with new episodes' and p.locator('[data-phone-card="105"]').count()==0)
        check('Library titles carry the library mark',p.locator('[data-phone-card="103"][data-in-library]').count()==1 and p.locator('[data-phone-card][data-in-library]').count()==1
              and 'in your library' in p.locator('[data-phone-card="103"]').get_attribute('aria-label')
              and p.evaluate('getComputedStyle(document.querySelector("[data-phone-card=\\"103\\"] .ps-card-cover"),"::after").content')=='""')
        long_press(p,101)
        check('Without streaming "Add to playlist" is only offered for library anime',p.evaluate(TEXT,'[role=menuitem]')==['Preview','Continue'])
        back(p);long_press(p,103)
        check('Library anime keep "Add to playlist"',p.evaluate(TEXT,'[role=menuitem]')==['Preview','Continue','Add to playlist'])
        back(p);open_sheet(p)
        check('Adult content off: no adult switch',p.locator('[data-lists-adult]').count()==0)
        p.close()
        themed=copy.deepcopy(plain);themed['status']['themeSettings']=dict(showAnimeUnwatchedCount=True,showMangaUnreadCount=False)
        p=open_page(server=themed)
        check('Theme "unwatched count" on: watched titles show what is left (local files first), as on the desktop cards',card(p,102,'[data-phone-badge]').inner_text()=='6 left'
              and card(p,103,'[data-phone-badge]').inner_text()=='2 left' and card(p,101,'[data-phone-badge]').inner_text()=='2 new'
              and 'Returner' in p.locator('[data-phone-card="102"]').get_attribute('aria-label') and p.locator('[data-phone-card="102"]').get_attribute('aria-label').endswith('6 episodes left, Fall 2023'))
        p.locator('[data-lists-type-tabs] [data-tab-name="Manga"]').click();p.wait_for_timeout(300)
        check('Theme "unread count" off: no unread chapters',p.evaluate(FACTS)=='5 manga · 3 reading' and card(p,301,'[data-phone-badge]').count()==0)
        p.close()
        limited=server();limited['status']['settings']['library']['enableManga']=False;limited['status']['user']['isSimulated']=True
        p=open_page(server=limited,storage={'sea-mobile-lists-type':'manga'})
        check('Manga off and a simulated user: no switch, no stats; a remembered Manga falls back to Anime',p.locator('[data-lists-type-tabs]').count()==0
              and p.locator('[data-lists-stats-button]').count()==0 and p.evaluate(FACTS).startswith('81 anime') and 'stats' not in p.evaluate('requested'))
        p.close()
        no_manga=server();no_manga['status']['settings']['library']['enableManga']=False
        p=open_page(server=no_manga,storage={'sea-mobile-lists-type':'stats'})
        check('Manga off: the stats switch joins the header; an old stored "stats" opens the list',p.locator('.ps-actions [data-lists-stats-button]').count()==1
              and p.locator('.pl-switch').count()==0 and p.evaluate(FACTS).startswith('81 anime'))
        open_stats(p)
        check('…and opens the anime stats, Back returns',p.evaluate(FACTS)=='186 anime · 41 days watched' and back(p) is True and p.locator('[data-lists-stats]').count()==0)
        p.close()

        # Long lists: page by page, far covers unloaded
        p=open_page(server=server(anime=completed(250)))
        steps=[p.evaluate(CELLS)]
        for _ in range(4):
            # The grid's end 600px below the screen: inside the 1200px look-ahead, once.
            p.evaluate('scrollTo(0,document.querySelector(".pl-grid-end").getBoundingClientRect().top+scrollY-innerHeight-600)');p.wait_for_timeout(600)
            steps.append(p.evaluate(CELLS))
        check('A long list renders 60 covers per step, not all at once',steps==[60,120,180,240,250])
        check('Far covers leave their place and keep the page height; near ones are cards',p.evaluate(CARDS)<60
              and p.locator('[data-phone-card="1000"]').count()==0 and p.evaluate('parseFloat(document.querySelector("[data-lists-grid] .pl-cell").style.height)')>150)
        p.locator('[data-lists-top]').click();p.wait_for_timeout(500)
        check('Back at the top the first covers return',p.locator('[data-phone-card="1000"]').count()==1)
        # stress_lists.py: with 950 cells each result of a typed search rendered them all again.
        p.locator('[data-lists-search]').fill('completed 0');p.wait_for_timeout(400)
        check('A new search starts at the first page of its hits, not with every page scrolled before',p.evaluate(CELLS)==60
              and p.evaluate(TITLES)[0]=='Completed 0000')
        p.locator('[data-lists-search]').fill('');p.wait_for_timeout(400)
        check('…and so does clearing it',p.evaluate(CELLS)==60 and p.locator('[data-phone-card="1000"]').count()==1)
        p.close()

        # A stuck tag search, singular labels, translated refresh errors, duplicate score buckets
        tags=dict((str(400+i),[f'Plain {i*2:02d}',f'Plain {i*2+1:02d}']+(['Bondage','Ahegao','Anal Sex','Armpits','Ashikoki','Boobjob','Cumflation','Cunnilingus'][i:i+1] if i<8 else []))
            for i in range(10))
        shows=dict(MediaListCollection=dict(lists=[dict(status='CURRENT',isCustomList=False,
            entries=[entry(media(400+i,f'Show {i:02d}',genres=['Drama']),'CURRENT',1) for i in range(10)])]))
        p=open_page(server=server(anime=shows,animeTags=tags,mutationError=dict(status=500,data=dict(error='AniList error'))))
        check('Progress 1 of an unknown count reads "1 episode watched"',p.locator('[data-phone-card="400"]').get_attribute('aria-label')=='Show 00, 1 episode watched')
        open_sheet(p);p.locator('[data-lists-adult]').click();p.wait_for_timeout(200)
        p.locator('[data-lists-tag-search]').fill('bond');p.wait_for_timeout(200);p.locator('[data-lists-adult]').click();p.wait_for_timeout(200)
        check('A typed tag search keeps its field when fewer tags remain',p.locator('[data-lists-tag-search]').count()==1 and p.locator('[data-lists-tags] [data-chip]').count()==0)
        p.locator('[data-lists-tag-search]').fill('');p.wait_for_timeout(200)
        check('…so it can be cleared',p.locator('[data-lists-tags] [data-chip]').count()==20)
        p.locator('[data-lists-adult]').click();p.locator('[data-lists-tag-search]').fill('bond');p.wait_for_timeout(200);back(p);open_sheet(p)
        check('A new visit of the sheet starts without the old tag search',p.locator('[data-lists-tag-search]').input_value()=='' and p.locator('[data-lists-tags] [data-chip]').count()==24)
        back(p);p.locator('[data-lists-refresh]').click();p.wait_for_timeout(900)
        check('A failed refresh toasts in the app language',p.evaluate('toasts')==[['error','AniList could not be refreshed.']])
        p.close()
        p=open_page(language='de',server=server(mutationError=dict(status=429,data=dict(error='Too many requests'))))
        p.locator('[data-lists-refresh]').click();p.wait_for_timeout(900)
        check('German: a rate-limited refresh says so in German',p.evaluate('toasts')==[['error','AniList ist gerade ausgelastet. Versuch es in einer Minute noch einmal.']])
        p.close()
        p=open_page(server=server(stats=dict(animeStats=dict(count=10,minutesWatched=600,episodesWatched=20,meanScore=70,
            scores=[dict(score=100,count=5),dict(score=10,count=2),dict(score=80,count=3)]),mangaStats=dict(count=0))))
        open_stats(p)
        check('Stats: a 100-point 10 (1/10) and 100 (10/10) stay two bars, the most used score is 10',p.evaluate(TEXT,'[data-lists-stats-section="scores"] .ps-bars-label')==['10','8','1']
              and p.evaluate(TEXT,'[data-lists-stats-highlights] dd')[0]=='105 titles')
        p.close()

        # States
        for name,patch,selector in (
                ('loading',dict(states=dict(anime='loading')),'.ps-loading[aria-busy=true]'),
                ('error',dict(states=dict(anime='error')),'[data-lists-error]'),
                ('offline',dict(states=dict(anime='error')),'[data-lists-error]'),
                ('empty',dict(anime=dict(MediaListCollection=dict(lists=[]))),'[data-lists-empty="list"]'),
                ('null',dict(anime=None),'[data-lists-empty="list"]'),
                ('manga-empty',dict(manga=dict(MediaListCollection=dict(lists=[dict(status='CURRENT',entries=[])]))),'[data-lists-empty="list"]'),
                ('stats-loading',dict(states=dict(stats='loading')),'[data-phone-screen]'),
                ('stats-error',dict(states=dict(stats='error')),'[data-phone-screen]'),
                ('stats-empty',dict(stats=dict(animeStats=dict(count=0,minutesWatched=0,episodesWatched=0,meanScore=0))),'[data-phone-screen]'),
                ('stats-null',dict(stats=None),'[data-phone-screen]')):
            storage={'sea-mobile-lists-type':'manga'} if name=='manga-empty' else {}
            p=open_page(server=server(**patch),storage=storage,offline=name=='offline',ready=selector)
            if name.startswith('stats'): open_stats(p)
            check(f'{name.capitalize()} state keeps the title and the actions',p.locator('h1').inner_text()=='My lists' and p.locator('[data-lists-refresh]').count()==1
                  and (name.startswith('stats') or p.locator('[data-lists-filter-button]').count()==1) and p.locator('[data-lists-type-tabs]').count()==1)
            if not name.startswith('stats'): check(f'{name.capitalize()}: nothing to filter, the filter button is off',p.locator('[data-lists-filter-button]').is_disabled())
            if name=='loading':
                check('Loading: the facts say so, bones instead of covers',p.evaluate(FACTS)=='Loading your list…' and p.locator('[data-lists-grid]').count()==0)
                bones=p.evaluate(TOP,'.ps-loading .ps-grid');q=open_page();loaded=q.evaluate(TOP,'[data-lists-grid]');q.close()
                check('Loading: the bones put the grid where the list puts it',abs(bones-loaded)<=2)
            if name=='error':
                check('Error: facts and one sentence',p.evaluate(FACTS)=='Not loaded' and p.locator('[data-lists-error] p').inner_text()=='Your anime list could not be loaded.')
                p.get_by_role('button',name='Try again').click();p.wait_for_timeout(200)
                check('Error: try again reloads the list and its tags',{'anime','animeTags'}<=set(p.evaluate('refetches')))
            if name=='offline': check('Offline: the error names the missing connection',p.locator('[data-lists-error] p').inner_text().startswith('No internet connection'))
            if name=='empty': check('Empty: what is missing and the ways to find anime',p.evaluate(FACTS)=='0 anime'
                  and [a.get_attribute('href') for a in p.locator('[data-lists-empty] a').all()]==['/discover','/search'])
            if name=='null': check('A list the server answers with null is empty, not loading forever',p.evaluate(FACTS)=='0 anime'
                  and p.locator('.ps-loading').count()==0)
            if name=='manga-empty': check('Empty manga list: Discover and Search open on manga',
                  [a.get_attribute('href') for a in p.locator('[data-lists-empty] a').all()]==['/discover?type=manga','/search?type=manga'])
            if name=='stats-loading': check('Stats loading: the facts say so',p.evaluate(FACTS)=='Loading your stats…' and p.locator('[data-lists-stats] .ps-loading[aria-busy=true]').count()==1)
            if name=='stats-empty': check('Stats empty: only the count in the facts',p.evaluate(FACTS)=='0 anime' and p.locator('[data-lists-empty="stats"]').count()==1)
            if name=='stats-null': check('Stats the server answers with null are empty, not loading forever',p.locator('[data-lists-empty="stats"]').count()==1
                  and p.locator('.ps-loading').count()==0)
            if name=='stats-error':
                p.get_by_role('button',name='Try again').click();p.wait_for_timeout(200)
                check('Stats error (new on the phone): try again reloads them',p.evaluate('refetches')==['stats'])
            shot(p,f'lists-{name}-390.png');p.close()

        # German
        de=open_page(language='de')
        check('German: facts, switch, status tabs',de.evaluate(FACTS)=='81 Anime · 5 am Schauen · 1 mit neuen Folgen' and de.locator('h1').inner_text()=='Meine Listen'
              and de.evaluate(TEXT,'[data-lists-type-tabs] [role=tab]')==['Anime','Manga'] and de.locator('[data-lists-stats-button]').get_attribute('aria-label')=='Statistik'
              and de.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==['Schaue ich5','Schaue ich erneut1','Geplant3','Pausiert1','Fertig70','Abgebrochen1','Favourites3'])
        check('German: cards and search',[card(de,101,'[data-phone-badge]').inner_text(),card(de,101,'.ps-card-meta').inner_text(),card(de,103,'.ps-card-meta').inner_text(),
              card(de,102,'.ps-card-meta').inner_text()]==['2 neu','Folge 7 in 2 Tagen','Folge 11 in 5 Std.','Herbst 2023']
              and de.locator('[data-lists-search]').get_attribute('placeholder')=='Deine Anime durchsuchen'
              and de.locator('[data-phone-card="101"]').get_attribute('aria-label')=='Overgeared, 4 von 12 Folgen gesehen, 2 neue Folgen, Folge 7 in 2 Tagen')
        check('German: no overflow, every button at least 48px',de.evaluate(NO_OVERFLOW) and de.evaluate(SMALL,'[data-phone-screen] button,[data-phone-screen] a')==[])
        check('German: the meta line keeps one line',de.evaluate('[...document.querySelectorAll("[data-lists-grid] .ps-card-meta")].every(e=>e.getBoundingClientRect().height<parseFloat(getComputedStyle(e).fontSize)*2)'))
        shot(de,'lists-de-390.png')
        open_sheet(de)
        check('German: sheet',de.locator('.ps-sheet .UI-Modal__title').inner_text()=='Filtern & sortieren' and de.locator('[data-lists-filter-done]').inner_text()=='5 Anime zeigen'
              and de.evaluate(TEXT,'[data-lists-sort] option')[:4]==['Höchste eigene Bewertung','Niedrigste eigene Bewertung','Titel (A–Z)','Titel (Z–A)']
              and de.evaluate(TEXT,'[data-lists-releases] [data-chip]')==['Abgeschlossen2','Läuft3','Demnächst0']
              and de.locator('[data-lists-filter-note]').inner_text()=='Die Zahlen zählen die Titel in „Schaue ich“. Die Filter gelten für alle Listen.'
              and de.locator('[data-lists-adult] small').inner_text()=='Zeigt auch Tags für Erwachsene.'
              and de.locator('[data-lists-tags-more]').inner_text()=='Alle 38 Tags zeigen' and de.locator('[data-lists-filter-button]').get_attribute('aria-label')=='Filtern und sortieren')
        shot(de,'lists-sheet-de-390.png')
        back(de);status_tab(de,'COMPLETED')
        check('German: a score with a decimal comma',card(de,111,'[data-phone-badge]').inner_text()=='★ 8,5'
              and 'deine Bewertung 8,5' in de.locator('[data-phone-card="111"]').get_attribute('aria-label'))
        open_stats(de)
        check('German: stats',de.evaluate(FACTS)=='186 Anime · 41 Tage geschaut'
              and de.evaluate(TEXT,'[data-lists-stats-hero] dt')[:4]==['Anime insgesamt','Folgen','Geschaute Zeit','Durchschnittsbewertung']
              and de.evaluate(TEXT,'[data-lists-stats-hero] > div:nth-child(3) dd')==['41,3 Tage990 Stunden']
              and de.evaluate(TEXT,'[data-lists-stats-highlights] dt')[0]=='Häufigste Bewertung'
              and de.evaluate(TEXT,'[data-lists-stats-highlights] small')[1]=='120 von 146 begonnenen Titeln'
              and de.locator('[data-lists-stats-section="scores"] h2').inner_text()=='Bewertungsverteilung')
        shot(de,'lists-stats-de-390.png')
        de.locator('[data-lists-refresh]').click();de.wait_for_timeout(900)
        check('German: refresh toast',de.evaluate('toasts')==[['success','AniList ist aktuell']])
        de.close()
        browser.close()
check('No script errors on any page',errors==[])
check('No React warnings (duplicate keys, update loops) on any page',not [w for w in warnings if 'same key' in w or 'Maximum update depth' in w or 'Cannot update a component' in w])
print(json.dumps(checks,indent=2))
