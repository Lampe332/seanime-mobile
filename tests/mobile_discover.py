"""Discover tab (Android phones): the phone screen instead of the desktop page (tablets keep it), the desktop page's
data-* hooks on their phone counterparts, header facts and actions, the Anime / Schedule / Manga segment with ?type=
(never 2 + 1 with large text, no scroll to the top on a switch), the plugin slot, one genre for the genre-aware rows
(which come first; dimmed covers while a genre loads, empty genres with a way back, failing genres without stale
spotlight, offline), the spotlight (not repeated in the row under it), the anime rows with "See all", list status,
library / new / release marks, aired and episode marks, the dub badge plugin's hooks, lazy rows, no refetch loop, the
schedule loaded page by page (a failed later page keeps the days so far), the manga rows, long-press menus with Preview,
Back to Discover restoring the page and row positions, Android Back through the native back script, loading / empty /
error / offline states, German texts, 48px targets, 390px and 320px with 200% text. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from datetime import datetime, timedelta
import tempfile, subprocess, json, sys, copy
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
# Cards skip painting off screen (content-visibility:auto); pictures and measurements of every card paint them all.
PAINT_ALL='document.head.insertAdjacentHTML("beforeend","<style id=paint-all>.ps-card{content-visibility:visible!important}</style>")'
UNPAINT='document.getElementById("paint-all")?.remove()'
def shot(page,name):
    if not shots: return
    page.evaluate(PAINT_ALL);page.wait_for_timeout(150);page.screenshot(path=str(shots/name),full_page=True);page.evaluate(UNPAINT)
HOST='http://discover.test'
NBSP=' '

# Seasons and day names as the page computes them (same machine, same local time zone)
NOW=datetime.now()
SEASONS=['WINTER','SPRING','SUMMER','FALL']
SEASON_EN={'WINTER':'Winter','SPRING':'Spring','SUMMER':'Summer','FALL':'Fall'}
SEASON_DE={'WINTER':'Winter','SPRING':'Frühling','SUMMER':'Sommer','FALL':'Herbst'}
_i=(NOW.month-1)//3
CUR=(SEASONS[_i],NOW.year);PREV=(SEASONS[_i-1],NOW.year-1 if _i==0 else NOW.year)
DAYS_EN=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
DAYS_DE=['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag']
MONTHS_EN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
MONTHS_DE=['Jan.','Feb.','März','Apr.','Mai','Juni','Juli','Aug.','Sep.','Okt.','Nov.','Dez.']
def day_title(offset,german=False):
    d=NOW+timedelta(days=offset)
    if offset==0: return 'Heute noch' if german else 'Later today'
    if offset==1: return 'Morgen' if german else 'Tomorrow'
    return f'{DAYS_DE[d.weekday()]}, {d.day}. {MONTHS_DE[d.month-1]}' if german else f'{DAYS_EN[d.weekday()]}, {d.day} {MONTHS_EN[d.month-1]}'

def media(i,title,**kw):
    d=dict(id=i,idMal=9000+i,title=dict(userPreferred=title,romaji=title),coverImage=dict(large=f'{HOST}/cover/{i}.svg',extraLarge=f'{HOST}/cover/{i}.svg'),
        status='FINISHED' if i%3==0 else 'RELEASING',format='TV',season=CUR[0],seasonYear=CUR[1],meanScore=60+i%30,isAdult=False,countryOfOrigin='JP',type='ANIME',
        episodes=12,genres=['Action' if i%2 else 'Comedy','Drama' if i%3 else 'Romance'],startDate=dict(year=2015+i%10))
    d.update(kw);return d
TITLES=['Witch Hat Atelier','The Apothecary Diaries','Midnight Velvet Club','Kaiju No. 8','Dandadan','Sakamoto Days','Frieren: Beyond Journey\'s End',
    'Blue Box','Orb: On the Movements of the Earth','Delicious in Dungeon','Mushoku Tensei: Jobless Reincarnation Season 3','Spy x Family',
    'The Summer Hikaru Died','Takopi\'s Original Sin','Gachiakuta','My Hero Academia: Vigilantes','Lazarus','Bocchi the Rock!','Chainsaw Man','Vinland Saga']
TRENDING=[media(101+n,t) for n,t in enumerate(TITLES)]
TRENDING[0].update(status='NOT_YET_RELEASED',season=None,seasonYear=None)
TRENDING[1].update(bannerImage=f'{HOST}/banner/102.svg',meanScore=82)
TRENDING[2].update(isAdult=True)
TRENDING[8].update(nextAiringEpisode=dict(episode=6,airingAt=0,timeUntilAiring=0))
SPOT=[102,104,105,106,107]   # trending titles that are out, without the blurred adult one
ROW=[101,103]+list(range(108,121))
SEASON_ROW=[media(151,'Steel Ball Run',meanScore=70),media(152,'Nana Does Not Dream',meanScore=90),media(153,'Ranma 1/2',meanScore=80),
    media(154,'Unrated Show',meanScore=None)]
LAST_ROW=[media(161+n,t,season=PREV[0],seasonYear=PREV[1]) for n,t in enumerate(['You and I Are Polar Opposites','Red River','Rent-a-Girlfriend','Bad Girl'])]
UPCOMING=[media(171+n,t,status='NOT_YET_RELEASED',season=None,seasonYear=None) for n,t in enumerate(['Jujutsu Kaisen: Culling Game','Hell\'s Paradise 2','Oshi no Ko 3'])]
MOVIES=[media(181+n,t,format='MOVIE',status='FINISHED') for n,t in enumerate(['Chainsaw Man: Reze Arc','Look Back','The Colors Within'])]
MISSED=[media(191+n,t) for n,t in enumerate(['Mob Psycho 100 III','Vinland Saga Season 3','Haikyu!! The Dumpster Battle'])]
def airing(i,m,episode,**when):
    d=dict(id=i,episode=episode,media=m);d.update(when);return d
RECENT=[airing(201,media(211,'DARK MACHINE THE ANIMATION',episodes=11),2,ago=17*3600+300),
    airing(202,media(211,'DARK MACHINE THE ANIMATION',episodes=11),1,ago=7*86400+17*3600),
    airing(203,media(212,'Red River Movie',format='MOVIE',episodes=1),1,ago=3*86400+600),
    airing(204,media(213,'Mofusand',episodes=None),4,ago=30*60+20),
    airing(205,media(214,'Adult Show',isAdult=True),3,ago=3600),airing(206,media(215,'Korean Show',countryOfOrigin='KR'),2,ago=3600),
    airing(207,media(216,'Short Show',format='TV_SHORT'),5,ago=3600)]
# Schedule pages as AniList sends them (by time; the page sorts each in the browser once the times are absolute). The
# second page starts with the first one's last airing (pages shift while airings pass) and reaches past the two weeks.
SCHED1=[airing(310,media(320,'Yesterday Show'),1,day=-1,hour=12,minute=0),
    airing(301,media(311,'The Iceblade Sorcerer Shall Rule the World II',nextAiringEpisode=dict(episode=99,airingAt=0)),5,day=0,hour=23,minute=30),
    airing(302,media(312,'One Piece',episodes=None),1150,day=0,hour=18,minute=0),
    airing(303,media(313,'A Returner\'s Magic Should Be Special'),6,day=1,hour=1,minute=0),
    airing(305,media(315,'Adult Late Show',isAdult=True),2,day=0,hour=22,minute=0),airing(306,media(316,'Chinese Show',countryOfOrigin='CN'),2,day=1,hour=9,minute=0),
    airing(307,media(317,'Short Show',format='TV_SHORT'),2,day=1,hour=10,minute=0),airing(308,media(318,'Manga Entry',type='MANGA'),2,day=1,hour=11,minute=0),
    airing(304,media(314,'HELL MODE'),11,day=2,hour=20,minute=0)]
SCHED2=[airing(304,media(314,'HELL MODE'),11,day=2,hour=20,minute=0),airing(321,media(331,'Mushoku Tensei Season 3'),2,day=3,hour=12,minute=0),
    airing(309,media(319,'Far Future Show'),1,day=20,hour=12,minute=0)]
def manga(i,title,country,**kw):
    return media(i,title,type='MANGA',format='MANGA',countryOfOrigin=country,season=None,seasonYear=None,episodes=None,chapters=100,**kw)
MANGA={'JP':[manga(501+n,t,'JP') for n,t in enumerate(['Kagurabachi','Sakamoto Days','Kaiju No. 8','Dandadan','Blue Lock','Witch Hat Atelier',
        'Chainsaw Man','Jujutsu Kaisen'])],
    'KR':[manga(601+n,t,'KR') for n,t in enumerate(['Omniscient Reader','Solo Leveling','Overgeared','Tower of God'])],
    'CN':[manga(701+n,t,'CN') for n,t in enumerate(['Meizi Tai Duo','The Divine Ring Descends','Martial Peak'])]}
MANGA['JP'][2].update(status='NOT_YET_RELEASED')
FIXTURES=dict(trending=TRENDING,season=SEASON_ROW,lastSeason=LAST_ROW,upcoming=UPCOMING,movies=MOVIES,missed=MISSED,recent=RECENT,schedule=[SCHED1,SCHED2],
    scheduleMore=True,manga=MANGA,current=dict(season=CUR[0],year=CUR[1]))
STATE=dict(serverStatus=dict(isOffline=False,user=dict(viewer=dict(name='harness')),themeSettings=dict(showAnimeUnwatchedCount=True),
        settings=dict(library=dict(enableManga=True),anilist=dict(blurAdultContent=True))),
    animeListData={'108':dict(status='PLANNING',progress=0),'109':dict(status='CURRENT',progress=2),'213':dict(status='CURRENT',progress=3),
        '311':dict(status='CURRENT',progress=4)},
    libraryCollection=dict(lists=[dict(type='COMPLETED',status='COMPLETED',entries=[dict(mediaId=110,listData=dict(status='COMPLETED',progress=12),
        libraryData=dict(allFilesLocked=False,sharedPath='/anime/110',unwatchedCount=0,mainFileCount=12))])]),
    mangaCollection=dict(lists=[dict(type='CURRENT',status='CURRENT',entries=[dict(mediaId=507,listData=dict(status='CURRENT',progress=40))])]))
# Fixture times are relative (seconds ago, or day offset and local time) and made absolute in the page, so labels match.
INIT='''(()=>{const spec=%s;const now=Date.now(),sec=Math.floor(now/1000),d=new Date(now);
const at=s=>s.ago!=null?sec-s.ago:Math.floor(new Date(d.getFullYear(),d.getMonth(),d.getDate()+s.day,s.hour,s.minute).getTime()/1000);
for(const list of [spec.fixtures.recent,...spec.fixtures.schedule]){for(const s of list){s.airingAt=at(s);s.timeUntilAiring=s.airingAt-sec;
for(const k of ["ago","day","hour","minute"])delete s[k]}}
for(const page of spec.fixtures.schedule)page.sort((a,b)=>a.airingAt-b.airingAt);
Object.assign(window,spec.state,{fixtures:spec.fixtures,requests:[],routes:[],navigations:[],previews:[],mutations:[],failWhen:[],hangWhen:[],latency:60});
window.respond=(endpoint,data)=>{const f=window.fixtures,g=data&&data.genres&&data.genres[0];
const pick=list=>g?list.filter(m=>(m.genres||[]).includes(g)):list,page=media=>({Page:{media,pageInfo:{hasNextPage:false}}});
if(endpoint==="/api/v1/anilist/list-anime"){if(g==="Horror")return page([]);
if(data.status&&data.status[0]==="NOT_YET_RELEASED")return page(f.upcoming);if(data.format==="MOVIE")return page(f.movies);
if(data.sort&&data.sort[0]==="SCORE_DESC")return page(pick(data.season===f.current.season&&data.seasonYear===f.current.year?f.season:f.lastSeason));
return page(pick(f.trending))}
if(endpoint==="/api/v1/anilist/list-recent-anime"){if(!data.notYetAired)return {Page:{airingSchedules:f.recent}};
const i=data.page-1;return {Page:{pageInfo:{hasNextPage:i<f.schedule.length-1||!!f.scheduleMore},airingSchedules:f.schedule[i]||[]}}}
if(endpoint==="/api/v1/anilist/list-missed-sequels")return f.missed;
if(endpoint==="/api/v1/manga/anilist/list")return page(pick(f.manga[data.countryOfOrigin]||[]));
throw new Error("Unknown endpoint "+endpoint)}})()'''
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
COVER='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="hsl({h} 35% 30%)"/><circle cx="120" cy="110" r="52" fill="hsl({h} 45% 55%)"/><rect x="24" y="200" width="150" height="16" rx="8" fill="hsl({h} 30% 70%)"/></svg>'
BANNER='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><rect width="1200" height="400" fill="hsl(200 35% 28%)"/><circle cx="900" cy="160" r="140" fill="hsl(30 60% 55%)"/><rect x="0" y="300" width="1200" height="100" fill="hsl(200 30% 18%)"/></svg>'
HTML='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>b.textContent||b.getAttribute("aria-label")))'''
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
HEADS='[...document.querySelectorAll("[data-discover-block] .ps-section-head h2")].map(e=>e.firstChild.textContent.trim())'
BLOCKS='[...document.querySelectorAll("[data-discover-block]")].map(e=>e.getAttribute("data-discover-block"))'
FEATURES='[...document.querySelectorAll("[data-discover-feature]")].map(e=>+e.dataset.discoverFeature)'
ROW_TEXT_WIDE='[...document.querySelectorAll("[data-discover-schedule-row] .ps-list-text")].every(e=>e.getBoundingClientRect().width>=innerWidth/2)'
SEGMENT='''(()=>{const tabs=[...document.querySelectorAll("[data-discover-tabs] [role=tab]")];
return {rows:new Set(tabs.map(b=>Math.round(b.getBoundingClientRect().top))).size,fit:tabs.every(b=>b.scrollWidth<=b.clientWidth+1)}})()'''
# Large text: titles and marks that are cut although they are short (clamped or ellipsized)
CUT='''(()=>{const cut=e=>e.scrollHeight>e.clientHeight+1;const lines=e=>Math.round(e.getBoundingClientRect().height/parseFloat(getComputedStyle(e).lineHeight));
return {cards:[...document.querySelectorAll("[data-phone-card] .ps-card-title")].filter(e=>e.textContent.length<=20&&cut(e)).map(e=>e.textContent),
words:[...document.querySelectorAll("[data-phone-card] .ps-card-title")].filter(e=>!/[ -]/.test(e.textContent)&&lines(e)>1).map(e=>e.textContent),
tags:[...document.querySelectorAll(".ps-tag,.ps-badge")].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent),
features:[...document.querySelectorAll(".ps-feature-title")].filter(cut).map(e=>e.textContent),
schedule:[...document.querySelectorAll("[data-discover-schedule-row] .ps-list-title")].filter(cut).map(e=>e.textContent)}})()'''
def cards(block): return f'[...document.querySelectorAll(\'[data-discover-block="{block}"] [data-phone-card]\')].map(e=>+e.getAttribute("data-phone-card"))'
def card_text(block,part): return f'[...document.querySelectorAll(\'[data-discover-block="{block}"] [data-phone-card] {part}\')].map(e=>e.textContent)'
def card(block,id,part=''): return f'[data-discover-block="{block}"] [data-phone-card="{id}"] {part}'.strip()
def requests(page,endpoint,match=''): return [r[1] for r in page.evaluate('requests') if r[0]==endpoint and match in json.dumps(r[1],separators=(',',':'))]
LIST_ANIME='/api/v1/anilist/list-anime';RECENT_API='/api/v1/anilist/list-recent-anime';MANGA_API='/api/v1/manga/anilist/list';MISSED_API='/api/v1/anilist/list-missed-sequels'
# The installed dub badge plugin (MyDubList), as it works on MediaEntryCard: every [data-media-entry-card-body='true'] with
# a dubbed AniList id gets the badge in its link (the element itself, or its parent when that has an href).
DUB_PLUGIN='''(ids=>{for(const el of document.querySelectorAll("[data-media-entry-card-body='true']")){
const id=el.getAttribute("data-media-id")||((el.getAttribute("href")||"").match(/[?&]id=(\\d+)/)||[])[1];el.setAttribute("data-dub-badge-checked","true");
if(!ids.includes(+id))continue;let target=el;if(el.parentElement&&el.parentElement.getAttribute("href"))target=el.parentElement;
target.style.position="relative";if(target.getAttribute("data-has-dub-badge"))continue;const w=document.createElement("div");
w.className="seanime-dub-badge-wrapper absolute z-10 seanime-base-dub-badge flex items-center group/badge pointer-events-auto transition-all duration-300 ease-in-out";
w.setAttribute("style","top: 8px; right: 4px;");
w.innerHTML='<div class="group relative"><span class="UI-Badge__root inline-flex flex-none w-fit overflow-hidden justify-center items-center gap-2 text-white bg-indigo-500 h-7 px-2.5 text-md font-semibold tracking-wide rounded-full shadow-md cursor-pointer"><svg viewBox="0 0 24 24" height="1.2em" width="1.2em"><path d="M12 14c1.66 0 3-1.34 3-3V5"></path></svg></span></div>';
target.append(w);target.setAttribute("data-has-dub-badge","true")}})'''
DUB_PLACE='''(sel=>{const card=document.querySelector(sel),badge=card&&card.querySelector(".seanime-dub-badge-wrapper");if(!badge)return null;
card.scrollIntoView({block:"center",inline:"center"});
const cover=card.querySelector(".ps-card-cover")||card,b=badge.getBoundingClientRect(),c=cover.getBoundingClientRect(),accent=card.querySelector(".ps-badge");
const a=accent&&accent.getBoundingClientRect();const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
return {left:b.left-c.left,top:b.top-c.top,inside:b.right<=c.right&&b.bottom<=c.bottom,clearOfBadge:!a||b.right<=a.left||b.bottom<=a.top,
label:getComputedStyle(badge.querySelector(".UI-Badge__root"),"::after").content,tapsCard:!!hit&&hit.closest("a")===card}})'''
with tempfile.TemporaryDirectory(prefix='seanime-discover-') as tmp:
    bundle=Path(tmp)/'discover.js'
    subprocess.run(['node',str(root/'tests/mobile_discover_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,query='',language=None,state=None,fixtures=None,ready='[data-discover-phone]',script=None):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script(INIT%json.dumps(dict(state=state or STATE,fixtures=fixtures or FIXTURES)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            if script: page.add_init_script(script)
            page.route(f'{HOST}/cover/**',lambda r:r.fulfill(content_type='image/svg+xml',body=COVER.format(h=int(r.request.url.split('/')[-1].split('.')[0])*47%360)))
            page.route(f'{HOST}/banner/**',lambda r:r.fulfill(content_type='image/svg+xml',body=BANNER))
            page.route(f'{HOST}/discover*',lambda r:r.fulfill(content_type='text/html',body=HTML))
            page.goto(f'{HOST}/discover'+query)
            for css in (root/'backend/seanime-web/out/static/css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator(ready).first.wait_for();page.wait_for_timeout(600)
            return page
        def back(page):
            ok=page.evaluate(NATIVE_BACK);page.wait_for_timeout(300);return ok
        def scroll_through(page):
            height=page.evaluate('document.documentElement.scrollHeight')
            for y in range(0,height+800,350):
                page.evaluate(f'window.scrollTo(0,{y})');page.wait_for_timeout(120)
            page.wait_for_timeout(400);page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(200)
        def long_press(page,selector):
            page.locator(selector).first.dispatch_event('contextmenu',dict(clientX=150,clientY=400,button=2))
            page.get_by_role('menuitem',name='Preview').wait_for();page.wait_for_timeout(300)  # the menu zooms in from 95 %
        def tab(page,name):
            page.locator(f'[data-discover-tabs] [data-tab-name="{name}"]').click();page.wait_for_timeout(500)
        def go_back(page,wait=700):
            page.evaluate('history.back()');page.wait_for_timeout(wait)

        # Anime tab
        page=open_page()
        check('Phone screen replaces the desktop page',page.locator('h1').inner_text()=='Discover'
              and page.locator('[data-desktop-discover-header],[data-desktop-discover-row]').count()==0)
        check('Facts: the current season',page.locator('[data-phone-facts]').inner_text()==f'{SEASON_EN[CUR[0]]} {CUR[1]} season')
        check('Header actions: search anime and the calendar',page.locator('[data-discover-search]').get_attribute('href')=='/search'
              and page.locator('[data-discover-search]').get_attribute('aria-label')=='Search anime' and page.locator('[data-discover-calendar]').get_attribute('href')=='/schedule')
        check('Segment: Anime, Schedule, Manga with their tab names, Anime chosen, a full-sentence label',page.evaluate(TEXT,'[data-discover-tabs] [role=tab]')==['Anime','Schedule','Manga']
              and page.evaluate('[...document.querySelectorAll("[data-discover-tabs] [role=tab]")].map(e=>e.dataset.tabName)')==['Anime','Schedule','Manga']
              and page.locator('[data-discover-tabs].ps-segment [data-tab-name="Anime"][aria-selected=true]').count()==1
              and page.locator('[data-discover-tabs]').get_attribute('aria-label')=='What do you want to discover?')
        check('Plugin slot sits right after the tabs',page.evaluate('document.querySelector("[data-discover-tabs]").nextElementSibling?.getAttribute("data-plugin-slot")')
              =='after-discover-screen-header')
        check('Genre chips: All and the 18 genres, All chosen',page.evaluate(TEXT,'[data-discover-genres] button')[:5]==['All','Action','Adventure','Comedy','Drama']
              and page.locator('[data-discover-genres] button').count()==19 and page.locator('[data-discover-genres] [data-chip="all"][aria-pressed=true]').count()==1)
        check('Spotlight: the first five trending titles that are out',page.evaluate(FEATURES)==SPOT)
        check('Spotlight card: banner picture, title, season · format · score, entry link',
              page.locator('[data-discover-feature="102"] img').get_attribute('src')==f'{HOST}/banner/102.svg'
              and page.locator('[data-discover-feature="104"] img').get_attribute('src')==f'{HOST}/cover/104.svg'
              and page.locator('[data-discover-feature="102"] .ps-feature-title').inner_text()=='The Apothecary Diaries'
              and page.locator('[data-discover-feature="102"] .ps-feature-meta').inner_text()==f'{SEASON_EN[CUR[0]]} {CUR[1]} · TV · 82%'
              and page.locator('[data-discover-feature="102"]').get_attribute('href')=='/entry?id=102')
        check('Spotlight without a banner shows the upper part of the cover',page.locator('[data-discover-feature="104"][data-cover-fallback]').count()==1
              and page.locator('[data-discover-feature="102"][data-cover-fallback]').count()==0
              and page.evaluate('getComputedStyle(document.querySelector(\'[data-discover-feature="104"] img\')).objectPosition')=='50% 20%')
        check('Blurred adult titles: veiled in the rows, not featured in the spotlight',page.locator('[data-discover-feature="103"]').count()==0
              and page.locator(card('trending',103,'[data-adult-veil]')).count()==1)
        check('Lazy rows: coming soon and movies wait until they near the screen',not requests(page,LIST_ANIME,'NOT_YET_RELEASED') and not requests(page,LIST_ANIME,'"MOVIE"')
              and page.locator('[data-discover-block="movies"] .ps-loading[aria-busy=true]').count()==1)
        scroll_through(page)
        check('Genre-aware rows first (right under the chips), then aired, missed, coming soon and movies',
              page.evaluate(BLOCKS)==['trending','season','last-season','recent','missed','upcoming','movies'])
        check('Row titles name the seasons',page.evaluate(HEADS)==['Trending now',f'Top of {SEASON_EN[CUR[0]]} {CUR[1]}',f'Best of {SEASON_EN[PREV[0]]} {PREV[1]}',
              'Aired recently','You might have missed','Coming soon','Trending movies'])
        check('Trending: the titles after the spotlight, none twice; list status in the accent (AniList list and library), else season and year',
              page.evaluate(cards('trending'))==ROW and not set(ROW)&set(SPOT)
              and page.locator(card('trending',108,'.ps-card-meta[data-tone=accent]')).text_content()=='Planning'
              and page.locator(card('trending',110,'.ps-card-meta[data-tone=accent]')).text_content()=='Completed'
              and page.locator(card('trending',112,'.ps-card-meta')).text_content()==f'{SEASON_EN[CUR[0]]} {CUR[1]}'
              and page.locator(card('trending',112,'.ps-card-meta[data-tone]')).count()==0)
        check('Cover marks: in the library, new episodes (theme setting), airing or upcoming; nothing for finished titles',
              page.locator(card('trending',110,'.ps-badge')).text_content()=='In library' and page.locator(card('trending',109,'.ps-badge')).text_content()=='3 new'
              and page.locator(card('trending',101,'.ps-tag')).text_content()=='Upcoming' and page.locator(card('trending',113,'.ps-tag')).text_content()=='Releasing'
              and page.locator(card('trending',111,'.ps-tag')).count()==0 and page.locator(card('trending',112,'.ps-badge')).count()==0
              and page.locator('[data-discover-block="upcoming"] .ps-tag').count()==0)
        check('List entries keep their list data for plugins and warm their page',json.loads(page.locator(card('trending',108)).get_attribute('data-list-data'))['status']=='PLANNING'
              and page.locator('[data-phone-card="108"][data-warm]').count()>=1 and page.locator('[data-phone-card="112"][data-warm]').count()==0)
        check('Cards carry the MediaEntryCard hooks DOM plugins use (card body, link, MAL id); spotlight and schedule rows the ids',
              page.locator(card('trending',112)).get_attribute('data-media-entry-card-body')=='true'
              and page.locator(card('trending',112)).get_attribute('data-media-entry-card-body-link')=='true'
              and page.locator(card('trending',112)).get_attribute('data-media-mal-id')=='9112'
              and page.locator('[data-discover-feature="102"]').get_attribute('data-media-entry-card-body')=='true'
              and page.locator('[data-discover-feature="102"]').get_attribute('data-media-mal-id')=='9102')
        page.evaluate(DUB_PLUGIN+'([110,112,102])');page.wait_for_timeout(200)
        dub=page.evaluate(DUB_PLACE+'(\'[data-discover-block="trending"] [data-phone-card="110"]\')')
        dub_feature=page.evaluate(DUB_PLACE+'(\'[data-discover-feature="102"]\')')
        check('The dub badge plugin decorates phone cards: a quiet "Dub" pill top left on the cover, clear of the accent badge, taps go to the card',
              dub and 0<=dub['left']<=12 and 0<=dub['top']<=12 and dub['inside'] and dub['clearOfBadge'] and dub['label']=='"Dub"' and dub['tapsCard']
              and dub_feature and dub_feature['left']<=16 and dub_feature['top']<=16 and dub_feature['tapsCard']
              and page.locator('.seanime-dub-badge-wrapper').count()==3)
        hooks=page.evaluate('''({root:!!document.querySelector("[data-discover-phone][data-discover-page-container]"),
            tabs:!!document.querySelector("[data-discover-tabs][data-discover-page-header-tabs-container]"),
            panel:!!document.querySelector(".pd-panel[data-discover-page-anime-container]"),
            trending:!!document.querySelector('[data-discover-block="trending"][data-discover-page-anime-trending-container]'),
            rated:[...document.querySelectorAll("[data-discover-page-anime-highest-rated-container]")].map(e=>e.dataset.discoverBlock),
            upcoming:!!document.querySelector('[data-discover-block="upcoming"][data-discover-page-anime-upcoming-container]'),
            movies:!!document.querySelector('[data-discover-block="movies"][data-discover-page-anime-trending-movies-container]'),
            missed:!!document.querySelector('[data-discover-block="missed"][data-discover-missed-sequels-container]'),
            header:document.querySelector("[data-discover-spotlight][data-discover-page-header]")?.dataset.mediaId==="102"
                &&document.querySelector("[data-discover-page-header]").dataset.mediaMalId==="9102"})''')
        check('The desktop page\'s data-discover-page-* hooks sit on their phone counterparts (custom CSS, DOM plugins)',
              all(v for k,v in hooks.items() if k!='rated') and hooks['rated']==['season','last-season'])
        check('Aired recently: one card per show, newest first, filtered like the desktop row',page.evaluate(cards('recent'))==[213,211,212])
        check('Aired recently: episode marks and how long ago, only the list status in the accent; the card names every part',
              page.evaluate(card_text('recent','.ps-tag'))==['Ep 4','Ep 2/11','Movie']
              and page.evaluate(card_text('recent','.ps-card-meta'))==['Watching · 30m ago','17h ago','3d ago']
              and page.locator(card('recent',213,'.ps-card-meta .pd-status')).text_content()=='Watching'
              and page.locator('[data-discover-block="recent"] .ps-card-meta[data-tone]').count()==0
              and page.locator(card('recent',213)).get_attribute('aria-label')=='Mofusand, Ep 4, Watching, 30m ago')
        check('Top of the season sorts by score and shows the score instead of repeating the season',page.evaluate(cards('season'))==[152,153,151,154]
              and page.evaluate(card_text('season','.ps-card-meta'))==['90%','80%','70%'])
        check('Missed sequels: a note on what they are, no See all',page.evaluate(cards('missed'))==[191,192,193]
              and page.locator('[data-discover-block="missed"] .ps-section-note').count()==1 and page.locator('[data-discover-see-all="missed"]').count()==0)
        check('Coming soon and movies load once near',page.evaluate(cards('upcoming'))==[171,172,173] and page.evaluate(cards('movies'))==[181,182,183])
        see_all=page.evaluate('Object.fromEntries([...document.querySelectorAll("[data-discover-see-all]")].map(e=>[e.dataset.discoverSeeAll,e.getAttribute("href")]))')
        check('"See all" opens Search with the row\'s query; aired recently has none (the calendar shows other data)',see_all=={'trending':'/search?sorting=TRENDING_DESC',
              'season':f'/search?sorting=SCORE_DESC&season={CUR[0]}&year={CUR[1]}','last-season':f'/search?sorting=SCORE_DESC&season={PREV[0]}&year={PREV[1]}',
              'upcoming':'/search?sorting=TRENDING_DESC&status=NOT_YET_RELEASED','movies':'/search?sorting=TRENDING_DESC&format=MOVIE'})
        check('"See all" names its row for screen readers',page.locator('[data-discover-see-all="trending"]').get_attribute('aria-label')=='See all: Trending now')
        check('Queries: the desktop variables',requests(page,LIST_ANIME,'TRENDING_DESC')[0]=={'page':1,'perPage':20,'sort':['TRENDING_DESC']}
              and requests(page,LIST_ANIME,'SCORE_DESC')[0]=={'page':1,'perPage':20,'sort':['SCORE_DESC'],'season':CUR[0],'seasonYear':CUR[1]}
              and requests(page,LIST_ANIME,'SCORE_DESC')[1]=={'page':1,'perPage':20,'sort':['SCORE_DESC'],'season':PREV[0],'seasonYear':PREV[1]}
              and requests(page,LIST_ANIME,'MOVIE')[0]=={'page':1,'perPage':20,'format':'MOVIE','sort':['TRENDING_DESC'],'status':['RELEASING','FINISHED']})
        recent=requests(page,RECENT_API)
        now_s=page.evaluate('Date.now()/1000')
        check('Aired recently asks for the last 14 days, rounded to five minutes',len(recent)==1 and set(recent[0])=={'page','perPage','airingAt_greater','airingAt_lesser'}
              and recent[0]['airingAt_lesser']%300==0 and 0<=now_s-recent[0]['airingAt_lesser']<300+60 and recent[0]['airingAt_greater']==recent[0]['airingAt_lesser']-14*86400)
        check('No phone card uses the classes or attribute the native Discover patch rewrites',
              page.evaluate('document.querySelectorAll("[data-discover-section],[class*=\\"basis-[2\\"]").length')==0)
        check('Every button and link is at least 48px',page.evaluate(SMALL,'[data-discover-phone] button,[data-discover-phone] a')==[])
        check('390px: no page overflow',page.evaluate(NO_OVERFLOW))
        shot(page,'discover-anime-390.png')

        # Cards and menus
        page.locator(card('trending',110)).click()
        check('A cover opens its entry page',page.evaluate('routes').pop()==['push','/entry?id=110'])
        go_back(page)
        page.locator('[data-discover-feature="102"]').click()
        check('A spotlight card opens its entry page',page.evaluate('routes').pop()==['push','/entry?id=102'])
        go_back(page)
        long_press(page,card('trending',108))
        check('Long press on a cover: Preview and the plugin card actions',page.locator('[data-plugin-card-items="anime"]').count()==1
              and page.evaluate(SMALL,'[role=menuitem]')==[])
        shot(page,'discover-menu-390.png')
        check('Back closes the card menu',back(page) and page.get_by_role('menuitem').count()==0)
        long_press(page,card('trending',108));page.get_by_role('menuitem',name='Preview').click()
        check('Preview opens for that anime',page.evaluate('previews').pop()==[108,'anime'])
        long_press(page,'[data-discover-feature="105"]');page.get_by_role('menuitem',name='Preview').click()
        check('Long press on a spotlight card opens the same menu',page.evaluate('previews').pop()==[105,'anime'])
        page.wait_for_timeout(300)
        check('Back with nothing open is left to the app (leaves the page)',back(page) is False)

        # One genre for the genre-aware rows
        ROW_SCROLL='document.querySelector(\'[data-discover-block="trending"] .ps-row\').scrollLeft'
        scrolled=page.evaluate(ROW_SCROLL)
        page.evaluate('latency=900');page.locator('[data-discover-genres] [data-chip="Action"]').click();page.wait_for_timeout(150)
        check('While a genre loads, the last covers stay dimmed',page.locator('[data-discover-block="trending"] .ps-row.pd-stale[aria-busy=true]').count()==1
              and page.locator('[data-discover-spotlight][aria-busy=true]').count()==1)
        check('A new genre starts the row at its first cover (the row kept its place across the entry page before)',scrolled>0 and page.evaluate(ROW_SCROLL)==0)
        page.wait_for_timeout(1300);page.evaluate('latency=60')
        # The page came back from entry pages above: lazy rows load the genre once they are near again.
        scroll_through(page)
        check('Genre filters the spotlight, trending and both season rows; the rest stays',page.evaluate(cards('trending'))==[101,103,115,117,119]
              and page.evaluate(FEATURES)==[105,107,109,111,113]
              and requests(page,LIST_ANIME,'"genres":["Action"]')!=[] and len(requests(page,LIST_ANIME,'"SCORE_DESC"],"season"'))>=2
              and len([r for r in requests(page,LIST_ANIME,'SCORE_DESC') if r.get('genres')==['Action']])==2
              and page.evaluate(cards('recent'))==[213,211,212] and page.locator('[data-discover-block="trending"] .pd-stale').count()==0)
        check('The genre shows next to filtered titles and goes into "See all"',page.locator('[data-discover-block="trending"] h2 span').inner_text()=='Action'
              and page.locator('[data-discover-block="season"] h2 span').inner_text()=='Action' and page.locator('[data-discover-block="recent"] h2 span').count()==0
              and page.locator('[data-discover-see-all="trending"]').get_attribute('href')=='/search?sorting=TRENDING_DESC&genre=Action'
              and page.locator('[data-discover-see-all="season"]').get_attribute('href')==f'/search?sorting=SCORE_DESC&season={CUR[0]}&year={CUR[1]}&genre=Action')
        asked=len(requests(page,RECENT_API));page.wait_for_timeout(1500)
        check('No refetch loop: aired recently asks nothing more while the page sits, always for a window rounded to five minutes',
              len(requests(page,RECENT_API))==asked and all(r['airingAt_lesser']%300==0 for r in requests(page,RECENT_API)))
        shot(page,'discover-anime-genre-390.png')
        page.locator('[data-discover-genres] [data-chip="Action"]').click();page.wait_for_timeout(400)
        check('Tapping the chosen genre again goes back to All',page.locator('[data-discover-genres] [data-chip="all"][aria-pressed=true]').count()==1
              and page.evaluate(cards('trending'))==ROW)
        page.locator('[data-discover-genres] [data-chip="Horror"]').click();page.wait_for_timeout(500)
        check('A genre without titles: what is missing and "All genres" in each genre row, no spotlight',
              page.locator('[data-discover-block="trending"] [data-discover-row-empty] p').first.inner_text()=='Nothing in this genre here'
              and page.locator('[data-discover-block="trending"] [data-discover-all-genres]').inner_text()=='All genres'
              and page.locator('[data-discover-block="season"] [data-discover-all-genres]').count()==1 and page.locator('[data-discover-spotlight]').count()==0)
        shot(page,'discover-anime-genre-empty-390.png')
        page.evaluate('latency=900');page.locator('[data-discover-genres] [data-chip="Romance"]').click();page.wait_for_timeout(200)
        check('After an empty genre, the next genre shows bones while it loads, not the empty state',
              page.locator('[data-discover-block="trending"] .ps-loading[aria-busy=true]').count()==1
              and page.locator('[data-discover-block="trending"] [data-discover-row-empty]').count()==0
              and page.locator('.pd-panel > .ps-loading .ps-bone[data-kind=feature]').count()==1)
        page.wait_for_timeout(1200);page.evaluate('latency=60')
        page.evaluate('failWhen=[\'"genres":["Mecha"]\']');page.locator('[data-discover-genres] [data-chip="Mecha"]').click();page.wait_for_timeout(500)
        check('A failing row says so and offers to try again',page.locator('[data-discover-block="trending"] [data-discover-row-error] p').inner_text()=="Couldn't load this row."
              and page.locator('[data-discover-block="trending"] [data-discover-row-error] button').inner_text()=='Try again')
        check('A failing genre leaves no spotlight of the genre before (Romance) behind, and nothing stays busy',page.locator('[data-discover-spotlight]').count()==0
              and page.locator('[data-discover-phone] [aria-busy=true]:not(.ps-loading)').count()==0)
        shot(page,'discover-anime-row-error-390.png')
        asked=len(requests(page,LIST_ANIME,'"sort":["TRENDING_DESC"],"genres":["Mecha"]'));page.evaluate('failWhen=[]')
        page.locator('[data-discover-block="trending"] [data-discover-row-error] button').click();page.wait_for_timeout(500)
        check('Try again asks again and the row recovers',len(requests(page,LIST_ANIME,'"sort":["TRENDING_DESC"],"genres":["Mecha"]'))==asked+1
              and page.locator('[data-discover-block="trending"] [data-discover-row-error]').count()==0)
        page.locator('[data-discover-genres] [data-chip="Horror"]').click();page.wait_for_timeout(500)
        page.locator('[data-discover-block="trending"] [data-discover-all-genres]').click();page.wait_for_timeout(500)
        check('"All genres" in an empty row goes back to All',page.locator('[data-discover-genres] [data-chip="all"][aria-pressed=true]').count()==1
              and page.evaluate(cards('trending'))==ROW)
        # Offline: React Query holds requests until the connection is back
        page.context.set_offline(True);page.wait_for_timeout(200)
        page.locator('[data-discover-genres] [data-chip="Comedy"]').click();page.wait_for_timeout(600)
        check('Offline: a row that cannot load says why and that it loads by itself, without Try again; no stale spotlight',
              page.locator('[data-discover-block="trending"] [data-discover-row-offline] p').inner_text()=="No internet connection. This row loads when you're back online."
              and page.locator('[data-discover-block="trending"] [data-discover-row-offline] button').count()==0
              and page.locator('[data-discover-spotlight]').count()==0 and page.locator('[data-discover-block="trending"] .ps-loading').count()==0)
        shot(page,'discover-anime-offline-390.png')
        page.context.set_offline(False);page.wait_for_timeout(800)
        check('Back online, the row loads',page.locator('[data-discover-block="trending"] [data-discover-row-offline]').count()==0
              and page.evaluate(cards('trending'))==[112,114,116,118,120] and page.evaluate(FEATURES)==[102,104,106,108,110])
        page.locator('[data-discover-genres] [data-chip="all"]').click();page.wait_for_timeout(400)

        # Back from an entry page: the page, the rows and the opened card where they were
        page.evaluate('document.querySelector(\'[data-discover-block="movies"]\').scrollIntoView({block:"center"})');page.wait_for_timeout(300)
        page.evaluate('document.querySelector(\'[data-discover-block="movies"] .ps-row\').scrollLeft=120');page.wait_for_timeout(300)
        before=page.evaluate('''({y:scrollY,row:document.querySelector('[data-discover-block="movies"] .ps-row').scrollLeft,
            chips:document.querySelector("[data-discover-genres]").scrollLeft,top:document.querySelector('[data-discover-block="movies"] [data-phone-card="182"]').getBoundingClientRect().top})''')
        page.locator(card('movies',182)).click()
        check('The opened card leaves Discover (the page unmounts as in the app)',page.evaluate('routes').pop()==['push','/entry?id=182']
              and page.locator('[data-discover-phone]').count()==0 and page.evaluate('scrollY')==0)
        go_back(page,900)
        after=page.evaluate('''({y:scrollY,row:document.querySelector('[data-discover-block="movies"] .ps-row').scrollLeft,
            top:document.querySelector('[data-discover-block="movies"] [data-phone-card="182"]').getBoundingClientRect().top,
            focus:document.activeElement?.getAttribute("data-phone-card")})''')
        # The card is the anchor: covers above that have not painted again yet are shorter (content-visibility), so scrollY
        # may differ a little while the card sits exactly where it was.
        check('Back from an entry: the opened card in its old place on screen and focused, its row at its old scroll position',before['y']>800 and before['row']>0
              and abs(after['top']-before['top'])<=2 and abs(after['y']-before['y'])<=150 and after['row']==before['row'] and after['focus']=='182')
        page.locator(card('movies',183)).click();page.evaluate('queryClient.clear()');go_back(page,2000)
        after=page.evaluate('''({top:document.querySelector('[data-discover-block="movies"] [data-phone-card="183"]')?.getBoundingClientRect().top,
            focus:document.activeElement?.getAttribute("data-phone-card")})''')
        check('Back after the cache is gone: the rows load again near the old position and the card comes back to its place',
              after['focus']=='183' and after['top'] is not None and 0<=after['top']<=page.evaluate('innerHeight'))
        page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(200)

        # Schedule tab
        tab(page,'Schedule');page.locator('[data-discover-block="schedule-day"]').first.wait_for()
        check('Schedule tab: chosen, the URL follows without a new history entry and without the router scrolling to the top',
              page.locator('[data-tab-name="Schedule"][aria-selected=true]').count()==1 and page.evaluate('routes').pop()==['replace','/discover?type=schedule']
              and page.evaluate('navigations').pop()=={'to':'/discover','search':{'type':'schedule'},'replace':True,'resetScroll':False})
        check('Facts: episodes in the next two weeks',page.locator('[data-phone-facts]').inner_text()=='5 episodes in the next 2 weeks')
        check('Days: later today, tomorrow, then weekday and date; empty days left out',page.evaluate(HEADS)==[day_title(0),day_title(1),day_title(2),day_title(3)]
              and page.evaluate(TEXT,'[data-discover-block="schedule-day"] h2 span')==['2','1','1','1'])
        check('Today is marked; the calendar is one entry in the header, not again on the first day',page.locator('[data-discover-block="schedule-day"][data-today]').count()==1
              and page.locator('[data-discover-calendar-link]').count()==0 and page.locator('[data-discover-calendar]').get_attribute('href')=='/schedule')
        check('Rows by time; adult, non-Japanese, shorts, non-anime, repeated and out-of-range episodes left out',
              page.evaluate('[...document.querySelectorAll("[data-discover-schedule-row]")].map(e=>+e.dataset.discoverScheduleRow)')==[302,301,303,304,321])
        check('Row: the schedule\'s own episode, the list status, the time, the MAL id',page.locator('[data-discover-schedule-row="301"] .ps-list-meta').inner_text()=='Episode 5 · Watching'
              and page.locator('[data-discover-schedule-row="301"] .ps-list-side').inner_text()=='11:30 PM'
              and page.locator('[data-discover-schedule-row="302"] .ps-list-side').inner_text()=='6:00 PM'
              and page.locator('[data-discover-schedule-row="301"]').get_attribute('href')=='/entry?id=311'
              and page.locator('[data-discover-schedule-row="301"]').get_attribute('data-media-mal-id')=='9311')
        midnight=page.evaluate('new Date(new Date().setHours(0,0,0,0)).getTime()/1000')
        two_weeks=page.evaluate('(d=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+14).getTime()/1000)(new Date())')
        check('Schedule asks page by page from today 00:00 for 14 days, not yet aired, by time, and stops once the two weeks are in',
              [r for r in requests(page,RECENT_API,'notYetAired')]==[{'page':p,'perPage':50,'airingAt_greater':midnight,'airingAt_lesser':two_weeks,'notYetAired':True,'sort':['TIME']} for p in (1,2)])
        check('Schedule keeps the desktop hooks',page.locator('.pd-panel[data-discover-page-schedule-container] [data-discover-airing-schedule-container]').count()==1)
        check('Header keeps search and calendar on the schedule',page.locator('[data-discover-search]').count()==1 and page.locator('[data-discover-calendar]').count()==1)
        check('Schedule buttons and links are at least 48px',page.evaluate(SMALL,'[data-discover-phone] button,[data-discover-phone] a')==[])
        check('Schedule at 390px: no page overflow',page.evaluate(NO_OVERFLOW))
        shot(page,'discover-schedule-390.png')
        page.locator('[data-discover-schedule-row="302"]').click()
        check('A schedule row opens the entry page',page.evaluate('routes').pop()==['push','/entry?id=312'])
        go_back(page)
        check('Back from an entry returns to the schedule tab',page.locator('[data-tab-name="Schedule"][aria-selected=true]').count()==1
              and page.evaluate('document.activeElement?.getAttribute("data-discover-schedule-row")')=='302')
        long_press(page,'[data-discover-schedule-row="303"]');page.get_by_role('menuitem',name='Preview').click()
        check('Long press on a schedule row: Preview',page.evaluate('previews').pop()==[313,'anime'])
        page.wait_for_timeout(300)

        # Manga tab
        tab(page,'Manga');page.locator('[data-discover-block="manga-jp"] [data-phone-card]').first.wait_for()
        check('Manga tab: chosen, URL follows, facts',page.locator('[data-tab-name="Manga"][aria-selected=true]').count()==1
              and page.evaluate('routes').pop()==['replace','/discover?type=manga'] and page.locator('[data-phone-facts]').inner_text()=='Trending manga, manhwa and manhua')
        check('Manga header: search manga, no calendar',page.locator('[data-discover-search]').get_attribute('href')=='/search?type=manga'
              and page.locator('[data-discover-search]').get_attribute('aria-label')=='Search manga' and page.locator('[data-discover-calendar]').count()==0)
        check('Manga spotlight: the first five trending manga, announced ones too (as the desktop hero), manga entry links, no "Manga" in the meta',
              page.evaluate('[...document.querySelectorAll("[data-discover-feature]")].map(e=>e.getAttribute("href"))')==[f'/manga/entry?id={i}' for i in range(501,506)]
              and page.locator('[data-discover-feature="501"] .ps-feature-meta').inner_text()=='2016 · 81%')
        scroll_through(page)
        check('Manga rows: Japan (after the spotlight), Korea, China',page.evaluate(BLOCKS)==['manga-jp','manga-kr','manga-cn']
              and page.evaluate(HEADS)==['Trending manga','Trending manhwa','Trending manhua'] and page.evaluate(cards('manga-jp'))==[506,507,508]
              and page.evaluate(cards('manga-kr'))==[601,602,603,604])
        check('Manga cards: start year, or the list status in the accent',page.locator(card('manga-jp',506,'.ps-card-meta')).text_content()=='2021'
              and page.locator(card('manga-jp',507,'.ps-card-meta[data-tone=accent]')).text_content()=='Reading'
              and page.locator(card('manga-jp',507)).get_attribute('href')=='/manga/entry?id=507')
        check('Manga keeps the desktop hooks',page.locator('.pd-panel[data-discover-page-manga-container]').count()==1
              and page.evaluate('["","-manhwa","-manhua"].map(s=>!!document.querySelector(`[data-discover-page-manga-trending${s}-container]`))')==[True,True,True])
        check('Manga queries: the desktop variables per country',requests(page,MANGA_API,'"JP"')[0]=={'page':1,'perPage':20,'sort':['TRENDING_DESC'],'countryOfOrigin':'JP'}
              and requests(page,MANGA_API,'"CN"')!=[])
        page.locator('[data-discover-genres] [data-chip="Romance"]').click();page.wait_for_timeout(500)
        check('One genre for all three manga rows, into "See all" too',all(requests(page,MANGA_API,f'"countryOfOrigin":"{c}","genres":["Romance"]') for c in ('JP','KR','CN'))
              and page.locator('[data-discover-see-all="manga-kr"]').get_attribute('href')=='/search?type=manga&sorting=TRENDING_DESC&country=KR&genre=Romance')
        page.locator('[data-discover-genres] [data-chip="all"]').click();page.wait_for_timeout(400)
        check('Manga "See all" opens manga search by country',page.locator('[data-discover-see-all="manga-jp"]').get_attribute('href')=='/search?type=manga&sorting=TRENDING_DESC&country=JP')
        long_press(page,card('manga-jp',506))
        check('Long press on a manga cover: the manga plugin actions',page.locator('[data-plugin-card-items="manga"]').count()==1)
        page.get_by_role('menuitem',name='Preview').click()
        check('Preview opens for that manga',page.evaluate('previews').pop()==[506,'manga'])
        check('Manga buttons and links are at least 48px',page.evaluate(SMALL,'[data-discover-phone] button,[data-discover-phone] a')==[])
        check('Manga at 390px: no page overflow',page.evaluate(NO_OVERFLOW))
        shot(page,'discover-manga-390.png')
        page.evaluate('window.scrollTo(0,150)');page.wait_for_timeout(200)
        page.locator('[data-discover-tabs] [data-tab-name="Anime"]').dispatch_event('click');page.wait_for_timeout(500)
        check('A tab switch keeps the page where it is (no scroll to the top)',page.locator('[data-tab-name="Anime"][aria-selected=true]').count()==1
              and page.evaluate('scrollY')==150 and page.evaluate('navigations').pop()['resetScroll'] is False)
        tab(page,'Manga');page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(200)

        # Large text and narrow screens
        page.set_viewport_size(dict(width=320,height=720));page.evaluate('document.documentElement.style.fontSize="200%"');page.wait_for_timeout(300)
        check('Manga at 320px with 200% text: no page overflow',page.evaluate(NO_OVERFLOW))
        shot(page,'discover-manga-320-200.png')
        tab(page,'Schedule')
        page.evaluate(PAINT_ALL);cut=page.evaluate(CUT);page.evaluate(UNPAINT)
        check('Schedule at 320px with 200% text: no page overflow, titles wrap under the cover and are not cut',page.evaluate(NO_OVERFLOW)
              and page.evaluate(ROW_TEXT_WIDE) and cut['schedule']==[])
        shot(page,'discover-schedule-320-200.png')
        tab(page,'Anime');scroll_through(page)
        page.evaluate(PAINT_ALL);cut=page.evaluate(CUT);widths=page.evaluate('[...document.querySelectorAll("[data-discover-block] .ps-row > .ps-card")].map(e=>e.getBoundingClientRect().width)');page.evaluate(UNPAINT)
        check('Anime at 320px with 200% text: no page overflow, tab labels inside their tabs',page.evaluate(NO_OVERFLOW)
              and page.evaluate('[...document.querySelectorAll("[data-discover-tabs] [role=tab]")].every(b=>b.scrollWidth<=b.clientWidth+1)'))
        check('Large text: covers widen with the text; short titles, marks and spotlight titles are not cut, no word broken',
              min(widths)>=1.5*115 and cut['cards']==[] and cut['words']==[] and cut['tags']==[] and cut['features']==[])
        check('Large text: a "See all" that wraps under its heading stays at the end of the line',page.evaluate('''(rem=>[...document.querySelectorAll("[data-discover-see-all]")]
              .every(a=>Math.abs(a.getBoundingClientRect().right-a.closest(".ps-section-head").getBoundingClientRect().right-rem/2)<=1))(parseFloat(getComputedStyle(document.documentElement).fontSize))'''))
        check('Large text: every button and link still at least 48px',page.evaluate(SMALL,'[data-discover-phone] button,[data-discover-phone] a')==[])
        shot(page,'discover-anime-320-200.png')
        page.close()

        # The segment with every text size: three side by side or one per line, never two plus one
        seg=open_page(language='de')
        rows={}
        for width in (320,360,390,430):
            for size in ('100%','115%','130%','150%','200%'):
                seg.set_viewport_size(dict(width=width,height=800));seg.evaluate(f'document.documentElement.style.fontSize="{size}"');seg.wait_for_timeout(60)
                r=seg.evaluate(SEGMENT);rows[f'{width}/{size}']=r['rows'] if r['fit'] else -1
        check('Segment (German, the longest labels): three tabs side by side or one per line at every width and text size, never two plus one; all labels fit',
              all(v in (1,3) for v in rows.values()) and all(rows[f'{w}/100%']==1 for w in (320,360,390,430)) and rows['390/115%']==1 and rows['320/200%']==3)
        seg.close()

        # URL parameters
        p=open_page(query='?type=manga',ready='[data-discover-block="manga-jp"]')
        check('?type=manga opens on Manga without loading the anime rows first',p.locator('[data-tab-name="Manga"][aria-selected=true]').count()==1
              and requests(p,LIST_ANIME)==[] and requests(p,RECENT_API)==[])
        tab(p,'Anime');p.locator('[data-discover-block="trending"] [data-phone-card]').first.wait_for()
        p.locator(card('trending',112)).click();go_back(p)
        check('Returning from an entry restores the tab chosen after ?type=manga',p.evaluate('location.search')=='?type=anime'
              and p.locator('[data-tab-name="Anime"][aria-selected=true]').count()==1)
        p.close()
        p=open_page(query='?type=schedule',ready='[data-discover-block="schedule-day"]')
        check('?type=schedule opens the schedule',p.locator('[data-tab-name="Schedule"][aria-selected=true]').count()==1)
        p.close()
        no_blur=copy.deepcopy(STATE);no_blur['serverStatus']['settings']['anilist']['blurAdultContent']=False
        p=open_page(state=no_blur,ready='[data-discover-feature]')
        check('Without adult blur, adult titles are featured and nothing is veiled',p.evaluate(FEATURES)==[102,103,104,105,106]
              and p.locator('[data-adult-veil]').count()==0)
        p.close()
        no_manga=copy.deepcopy(STATE);no_manga['serverStatus']['settings']['library']['enableManga']=False
        p=open_page(query='?type=manga',state=no_manga,ready='[data-discover-block="trending"]')
        check('?type=manga with manga turned off shows Anime and no Manga tab',p.locator('[data-tab-name="Anime"][aria-selected=true]').count()==1
              and p.evaluate(TEXT,'[data-discover-tabs] [role=tab]')==['Anime','Schedule'] and requests(p,MANGA_API)==[]
              and p.evaluate(SEGMENT)=={'rows':1,'fit':True})
        p.close()

        # States
        p=open_page(script='hangWhen=["/api/"]')
        check('Loading: header, tabs and genres stay; the spotlight and rows show bones; missed sequels show nothing until they are known',
              p.locator('h1').inner_text()=='Discover' and p.locator('[data-discover-tabs]').count()==1 and p.locator('[data-discover-genres]').count()==1
              and p.locator('.ps-loading[aria-busy=true] .ps-bone[data-kind=feature]').count()==1
              and p.locator('[data-discover-block="trending"] .ps-loading[aria-busy=true]').count()==1
              and p.locator('[data-discover-block="recent"] .ps-loading[aria-busy=true]').count()==1
              and p.locator('[data-discover-block="missed"]').count()==0)
        shot(p,'discover-loading-390.png')
        tab(p,'Schedule')
        check('Loading the schedule: row bones and a facts line that says so',p.locator('.pd-panel .ps-loading[aria-busy=true] .ps-bone[data-kind=row]').count()==5
              and p.locator('[data-phone-facts]').inner_text()=='Loading the schedule…')
        p.close()
        p=open_page(script='failWhen=["/api/"]',ready='[data-discover-tab-error]')
        scroll_through(p)
        check('Errors: with the first screen\'s rows failing, one notice for the tab with Try again and the downloads, not a wall of row notices',
              p.locator('[data-discover-tab-error] p').inner_text()=="Discover couldn't be loaded."
              and p.evaluate(TEXT,'[data-discover-tab-error] .ps-text-action')==['Try again','Watch downloads']
              and p.locator('[data-discover-tab-error] a').get_attribute('href')=='/android-downloads?kind=anime'
              and p.locator('[data-discover-row-error]').count()==0 and p.locator('[data-discover-genres]').count()==0)
        shot(p,'discover-error-390.png')
        asked=(len(requests(p,LIST_ANIME,'TRENDING_DESC')),len(requests(p,RECENT_API)))
        p.evaluate('failWhen=[]');p.locator('[data-discover-tab-error] button').click();p.locator('[data-discover-block="trending"] [data-phone-card]').first.wait_for()
        check('Try again asks the first screen\'s rows again and the tab comes back',(len(requests(p,LIST_ANIME,'TRENDING_DESC')),len(requests(p,RECENT_API)))==(asked[0]+1,asked[1]+1)
              and p.locator('[data-discover-tab-error]').count()==0)
        p.evaluate('failWhen=["/api/"]');tab(p,'Schedule');p.locator('[data-discover-schedule-error]').wait_for()
        check('Schedule error: the reason, Try again and the calendar',p.locator('[data-phone-facts]').inner_text()=='Schedule not loaded'
              and p.evaluate(TEXT,'[data-discover-schedule-error] .ps-text-action')==['Try again','Open calendar'])
        asked=len(requests(p,RECENT_API,'notYetAired'));p.evaluate('failWhen=[]');p.locator('[data-discover-schedule-error] button').click()
        p.locator('[data-discover-block="schedule-day"]').first.wait_for();p.wait_for_timeout(500)
        check('Schedule Try again loads the pages again',len(requests(p,RECENT_API,'notYetAired'))==asked+2
              and p.locator('[data-phone-facts]').inner_text()=='5 episodes in the next 2 weeks')
        p.close()
        p=open_page(script=f'failWhen=["{MISSED_API}"]',ready='[data-discover-block="missed"] [data-discover-row-error]')
        check('One failing row: its own notice, the other rows stay',p.locator('[data-discover-row-error]').count()==1
              and p.locator('[data-discover-tab-error]').count()==0 and p.evaluate(cards('trending'))==ROW)
        asked=len(requests(p,MISSED_API));p.locator('[data-discover-block="missed"] [data-discover-row-error] button').click();p.wait_for_timeout(300)
        check('Try again on a failed row asks that row again',len(requests(p,MISSED_API))==asked+1)
        p.close()
        # A later schedule page fails: the complete days stay, with a notice for the rest
        paged=copy.deepcopy(FIXTURES)
        paged.update(scheduleMore=False,schedule=[SCHED1,[SCHED2[0],SCHED2[1],airing(322,media(332,'Late Show'),3,day=4,hour=9,minute=0)],
            [airing(323,media(333,'Next Week Show'),7,day=6,hour=15,minute=0),SCHED2[2]]])
        p=open_page(query='?type=schedule',fixtures=paged,script='failWhen=[\'"page":3,"perPage":50\']',ready='[data-discover-schedule-more-error]')
        check('A later schedule page fails: the complete days so far stay, the facts say how far, a notice offers Try again and the calendar',
              p.evaluate('[...document.querySelectorAll("[data-discover-schedule-row]")].map(e=>+e.dataset.discoverScheduleRow)')==[302,301,303,304,321]
              and p.locator('[data-phone-facts]').inner_text()=='5 episodes in the next 4 days'
              and p.locator('[data-discover-schedule-more-error] p').inner_text()=="The later days couldn't be loaded."
              and p.evaluate(TEXT,'[data-discover-schedule-more-error] .ps-text-action')==['Try again','Open calendar'])
        shot(p,'discover-schedule-partial-390.png')
        p.evaluate('failWhen=[]');p.locator('[data-discover-schedule-more-error] button').click();p.wait_for_timeout(600)
        check('Try again loads the missing page and the rest of the two weeks',
              p.evaluate('[...document.querySelectorAll("[data-discover-schedule-row]")].map(e=>+e.dataset.discoverScheduleRow)')==[302,301,303,304,321,322,323]
              and p.locator('[data-phone-facts]').inner_text()=='7 episodes in the next 2 weeks' and p.locator('[data-discover-schedule-more-error]').count()==0
              and [r['page'] for r in requests(p,RECENT_API,'notYetAired')]==[1,2,3,3])
        p.close()
        empty=copy.deepcopy(FIXTURES);empty.update(recent=[],missed=[],schedule=[[]],scheduleMore=False)
        p=open_page(fixtures=empty,ready='[data-discover-block="trending"] [data-phone-card]')
        scroll_through(p)
        check('Nothing aired and no missed sequels: both rows are hidden and leave no gap',p.evaluate(BLOCKS)==['trending','season','last-season','upcoming','movies']
              and p.evaluate('[...document.querySelectorAll(".pd-panel > *")].filter(e=>!e.children.length).every(e=>getComputedStyle(e).display==="none")'))
        tab(p,'Schedule');p.locator('[data-discover-schedule-empty]').wait_for()
        check('Empty schedule: what is missing and the way to the calendar; no facts line repeating it',
              p.locator('[data-discover-schedule-empty] p').first.inner_text()=='No episodes in the next two weeks'
              and p.locator('[data-discover-schedule-empty] a').get_attribute('href')=='/schedule' and p.locator('[data-phone-facts]').count()==0)
        shot(p,'discover-schedule-empty-390.png')
        p.close()
        nulls=copy.deepcopy(FIXTURES);nulls.update(missed=None)
        p=open_page(fixtures=nulls,ready='[data-discover-block="trending"] [data-phone-card]')
        scroll_through(p)
        check('A null answer for missed sequels (a plugin can make one) hides the row instead of breaking the page',
              p.locator('[data-discover-block="missed"]').count()==0 and p.evaluate(cards('movies'))==[181,182,183])
        p.close()

        # German
        de=open_page(language='de')
        scroll_through(de)
        check('German: title, facts, tabs, genres, the tabs\' label',de.locator('h1').inner_text()=='Entdecken'
              and de.locator('[data-phone-facts]').inner_text()==f'{SEASON_DE[CUR[0]]}-Saison {CUR[1]}'
              and de.evaluate(TEXT,'[data-discover-tabs] [role=tab]')==['Anime','Sendeplan','Manga']
              and de.evaluate(TEXT,'[data-discover-genres] button')[:4]==['Alle','Action','Abenteuer','Komödie']
              and de.locator('[data-discover-tabs]').get_attribute('aria-label')=='Was möchtest du entdecken?')
        check('German: row titles',de.evaluate(HEADS)==['Gerade angesagt',f'Bestbewertet im {SEASON_DE[CUR[0]]} {CUR[1]}',
              f'Bestbewertet im {SEASON_DE[PREV[0]]} {PREV[1]}','Kürzlich ausgestrahlt','Vielleicht verpasst','Demnächst','Angesagte Filme'])
        check('German: marks, times, list status, "See all" (not "Alle" as the chip), spotlight score',de.evaluate(card_text('recent','.ps-tag'))==['Folge 4','Folge 2/11','Film']
              and de.evaluate(card_text('recent','.ps-card-meta'))==['Schaue ich · vor 30 Min.','vor 17 Std.','vor 3 Tagen']
              and de.locator(card('trending',108,'.ps-card-meta')).text_content()=='Geplant'
              and de.locator(card('trending',110,'.ps-badge')).text_content()=='In Bibliothek' and de.locator(card('trending',109,'.ps-badge')).text_content()=='3 neu'
              and de.locator(card('trending',101,'.ps-tag')).text_content()=='Demnächst' and de.locator(card('trending',113,'.ps-tag')).text_content()=='Läuft'
              and de.locator('[data-discover-see-all="trending"]').inner_text()=='Alle anzeigen'
              and de.locator('[data-discover-see-all="trending"]').get_attribute('aria-label')=='Alle anzeigen: Gerade angesagt'
              and de.locator('[data-discover-feature="102"] .ps-feature-meta').inner_text().replace(NBSP,' ')==f'{SEASON_DE[CUR[0]]} {CUR[1]} · TV · 82 %'
              and de.evaluate(card_text('season','.ps-card-meta'))[0].replace(NBSP,' ')=='90 %')
        shot(de,'discover-anime-de-390.png')
        de.evaluate('failWhen=[\'"genres":["Mecha"]\']');de.locator('[data-discover-genres] [data-chip="Mecha"]').click();de.wait_for_timeout(500)
        check('German: a failing row',de.locator('[data-discover-block="trending"] [data-discover-row-error] p').inner_text()=='Diese Reihe konnte nicht geladen werden.'
              and de.locator('[data-discover-block="trending"] [data-discover-row-error] button').inner_text()=='Erneut versuchen')
        de.evaluate('failWhen=[]');de.locator('[data-discover-genres] [data-chip="Horror"]').click();de.wait_for_timeout(500)
        check('German: an empty genre',de.locator('[data-discover-block="trending"] [data-discover-row-empty] p').first.inner_text()=='In diesem Genre gibt es hier nichts'
              and de.locator('[data-discover-block="trending"] [data-discover-all-genres]').inner_text()=='Alle Genres')
        de.locator('[data-discover-genres] [data-chip="all"]').click();de.wait_for_timeout(400)
        tab(de,'Schedule');de.locator('[data-discover-block="schedule-day"]').first.wait_for()
        check('German: schedule days, facts, rows',de.evaluate(HEADS)==[day_title(o,True) for o in range(4)]
              and de.locator('[data-phone-facts]').inner_text()=='5 Folgen in den nächsten 2 Wochen'
              and de.locator('[data-discover-schedule-row="301"] .ps-list-meta').inner_text()=='Folge 5 · Schaue ich'
              and de.locator('[data-discover-schedule-row="302"] .ps-list-side').inner_text()=='18:00')
        shot(de,'discover-schedule-de-390.png')
        tab(de,'Manga');de.locator('[data-discover-block="manga-jp"] [data-phone-card]').first.wait_for();scroll_through(de)
        check('German: manga',de.evaluate(HEADS)==['Angesagte Manga','Angesagte Manhwa','Angesagte Manhua']
              and de.locator('[data-phone-facts]').inner_text()=='Angesagte Manga, Manhwa und Manhua'
              and de.locator(card('manga-jp',507,'.ps-card-meta')).text_content()=='Lese ich'
              and de.locator('[data-discover-search]').get_attribute('aria-label')=='Manga suchen')
        de.set_viewport_size(dict(width=320,height=720));de.evaluate('document.documentElement.style.fontSize="200%"');de.wait_for_timeout(300)
        tab(de,'Schedule')
        check('German at 320px with 200% text: no overflow, tab labels inside their tabs, rows not squeezed',de.evaluate(NO_OVERFLOW)
              and de.evaluate('[...document.querySelectorAll("[data-discover-tabs] [role=tab]")].every(b=>b.scrollWidth<=b.clientWidth+1)')
              and de.evaluate(ROW_TEXT_WIDE))
        shot(de,'discover-schedule-de-320-200.png')
        de.close()

        # Tablets keep the desktop page
        tb=open_page(width=800,height=1280,ready='[data-desktop-discover-header]')
        check('Tablet: the desktop page with its hero, tabs and rows',tb.locator('[data-discover-phone]').count()==0
              and tb.locator('[data-discover-page-container]').count()==1 and tb.locator('[data-discover-page-header-tabs-container]').count()==1
              and tb.locator('[data-desktop-discover-header]').count()==1 and tb.locator('[data-desktop-discover-row="trending"]').count()==1)
        shot(tb,'discover-tablet-800.png')
        tb.close()
        browser.close()
check('No script errors on any page',errors==[])
print(json.dumps(checks,indent=2))
