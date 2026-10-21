"""Stress of the Discover tab on Android phones with synthetic AniList answers (AniList itself is never asked): a 390x844
touch phone with a 4x slower CPU, 20 titles per row, big banner and cover pictures, two schedule pages of episodes over
14 days, missed sequels. Measures the first render, lazy rows while scrolling (frame times, long tasks), the spotlight
swipe, 15 genre taps 60 ms apart with answers out of order, 40 + 40 quick tab switches (JS heap, DOM nodes); checks
"See all" per row and genre, a failure storm (30 % of requests fail) and Try again afterwards, Android Back on the card
menus, overflow and 48px targets. The numbers come from React's production build; the correctness page runs the
development build, so React's warnings count as errors there. Reuses mobile_discover_bundle.cjs and its stubs.
Optional args: screenshot dir, random seed."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from urllib.parse import urlencode
from datetime import datetime
import tempfile, subprocess, json, sys, random, time
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
SEED=int(sys.argv[2]) if len(sys.argv)>2 else 7
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];warnings=[];metrics={}
def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok),**({} if detail is None else dict(detail=detail))))
    print(f'{"PASS" if ok else "FAIL"} {name}'+('' if ok or detail is None else f' :: {json.dumps(detail,default=str)[:900]}'),flush=True)
PAINT_ALL='document.head.insertAdjacentHTML("beforeend","<style id=paint-all>.ps-card{content-visibility:visible!important}</style>")'
UNPAINT='document.getElementById("paint-all")?.remove()'
def shot(page,name):
    if not shots: return
    page.evaluate(PAINT_ALL);page.wait_for_timeout(150);page.screenshot(path=str(shots/name),full_page=True);page.evaluate(UNPAINT)

HOST='http://discover.test'
NOW=datetime.now()
SEASONS=['WINTER','SPRING','SUMMER','FALL'];SEASON_EN={'WINTER':'Winter','SPRING':'Spring','SUMMER':'Summer','FALL':'Fall'}
_i=(NOW.month-1)//3
CUR=(SEASONS[_i],NOW.year);PREV=(SEASONS[_i-1],NOW.year-1 if _i==0 else NOW.year)
GENRES=['Action','Adventure','Comedy','Drama','Ecchi','Fantasy','Horror','Mahou Shoujo','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi',
    'Slice of Life','Sports','Supernatural','Thriller']
STATE=dict(serverStatus=dict(isOffline=False,user=dict(viewer=dict(name='stress')),themeSettings=dict(showAnimeUnwatchedCount=True),
        settings=dict(library=dict(enableManga=True),anilist=dict(blurAdultContent=True))),
    animeListData={'100005':dict(status='PLANNING',progress=0),'100006':dict(status='CURRENT',progress=2),'100009':dict(status='CURRENT',progress=5),
        '700001':dict(status='CURRENT',progress=1),'800003':dict(status='CURRENT',progress=4)},
    libraryCollection=dict(lists=[dict(type='COMPLETED',status='COMPLETED',entries=[dict(mediaId=100007,listData=dict(status='COMPLETED',progress=12),
        libraryData=dict(allFilesLocked=False,sharedPath='/anime/100007',unwatchedCount=0,mainFileCount=12))])]),
    mangaCollection=dict(lists=[dict(type='CURRENT',status='CURRENT',entries=[dict(mediaId=900006,listData=dict(status='CURRENT',progress=40))])]))

# The synthetic AniList. A title's id tells its row and genre: row * 100000 + genre index (0 = all genres) * 1000 + n, so
# the page shows which answer it rendered. Answers can be delayed (delay=[min,max] at random, delayFor={genre: ms}) and
# fail (failRate at random, failMatch substrings); answered[] records [request index, endpoint, genre, failed] in the order
# the answers came. Frame recorder (rAF deltas, long tasks), first-render marks and a per-frame genre watcher.
INIT='''(()=>{const spec=__SPEC__,G=spec.genres,HOST=spec.host;
let s=spec.seed>>>0;const rand=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296};
const now=Date.now(),sec=Math.floor(now/1000),d=new Date(now),S=["WINTER","SPRING","SUMMER","FALL"],cur={season:S[Math.floor(d.getMonth()/3)],year:d.getFullYear()};
const W=["Witch","Atelier","Midnight","Velvet","Apothecary","Dungeon","Summer","Orb","Blue","Box","Kaiju","Sakamoto","Frieren","Journey","Lazarus","Vigilantes","Kagurabachi"];
const name=(row,gi,n)=>{const w=i=>W[(row*7+gi*3+n+i)%W.length];
  return n%4===0?`${w(0)} ${w(1)}: The ${w(2)} of ${w(3)} and the ${w(4)} Season ${n%3+2}`:n%4===1?`${w(0)}${w(1)}${n}`:`${w(0)} ${w(1)} ${w(2)}`};
const media=(row,gi,n,extra)=>{const id=row*100000+gi*1000+n,title=name(row,gi,n);return Object.assign({id,idMal:5000000+id,title:{userPreferred:title,romaji:title},
  coverImage:{large:`${HOST}/cover/${id}.svg`,extraLarge:`${HOST}/cover/${id}.svg`,medium:`${HOST}/cover/${id}.svg`},bannerImage:n%4===3?null:`${HOST}/banner/${id}.svg`,
  status:n%3?"RELEASING":"FINISHED",format:"TV",season:cur.season,seasonYear:cur.year,meanScore:n%7?40+(id*13)%59:null,isAdult:false,countryOfOrigin:"JP",type:"ANIME",
  episodes:n%5?12+n:null,genres:gi?[G[gi-1]]:[G[n%G.length]],startDate:{year:2000+n},
  nextAiringEpisode:n%3?{episode:1+n%11,airingAt:sec+3600*(n+1),timeUntilAiring:3600*(n+1)}:null},extra||{})};
const row=(r,gi,extra)=>Array.from({length:20},(_,n)=>media(r,gi,n,extra&&extra(n)));
const page=m=>({Page:{pageInfo:{hasNextPage:true},media:m}});
// Aired recently: 20 shows, two episodes each, over the last 12 days
const recent=Array.from({length:40},(_,k)=>{const a=sec-(k*7+1)*3600;return {id:950000+k,episode:k<20?2:1,airingAt:a,timeUntilAiring:a-sec,media:media(7,0,k%20)}});
// Schedule: two full pages of 50 episodes, today 00:00 to 14 days later, by time; the second page is the last
const at=(day,h,m)=>Math.floor(new Date(d.getFullYear(),d.getMonth(),d.getDate()+day,h,m).getTime()/1000);
const schedule=[0,1].map(p=>Array.from({length:50},(_,i)=>{const k=p*50+i,a=at(Math.floor(k*14/100),(k*5)%24,(k*7)%60);
  return {id:960000+k,episode:1+k%24,airingAt:a,timeUntilAiring:a-sec,media:media(8,0,k,{nextAiringEpisode:null})}}).sort((a,b)=>a.airingAt-b.airingAt));
const LA="/api/v1/anilist/list-anime",RA="/api/v1/anilist/list-recent-anime",MS="/api/v1/anilist/list-missed-sequels",MA="/api/v1/manga/anilist/list";
const base=(endpoint,data)=>{const g=data&&data.genres&&data.genres[0],gi=g?G.indexOf(g)+1:0;
  if(endpoint===LA){if(data.status&&data.status[0]==="NOT_YET_RELEASED")return page(row(4,0,()=>({status:"NOT_YET_RELEASED",season:null,seasonYear:null,nextAiringEpisode:null})));
    if(data.format==="MOVIE")return page(row(5,0,()=>({format:"MOVIE",status:"FINISHED",episodes:1,nextAiringEpisode:null})));
    if(data.sort&&data.sort[0]==="SCORE_DESC"){const c=data.season===cur.season&&data.seasonYear===cur.year;
      return page(row(c?2:3,gi,()=>c?{}:{season:data.season,seasonYear:data.seasonYear}))}
    return page(row(1,gi))}
  if(endpoint===RA)return data.notYetAired?{Page:{pageInfo:{hasNextPage:data.page<2},airingSchedules:schedule[data.page-1]||[]}}
    :{Page:{pageInfo:{hasNextPage:false},airingSchedules:recent}};
  if(endpoint===MS)return row(6,0);
  if(endpoint===MA){const c=data.countryOfOrigin;return page(row({JP:9,KR:10,CN:11}[c],gi,n=>({type:"MANGA",format:n%6===5?"ONE_SHOT":"MANGA",
    countryOfOrigin:c,season:null,seasonYear:null,episodes:null,chapters:100+n,nextAiringEpisode:null})))}
  throw new Error("Unknown endpoint "+endpoint)};
Object.assign(window,spec.state,{requests:[],routes:[],navigations:[],previews:[],mutations:[],failWhen:[],hangWhen:[],latency:60,
  answered:[],delay:null,delayFor:{},failRate:0,failMatch:[]});
window.respond=(endpoint,data)=>{const g=data&&data.genres?data.genres[0]:null,probe=endpoint+" "+JSON.stringify(data);
  const index=data==null?-1:window.requests.findIndex(r=>r[1]===data);
  const ms=window.delayFor[g]!=null?window.delayFor[g]:window.delay?window.delay[0]+rand()*(window.delay[1]-window.delay[0]):0;
  const fail=window.failMatch.some(p=>probe.includes(p))||rand()<window.failRate;
  return new Promise(r=>setTimeout(r,ms)).then(()=>{window.answered.push([index,endpoint,g,fail]);if(fail)throw new Error("AniList error (synthetic)");return base(endpoint,data)})};
window.__rec=null;
const loop=t=>{const r=window.__rec;if(r){if(r.last!=null)r.frames.push(t-r.last);r.last=t}requestAnimationFrame(loop)};requestAnimationFrame(loop);
try{new PerformanceObserver(l=>{const r=window.__rec;if(r)for(const e of l.getEntries())r.long.push(e.duration)}).observe({type:"longtask"})}catch(e){}
window.__recStart=()=>{window.__rec={frames:[],long:[],last:null,t0:performance.now()}};
window.__recStop=()=>{const r=window.__rec;window.__rec=null;return {frames:r.frames,long:r.long,ms:performance.now()-r.t0}};
window.__mark=marks=>{const t0=performance.now(),out=window.__marks={};const tick=()=>{let pending=false;
  for(const [k,f] of marks){if(out[k]==null){if(new Function("return "+f)())out[k]=Math.round(performance.now()-t0);else pending=true}}
  if(pending&&performance.now()-t0<60000)requestAnimationFrame(tick)};requestAnimationFrame(tick)};
// Every frame: a row or spotlight that is not dimmed must show the chosen genre's titles, never a mix.
const gIndex=id=>Math.floor((id%100000)/1000);
window.__watchGenres=()=>{const w=window.__watch={violations:[],shown:[],frames:0};const add=v=>{if(w.violations.length<40)w.violations.push(v)};
  const tick=()=>{if(window.__watch!==w)return;w.frames++;
    const pressed=document.querySelector("[data-discover-genres] [aria-pressed=true]")?.dataset.chip,want=!pressed||pressed==="all"?0:G.indexOf(pressed)+1;
    const look=(label,el,cards,attr)=>{if(!el)return;const ids=[...new Set([...el.querySelectorAll(cards)].map(e=>gIndex(+e.getAttribute(attr))))];
      const busy=el.getAttribute("aria-busy")==="true";if(ids.length>1)add([label,"mixed",ids]);else if(ids.length&&!busy&&ids[0]!==want)add([label,"wrong genre",ids[0],want]);
      if(label==="trending"&&ids.length===1&&!busy&&w.shown[w.shown.length-1]!==ids[0])w.shown.push(ids[0])};
    for(const b of ["trending","season","last-season"])look(b,document.querySelector(`[data-discover-block="${b}"] .ps-row`),"[data-phone-card]","data-phone-card");
    look("spotlight",document.querySelector("[data-discover-spotlight]"),"[data-discover-feature]","data-discover-feature");
    requestAnimationFrame(tick)};requestAnimationFrame(tick)};
window.__watchStop=()=>{const w=window.__watch;window.__watch=null;return w};
// A dead end: no tabs, no way to change the genre or try again, a notice without its action, page overflow. The panel is
// judged by what it shows (its data-discover-page-*-container hook).
window.__deadEnd=()=>{const tabs=[...document.querySelectorAll("[data-discover-tabs] [role=tab]")],sel=tabs.filter(t=>t.getAttribute("aria-selected")==="true");
  if(tabs.length<3)return "tabs missing";if(sel.length!==1)return `${sel.length} tabs selected`;
  const panel=document.querySelector(".pd-panel");if(!panel)return "no panel";
  const name=["Anime","Schedule","Manga"].find(n=>panel.hasAttribute(`data-discover-page-${n.toLowerCase()}-container`));
  if(name!=="Schedule"){if(!document.querySelector("[data-discover-genres]")&&!document.querySelector("[data-discover-tab-error] button"))return name+": neither genre chips nor Try again";
    if([...document.querySelectorAll("[data-discover-row-error]")].some(e=>!e.querySelector("button")))return name+": a row error without Try again"}
  else{if(!panel.querySelector('[data-discover-block="schedule-day"],.ps-loading,[data-discover-schedule-error],[data-discover-schedule-empty]'))return "schedule: nothing shown";
    if([...panel.querySelectorAll("[data-discover-schedule-error],[data-discover-schedule-more-error]")].some(e=>!e.querySelector("button")))return "schedule: an error without Try again"}
  if(!panel.children.length)return name+": empty panel";
  if(document.documentElement.scrollWidth>innerWidth+1)return "page overflow";return null};
// The panel caught up with the chosen tab and genre: no row or spotlight dimmed (in the stress nothing hangs)
window.__caughtUp=()=>!document.querySelector(".pd-panel[aria-busy=true],.pd-panel .pd-stale,[data-discover-spotlight][aria-busy=true]");
})()'''
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
# Big pictures: a 600x900 cover and a 1600x560 banner with gradients and many shapes per title.
def cover_svg(i):
    h=i*47%360;dots=''.join(f'<circle cx="{(k*97+i)%600}" cy="{(k*53+i*7)%900}" r="{18+k%40}" fill="hsl({(h+k*11)%360} 50% {35+k%30}%)" opacity=".7"/>' for k in range(40))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl({h} 40% 25%)"/>'
        f'<stop offset="1" stop-color="hsl({(h+60)%360} 50% 45%)"/></linearGradient></defs><rect width="600" height="900" fill="url(#g)"/>{dots}</svg>')
def banner_svg(i):
    h=i*29%360;dots=''.join(f'<rect x="{(k*131+i)%1600}" y="{(k*37)%560}" width="{60+k%90}" height="{40+k%70}" rx="12" fill="hsl({(h+k*7)%360} 45% {30+k%35}%)" opacity=".6"/>' for k in range(60))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="560"><defs><radialGradient id="g"><stop offset="0" stop-color="hsl({h} 60% 55%)"/>'
        f'<stop offset="1" stop-color="hsl({(h+120)%360} 40% 15%)"/></radialGradient></defs><rect width="1600" height="560" fill="url(#g)"/>{dots}</svg>')
HTML='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>b.textContent||b.getAttribute("aria-label")))'''
TARGETS='[data-discover-phone] button,[data-discover-phone] a'
POINT='''(sel=>{const e=document.querySelector(sel);if(!e)return null;e.scrollIntoView({block:"nearest",inline:"nearest"});const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})'''
GENRE_OF='''(sel=>[...document.querySelectorAll(sel)].map(e=>Math.floor((+(e.dataset.phoneCard||e.dataset.discoverFeature)%100000)/1000)))'''
def cards(block): return f'[data-discover-block="{block}"] [data-phone-card]'
PANEL_MATCHES='''(()=>{const s=document.querySelector("[data-discover-tabs] [aria-selected=true]")?.dataset.tabName;
    return !!s&&document.querySelector(".pd-panel").hasAttribute(`data-discover-page-${s.toLowerCase()}-container`)})()'''
TRY='[data-discover-row-error] button,[data-discover-tab-error] button,[data-discover-schedule-error] button,[data-discover-schedule-more-error] button'
LIST_ANIME='/api/v1/anilist/list-anime'
def link(**params): return '/search?'+urlencode({k:v for k,v in params.items() if v not in (None,'')})
def stats(rec):
    f=sorted(rec['frames']);n=len(f);pick=lambda p:round(f[min(n-1,int(p*(n-1)+.5))],1) if n else 0
    return dict(ms=round(rec['ms']),frames=n,p50=pick(.5),p95=pick(.95),max=round(f[-1],1) if n else 0,over34=sum(x>34 for x in f),
        longTasks=len(rec['long']),longTaskMs=round(sum(rec['long'])),longest=round(max(rec['long'],default=0)))

with tempfile.TemporaryDirectory(prefix='seanime-discover-stress-') as tmp:
    prod=Path(tmp)/'prod/discover.js';dev=Path(tmp)/'dev/discover.js'
    for out,flags in ((prod,['--production']),(dev,[])):
        out.parent.mkdir();subprocess.run(['node',str(root/'tests/mobile_discover_bundle.cjs'),str(out),*flags],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,args=['--enable-precise-memory-info'])
        def open_page(bundle,query='',ready='[data-discover-phone]',marks=None):
            page=browser.new_page(viewport=dict(width=390,height=844),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.set_default_timeout(30000)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            if bundle is dev: page.on('console',lambda m:warnings.append(f'{m.text[:300]} {(m.location or {}).get("url","")}') if m.type=='error' else None)
            cdp=page.context.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',dict(rate=4))
            page.add_init_script(INIT.replace('__SPEC__',json.dumps(dict(state=STATE,genres=GENRES,host=HOST,seed=SEED))))
            page.route(f'{HOST}/cover/**',lambda r:r.fulfill(content_type='image/svg+xml',body=cover_svg(int(r.request.url.split('/')[-1].split('.')[0]))))
            page.route(f'{HOST}/banner/**',lambda r:r.fulfill(content_type='image/svg+xml',body=banner_svg(int(r.request.url.split('/')[-1].split('.')[0]))))
            page.route(f'{HOST}/discover*',lambda r:r.fulfill(content_type='text/html',body=HTML))
            page.route(f'{HOST}/static/**',lambda r:r.fulfill(path=str(root/'backend/seanime-web/out'/r.request.url.removeprefix(HOST+'/').split('?')[0])))
            page.goto(f'{HOST}/discover'+query)
            for css in (root/'backend/seanime-web/out/static/css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')))
            if marks: page.evaluate('m=>{__recStart();__mark(m)}',marks)
            page.add_script_tag(path=str(bundle))
            page.locator(ready).first.wait_for()
            return page,cdp
        def tap(page,selector):
            p=page.evaluate(POINT,selector)
            if p: page.touchscreen.tap(p[0],p[1])
            return bool(p)
        def settle(page,extra=400,timeout=30000):
            # Until the panel caught up (its requests only start then), every request is answered and no new one starts
            # (lazy rows, the next schedule page)
            end=time.time()+timeout/1000
            while True:
                page.wait_for_function('__caughtUp()&&requests.length<=answered.length',timeout=max(1000,int((end-time.time())*1000)))
                page.wait_for_timeout(extra)
                if page.evaluate('__caughtUp()&&requests.length<=answered.length'): return
        def tab(page,name):
            tap(page,f'[data-discover-tabs] [data-tab-name="{name}"]');page.wait_for_timeout(200);settle(page)
        def selected(page): return page.evaluate('document.querySelector("[data-discover-tabs] [aria-selected=true]")?.dataset.tabName')
        def pressed(page): return page.evaluate('document.querySelector("[data-discover-genres] [aria-pressed=true]")?.dataset.chip')
        def scroll_through(page):
            height=page.evaluate('document.documentElement.scrollHeight')
            for y in range(0,height+800,400):
                page.evaluate(f'window.scrollTo(0,{y})');page.wait_for_timeout(120)
            settle(page);page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(200)
        def swipe(page,cdp,x,y,dx,dy,hold=False,steps=12):
            # A finger: down, a move per frame, up (synthesized touch scroll gestures do nothing in headless Chromium).
            # hold: the finger rests before it lifts (no fling, the scroller snaps at once).
            cdp.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[dict(x=x,y=y)]))
            for k in range(1,steps+1):
                cdp.send('Input.dispatchTouchEvent',dict(type='touchMove',touchPoints=[dict(x=x+dx*k/steps,y=y+dy*k/steps)]));page.wait_for_timeout(16)
            if hold: page.wait_for_timeout(120)
            cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]))
        def heap(page,cdp):
            cdp.send('HeapProfiler.enable')
            for _ in range(2): cdp.send('HeapProfiler.collectGarbage');page.wait_for_timeout(150)
            used=cdp.send('Runtime.getHeapUsage')['usedSize'];dom=cdp.send('Memory.getDOMCounters')
            return dict(heapMB=round(used/1048576,2),memoryApiMB=round(page.evaluate('performance.memory.usedJSHeapSize')/1048576,2),
                nodes=dom['nodes'],listeners=dom['jsEventListeners'])
        def try_again(page,index):
            # The notice can go away between finding and tapping it (its row loaded): then there is nothing to tap.
            try: page.locator(TRY).nth(index).tap(timeout=3000)
            except Exception: pass
        def long_press(page,selector):
            page.locator(selector).first.dispatch_event('contextmenu',dict(clientX=150,clientY=400,button=2))
            page.get_by_role('menuitem',name='Preview').wait_for();page.wait_for_timeout(300)
        def genres_ok(page,want):
            """Every genre-aware row and the spotlight show the genre `want` (0 = all), nothing dimmed or busy."""
            gi=0 if want in (None,'all') else GENRES.index(want)+1
            shown={b:page.evaluate(GENRE_OF,cards(b)) for b in ('trending','season','last-season')}
            shown['spotlight']=page.evaluate(GENRE_OF,'[data-discover-feature]')
            busy=page.locator('.pd-panel .pd-stale,[data-discover-spotlight][aria-busy=true],'+','.join(f'[data-discover-block="{b}"] [aria-busy=true]' for b in ('trending','season','last-season'))).count()
            return all(v and set(v)=={gi} for v in shown.values()) and busy==0,dict({k:sorted(set(v)) for k,v in shown.items()},busy=busy)

        # 1. First render: from the bundle running until the shell, the spotlight, the trending covers and the first
        # banner show (fixture server answers after 60 ms). Three fresh pages.
        MARKS=[['shell','document.querySelector("[data-discover-phone]")'],['spotlight','document.querySelector("[data-discover-feature]")'],
            ['trending','document.querySelector(\'[data-discover-block="trending"] [data-phone-card]\')'],
            ['banner','(i=>!!i&&i.complete&&i.naturalWidth>0)(document.querySelector("[data-discover-feature] img"))']]
        runs=[]
        for n in range(3):
            page,cdp=open_page(prod,marks=MARKS,ready='[data-discover-block="trending"] [data-phone-card]')
            page.wait_for_function('["shell","spotlight","trending","banner"].every(k=>__marks[k]!=null)')
            runs.append(dict(page.evaluate('__marks'),**{k:v for k,v in stats(page.evaluate('__recStop()')).items() if k in ('longTasks','longest')}))
            if n<2: page.close()
        metrics['firstRender']=dict(runs=runs,median={k:sorted(r[k] for r in runs)[1] for k in runs[0]})
        check('First render: spotlight (5 cards) and trending (15 covers) of all genres',page.locator('[data-discover-feature]').count()==5
              and page.locator(cards('trending')).count()==15 and set(page.evaluate(GENRE_OF,cards('trending')))=={0},metrics['firstRender'])
        shot(page,'stress-first-render.png')

        # 2. Lazy rows: touch scroll gestures down to the bottom; the rows below load on the way
        settle(page)
        page.evaluate('''m=>{__recStart();__mark(m)}''',[['season',f'document.querySelector(\'{cards("season")}\')'],
            ['upcoming',f'document.querySelector(\'{cards("upcoming")}\')'],['movies',f'document.querySelector(\'{cards("movies")}\')']])
        for _ in range(30):
            swipe(page,cdp,195,720,0,-560);page.wait_for_timeout(250)
            if page.evaluate('scrollY+innerHeight>=document.documentElement.scrollHeight-2&&!!document.querySelector(\'[data-discover-block="movies"] [data-phone-card]\')'): break
        settle(page)
        metrics['lazyScroll']=dict(stats(page.evaluate('__recStop()')),loadedAfterMs=page.evaluate('__marks'))
        counts={b:page.locator(cards(b)).count() for b in ('trending','season','last-season','recent','missed','upcoming','movies')}
        asked=page.evaluate('requests.map(r=>r[0]+" "+JSON.stringify(r[1]))')
        check('Lazy rows: all seven rows full (15 trending after the spotlight, 20 elsewhere), each row asked once',
              counts==dict(trending=15,season=20,**{'last-season':20},recent=20,missed=20,upcoming=20,movies=20) and len(asked)==len(set(asked))==7,
              dict(counts=counts,requests=len(asked),metrics=metrics['lazyScroll']))
        check('Lazy rows at the bottom: no page overflow, every target at least 48px',page.evaluate(NO_OVERFLOW) and page.evaluate(SMALL,TARGETS)==[])
        page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(300)

        # 3. Spotlight swipe: four swipes to the right, one back; each lands on a card, nothing opens, the page stays
        box=page.evaluate('(r=>[r.top+r.height/2])(document.querySelector("[data-discover-spotlight] .ps-features").getBoundingClientRect())')
        SPOT='''(()=>{const f=document.querySelector("[data-discover-spotlight] .ps-features"),cards=[...f.querySelectorAll("[data-discover-feature]")];
            const lefts=cards.map(c=>c.getBoundingClientRect().left);const i=lefts.findIndex(l=>Math.abs(l-16)<=1);
            return {left:Math.round(f.scrollLeft),index:i,atEnd:f.scrollLeft>=f.scrollWidth-f.clientWidth-1,y:scrollY}})()'''
        routes0=len(page.evaluate('routes'));positions=[]
        page.evaluate('__recStart()')
        for dx in (-260,-260,-260,-260,260):
            swipe(page,cdp,300 if dx<0 else 90,box[0],dx,0,hold=True);page.wait_for_timeout(600)
            positions.append(page.evaluate(SPOT))
        metrics['spotlightSwipe']=dict(stats(page.evaluate('__recStop()')),positions=[p['index'] if p['index']>=0 else ('end' if p['atEnd'] else p['left']) for p in positions])
        steps=[p['index'] if p['index']>=0 else 4 for p in positions]
        check('Spotlight swipe: each swipe lands on a card (snapped), forward to the last card and back, no tap, menu or page scroll',
              all(p['index']>=0 or p['atEnd'] for p in positions) and steps[:4]==sorted(steps[:4]) and steps[3]==4 and steps[4]<steps[3]
              and len(page.evaluate('routes'))==routes0 and page.get_by_role('menuitem').count()==0 and all(p['y']==0 for p in positions),
              metrics['spotlightSwipe'])

        # 4. Rapid genre switching: 15 chips tapped 60 ms apart, answers 50-800 ms late in random order
        settle(page)
        order=random.Random(SEED).sample(GENRES,15)
        check('Genre chips: All and the 18 genres of Search',page.evaluate('[...document.querySelectorAll("[data-discover-genres] button")].map(b=>b.dataset.chip)')==['all',*GENRES])
        page.evaluate('latency=0;delay=[50,800]')
        r0,a0=page.evaluate('[requests.length,answered.length]')
        page.evaluate('__recStart();__watchGenres()')
        stamps=[]
        for g in order:
            t=time.perf_counter();stamps.append(t)
            tap(page,f'[data-discover-genres] [data-chip="{g}"]')
            rest=.060-(time.perf_counter()-t)
            if rest>0: page.wait_for_timeout(rest*1000)
        tapped=time.perf_counter()
        settle(page,extra=600)
        rec=page.evaluate('__recStop()');watch=page.evaluate('__watchStop()')
        ok,shown=genres_ok(page,order[-1])
        SWITCH_REQUESTS='''(([r0,a0])=>{const kinds={},asked={};for(const [e,d] of requests.slice(r0)){const k=e!=="/api/v1/anilist/list-anime"?e:!d.genres?"no genre":d.sort[0]==="TRENDING_DESC"?"trending":"season "+d.season;
            kinds[k]=(kinds[k]||0)+1;const g=`${k}|${d&&d.genres?d.genres[0]:""}`;asked[g]=(asked[g]||0)+1}
            const order=answered.slice(a0).filter(a=>a[1]==="/api/v1/anilist/list-anime"&&a[2]).map(a=>a[0]);let inversions=0;
            for(let i=0;i<order.length;i++)for(let j=i+1;j<order.length;j++)if(order[i]>order[j])inversions++;
            return {total:requests.length-r0,kinds,inversions,answered:order.length,asked}})'''
        sw=page.evaluate(SWITCH_REQUESTS,[r0,a0])
        gaps=[round((b-a)*1000) for a,b in zip(stamps,stamps[1:])]
        asked=sw.pop('asked')
        metrics['genreSwitch']=dict(stats(rec),tapGapMs=dict(mean=round(sum(gaps)/len(gaps)),max=max(gaps)),tapsMs=round((tapped-stamps[0])*1000),requests=sw,
            shownInOrder=[0 if i==0 else GENRES[i-1] for i in watch['shown']],watchedFrames=watch['frames'])
        check('15 genre taps with answers out of order: the last genre in every genre row and the spotlight, its chip chosen, nothing dimmed',
              ok and pressed(page)==order[-1] and (sw['inversions']>0 or sw['answered']<3),dict(last=order[-1],shown=shown,pressed=pressed(page),requests=sw))
        last=GENRES.index(order[-1])+1
        check('No stale or out-of-order overwrite: a row that is not dimmed never shows another genre, and once the last genre showed nothing replaced it',
              watch['violations']==[] and watch['shown'][-1]==last and watch['shown'].index(last)==len(watch['shown'])-1,
              dict(violations=watch['violations'],shown=watch['shown']))
        rows=('trending',f'season {CUR[0]}',f'season {PREV[0]}')
        check('Requests: only the genre-aware rows ask, never twice for a genre, the last genre once per row (genres tapped past may ask nothing)',
              set(sw['kinds'])<=set(rows) and all(n==1 for n in asked.values()) and all(asked.get(f'{k}|{order[-1]}')==1 for k in rows),dict(sw,asked=asked))
        shot(page,'stress-genre-final.png')
        # The same, forced: a slow answer of an earlier genre after the last one (1), a fast answer of an earlier genre
        # while the last one still loads (2)
        a,b,c=[g for g in GENRES if g not in order]
        for first,second,delays in ((a,b,{a:1500,b:50}),(c,order[0],{c:600,order[0]:1500})):
            page.evaluate('''([g,d])=>{queryClient.removeQueries({predicate:q=>JSON.stringify(q.queryKey).includes(`"genres":["${g}"]`)});delay=null;delayFor=d}''',[second,delays])
            page.evaluate('__watchGenres()')
            tap(page,f'[data-discover-genres] [data-chip="{first}"]');page.wait_for_timeout(100);tap(page,f'[data-discover-genres] [data-chip="{second}"]')
            page.wait_for_timeout(1700);settle(page)
            watch=page.evaluate('__watchStop()');ok,shown=genres_ok(page,second)
            check(f'Forced order ({first} answers {delays[first]} ms, {second} {delays[second]} ms; {second} tapped last): {second} stays, {first} never shows undimmed',
                  ok and watch['violations']==[] and GENRES.index(first)+1 not in watch['shown'][1:] and watch['shown'][-1]==GENRES.index(second)+1,
                  dict(shown=shown,watch=watch))
        page.evaluate('latency=60;delay=null;delayFor={}')
        # Single genre taps (60 ms answers): until the chip shows the tap, until the trending row shows the genre undimmed
        single=[]
        for g in (order[1],GENRES[GENRES.index(order[-1])-1],'all'):
            gi=0 if g=='all' else GENRES.index(g)+1;r0=page.evaluate('requests.length')
            page.evaluate('m=>__mark(m)',[['chip',f'document.querySelector(\'[data-discover-genres] [data-chip="{g}"][aria-pressed=true]\')'],
                ['rows','(r=>!!r&&r.getAttribute("aria-busy")!=="true"&&[...r.querySelectorAll("[data-phone-card]")].every(e=>Math.floor((+e.dataset.phoneCard%100000)/1000)==='
                    f'{gi}))(document.querySelector(\'[data-discover-block="trending"] .ps-row\'))']])
            tap(page,f'[data-discover-genres] [data-chip="{g}"]')
            page.wait_for_function('__marks.chip!=null&&__marks.rows!=null');settle(page)
            single.append(dict(genre=g,asked=page.evaluate('requests.length')-r0,**page.evaluate('__marks')))
        metrics['genreSingle']=single

        # 5. Tab switching: 2 x 40 quick taps over Anime, Schedule and Manga, ending on Anime; JS heap and DOM after GC
        tap(page,'[data-discover-genres] [data-chip="all"]');settle(page)
        for name in ('Schedule','Manga','Anime'): tab(page,name)
        page.evaluate('window.scrollTo(0,0)');settle(page,extra=800)
        # Single switches: from the tap until the tab is highlighted and until the panel shows the new tab's content
        SHOWN={'Anime':'.pd-panel[data-discover-page-anime-container]:not([aria-busy]) [data-discover-block="trending"] [data-phone-card]',
            'Schedule':'.pd-panel[data-discover-page-schedule-container]:not([aria-busy]) [data-discover-schedule-row]',
            'Manga':'.pd-panel[data-discover-page-manga-container]:not([aria-busy]) [data-discover-block="manga-jp"] [data-phone-card]'}
        single=[];page.evaluate('__recStart()')
        for name in ('Schedule','Manga','Anime')*2:
            page.evaluate('m=>__mark(m)',[['tab',f'document.querySelector(\'[data-tab-name="{name}"][aria-selected=true]\')'],['content',f'document.querySelector(\'{SHOWN[name]}\')']])
            tap(page,f'[data-discover-tabs] [data-tab-name="{name}"]')
            page.wait_for_function('__marks.tab!=null&&__marks.content!=null');single.append(dict(to=name,**page.evaluate('__marks')));settle(page)
        metrics['tabSwitchSingle']=dict(switches=single,frames=stats(page.evaluate('__recStop()')))
        check('Single tab switches: the tab highlights at once, its content follows',all(s['tab']<=s['content'] for s in single),metrics['tabSwitchSingle'])
        page.evaluate('window.scrollTo(0,0)');settle(page,extra=800)
        heaps=[heap(page,cdp)]
        seq=['Anime' if i%2 else ('Schedule' if i%4==0 else 'Manga') for i in range(40)]
        tab_runs=[]
        for _ in range(2):
            r0=page.evaluate('requests.length');page.evaluate('__recStart()');t=time.perf_counter()
            for name in seq: tap(page,f'[data-discover-tabs] [data-tab-name="{name}"]')
            took=time.perf_counter()-t;settle(page,extra=800)
            tab_runs.append(dict(stats(page.evaluate('__recStop()')),tapsMs=round(took*1000),requests=page.evaluate('requests.length')-r0))
            heaps.append(heap(page,cdp))
        metrics['tabSwitch']=dict(runs=tab_runs,heap=heaps)
        check('40 + 40 quick tab switches end on Anime with its rows of all genres, the URL follows, no script errors',
              selected(page)=='Anime' and page.evaluate('location.search')=='?type=anime' and genres_ok(page,None)[0]
              and page.locator(cards('trending')).count()==15 and errors==[],dict(selected=selected(page),errors=errors[:3]))
        check('Quick tab switches ask nothing again for rows already loaded (a 5-minute boundary may renew aired recently once)',
              all(r['requests']<=2 for r in tab_runs),tab_runs)
        check('Tab switches leak nothing: DOM nodes and listeners back to the start, JS heap grows < 1 MB over the second 40',
              heaps[2]['nodes']<=heaps[0]['nodes']*1.05 and heaps[2]['listeners']<=heaps[0]['listeners']*1.05 and heaps[2]['heapMB']-heaps[1]['heapMB']<1,heaps)
        tab(page,'Schedule')
        check('Schedule after the switches: 100 episodes over 14 days from both pages',page.locator('[data-discover-schedule-row]').count()==100
              and page.locator('[data-discover-block="schedule-day"]').count()==14 and page.locator('[data-phone-facts]').inner_text()=='100 episodes in the next 2 weeks')
        check('Schedule with 100 episodes: no page overflow, every target at least 48px',page.evaluate(NO_OVERFLOW) and page.evaluate(SMALL,TARGETS)==[])
        shot(page,'stress-schedule.png')
        page.close()

        # 6. "See all" per row and genre (development build from here on)
        page,cdp=open_page(dev,ready='[data-discover-block="trending"] [data-phone-card]')
        settle(page);scroll_through(page)
        wrong=[]
        for g in (None,'Action','Slice of Life','Sci-Fi','Mahou Shoujo'):
            tap(page,f'[data-discover-genres] [data-chip="{g or "all"}"]');page.wait_for_timeout(200);settle(page)
            got=page.evaluate('''Object.fromEntries([...document.querySelectorAll("[data-discover-see-all]")].map(e=>[e.dataset.discoverSeeAll,
                [e.getAttribute("href"),e.getAttribute("aria-label")===`See all: ${e.closest(".ps-section-head").querySelector("h2").firstChild.textContent.trim()}`]]))''')
            want={'trending':link(sorting='TRENDING_DESC',genre=g),'season':link(sorting='SCORE_DESC',season=CUR[0],year=CUR[1],genre=g),
                'last-season':link(sorting='SCORE_DESC',season=PREV[0],year=PREV[1],genre=g),'upcoming':link(sorting='TRENDING_DESC',status='NOT_YET_RELEASED'),
                'movies':link(sorting='TRENDING_DESC',format='MOVIE')}
            if {k:v[0] for k,v in got.items()}!=want or not all(v[1] for v in got.values()) or not genres_ok(page,g)[0]: wrong.append(dict(genre=g,got=got,want=want))
        check('"See all" of every anime row for All and four genres: Search with the row\'s sorting, season and genre; named after its row',wrong==[],wrong)
        href=page.locator('[data-discover-see-all="trending"]').get_attribute('href')
        tap(page,'[data-discover-see-all="trending"]');page.wait_for_timeout(300)
        check('A "See all" tap opens that Search URL',page.evaluate('routes').pop()==['push',href] and href.endswith('genre=Mahou+Shoujo'))
        page.evaluate('history.back()');page.locator('[data-discover-block="trending"] [data-phone-card]').first.wait_for();settle(page)
        tab(page,'Manga');scroll_through(page);wrong=[]
        for g in (None,'Slice of Life','Romance'):
            tap(page,f'[data-discover-genres] [data-chip="{g or "all"}"]');page.wait_for_timeout(200);settle(page)
            got=page.evaluate('Object.fromEntries([...document.querySelectorAll("[data-discover-see-all]")].map(e=>[e.dataset.discoverSeeAll,e.getAttribute("href")]))')
            want={f'manga-{c.lower()}':link(type='manga',sorting='TRENDING_DESC',country=c,genre=g) for c in ('JP','KR','CN')}
            gi=0 if g is None else GENRES.index(g)+1
            if got!=want or any(set(page.evaluate(GENRE_OF,cards(f'manga-{c}')))!={gi} for c in ('jp','kr','cn')): wrong.append(dict(genre=g,got=got,want=want))
        check('"See all" of the manga rows for All and two genres: manga Search by country and genre; rows show that genre',wrong==[],wrong)
        tap(page,'[data-discover-genres] [data-chip="all"]');settle(page)

        # 7. Android Back (the app's native back script) closes the long-press menu: covers, spotlight, schedule, manga
        closed=[]
        for target in (cards('manga-jp'),):
            long_press(page,target);closed.append(page.evaluate(NATIVE_BACK) and page.get_by_role('menuitem').count()==0);page.wait_for_timeout(200)
        tab(page,'Anime')
        for target in (cards('trending'),'[data-discover-feature]',cards('movies')):
            long_press(page,target);closed.append(page.evaluate(NATIVE_BACK));page.wait_for_timeout(300);closed[-1]=closed[-1] and page.get_by_role('menuitem').count()==0
        for _ in range(10):
            long_press(page,cards('season'));closed.append(page.evaluate(NATIVE_BACK));page.wait_for_timeout(250);closed[-1]=closed[-1] and page.get_by_role('menuitem').count()==0
        tab(page,'Schedule')
        long_press(page,'[data-discover-schedule-row]');closed.append(page.evaluate(NATIVE_BACK));page.wait_for_timeout(300)
        closed[-1]=closed[-1] and page.get_by_role('menuitem').count()==0
        check('Android Back closes the card menu on manga, cover, spotlight, movie, schedule row and 10 times in a row; Back with nothing open is left to the app',
              all(closed) and len(closed)==15 and page.evaluate(NATIVE_BACK) is False and page.locator('[data-sea-context-menu-content]').count()==0,closed)
        tab(page,'Anime')

        # 8. Failure storm: 30 % of the requests fail (50-400 ms late) while genres, tabs, scrolling and Try again go fast
        rng=random.Random(SEED)
        page.evaluate('latency=0;delay=[50,400];failRate=0.3')
        dead=[];failed=0;actions=[]
        for step in range(70):
            r=rng.random();chips=page.locator('[data-discover-genres]').count()>0;tries=page.locator(TRY).count()
            if r<.45 and chips: act=('genre',rng.choice(['all',*GENRES]));tap(page,f'[data-discover-genres] [data-chip="{act[1]}"]')
            elif r<.7: act=('tab',rng.choice([n for n in ('Anime','Schedule','Manga') if n!=selected(page)]));tap(page,f'[data-discover-tabs] [data-tab-name="{act[1]}"]')
            elif r<.85 or not tries: act=('scroll',round(rng.random(),2));page.evaluate(f'window.scrollTo(0,{act[1]}*document.documentElement.scrollHeight)')
            else: act=('try again',tries);try_again(page,rng.randrange(tries))
            actions.append(act);page.wait_for_timeout(rng.choice([60,250,600]))
            v=page.evaluate('__deadEnd()')
            if v: dead.append(dict(step=step,action=act,problem=v))
        settle(page,extra=300)
        v=page.evaluate('__deadEnd()') or (None if page.evaluate(PANEL_MATCHES) else 'the panel does not show the chosen tab')
        if v: dead.append(dict(step='settled',problem=v))
        failed=page.evaluate('answered.filter(a=>a[3]).length');total=page.evaluate('answered.length')
        metrics['failureStorm']=dict(actions=len(actions),requests=total,failed=failed,errorNoticesAtEnd=page.locator(TRY).count(),tab=selected(page),genre=pressed(page))
        check('Failure storm: never a dead end (tabs, genre chips or Try again always there, every notice with its action, no overflow)',dead==[] and failed>0,
              dict(dead=dead[:5],storm=metrics['failureStorm']))
        shot(page,'stress-storm-end.png')
        # Recovery: requests work again; Try again on every notice brings each tab back complete
        page.evaluate('failRate=0;delay=[50,200]')
        recovered={}
        for name in ('Anime','Schedule','Manga'):
            if selected(page)!=name: tab(page,name)
            for _ in range(6):
                scroll_through(page)
                if not page.locator(TRY).count(): break
                for _ in range(12):
                    if not page.locator(TRY).count(): break
                    try_again(page,0);page.wait_for_timeout(150)
                settle(page)
            if name=='Anime':
                want=pressed(page);ok,shown=genres_ok(page,want)
                counts={b:page.locator(cards(b)).count() for b in ('trending','season','last-season','recent','missed','upcoming','movies')}
                ok=ok and counts==dict(trending=15,season=20,**{'last-season':20},recent=20,missed=20,upcoming=20,movies=20);detail=dict(genre=want,shown=shown,counts=counts)
            elif name=='Schedule':
                ok=page.locator('[data-discover-schedule-row]').count()==100 and page.locator('[data-phone-facts]').inner_text()=='100 episodes in the next 2 weeks'
                detail=dict(rows=page.locator('[data-discover-schedule-row]').count(),facts=page.locator('[data-phone-facts]').inner_text())
            else:
                want=pressed(page);gi=0 if want=='all' else GENRES.index(want)+1
                shown={c:sorted(set(page.evaluate(GENRE_OF,cards(f'manga-{c}')))) for c in ('jp','kr','cn')}
                ok=all(v==[gi] for v in shown.values()) and page.locator('[data-discover-feature]').count()==5;detail=dict(genre=want,shown=shown)
            ok=ok and page.locator(TRY).count()==0 and page.locator('.pd-panel [aria-busy=true]').count()==0
            recovered[name]=dict(ok=ok,**detail,overflow=not page.evaluate(NO_OVERFLOW),small=page.evaluate(SMALL,TARGETS))
        check('After the storm, Try again brings every tab back complete (anime rows of the chosen genre, 100 episodes, manga rows)',
              all(v['ok'] for v in recovered.values()),recovered)
        check('After the storm: no page overflow and every target at least 48px on each tab',all(not v['overflow'] and v['small']==[] for v in recovered.values()),recovered)
        tab(page,'Anime');tap(page,'[data-discover-genres] [data-chip="all"]');settle(page)
        check('All genres again shows the first screen of all genres',genres_ok(page,None)[0])
        page.close()
        browser.close()
check('No script errors on any page',errors==[],errors[:5])
check('No React warnings or console errors (development build)',warnings==[],warnings[:5])
print(json.dumps(metrics,indent=1))
print(f'{sum(c["passed"] for c in checks)}/{len(checks)} checks passed')
sys.exit(0 if all(c['passed'] for c in checks) else 1)
