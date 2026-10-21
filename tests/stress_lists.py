"""Stress of the Android-phone My lists tab with synthetic AniList data (AniList itself is not asked): 1,500 anime in every
status plus two custom lists, 400 manga, tags, stats, library and chapter numbers. The real /lists page and phone screen through
the mobile_lists harness (production React build), headless Chromium at 390x844 with touch, the main thread slowed 4x (CDP).
Measures and checks: first render, status tab switches, Anime | Manga | Stats switches 30x with the JS heap, a fast scroll to the
end of the longest list (frame times, long tasks, mounted cards, DOM size; the same scroll over a static grid as the floor of this
setup), live search latency and its final result, the filter & sort sheet under rapid input (genres, all 16 sorts, reset), the
long-press menu, Android Back, overflow and 48px targets. Timings vary with the machine's load; the checks do not.
Optional arg: output dir (metrics.json, screenshots)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, time, random, zlib, struct, colorsys
root=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1]) if len(sys.argv)>1 else None
if out: out.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];warnings=[];metrics={}
def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,f'{name}: {detail}'
def log(text): print(f'[stress] {text}',file=sys.stderr,flush=True)
def shot(page,name,full=False):
    if out: page.screenshot(path=str(out/name),full_page=full)

# Synthetic AniList collections ////////////////////////////////////////////////////////////////////////////////////////////////
rng=random.Random(20261021)
NOW=int(time.time());D=86400
GENRES=['Action','Adventure','Comedy','Drama','Ecchi','Fantasy','Horror','Mahou Shoujo','Mecha','Music','Mystery','Psychological','Romance',
    'Sci-Fi','Slice of Life','Sports','Supernatural','Thriller']
TAGS=['Isekai','Magic','Male Protagonist','Female Protagonist','Reincarnation','Time Manipulation','Video Games','Super Power','Swordplay','Demons',
    'School','Shounen','Seinen','Josei','Shoujo','Ensemble Cast','Found Family','Tragedy','Revenge','Military','Politics','Space','Robots','Cyberpunk',
    'Post-Apocalyptic','Survival','Martial Arts','Iyashikei','Cute Girls Doing Cute Things','Love Triangle','Coming of Age','Primarily Adult Cast',
    'Primarily Teen Cast','Episodic','Anti-Hero','Gods','Mythology','Vampire','Zombie','Detective','Crime','Gore','Idol','Band','Cooking','Food',
    'Travel','Dungeon','Guilds','Kingdom Management','Nobility','Royal Affairs','Witch','Dragons','Elf','Assassins','Tsundere','Twins','Urban Fantasy',
    'Satire','Parody','Slapstick','Super Robot','Real Robot','Aliens','Time Loop','Philosophy','Lost Civilization','Historical','Rural','Work',
    'Teacher','Baseball','Basketball','Football','Volleyball','Racing','Shapeshifting','Magic School','Body Swapping','Ghost','Youkai','Nudity']
ADJ=['Crimson','Crystal','Cruel','Silent','Silver','Golden','Hidden','Eternal','Endless','Broken','Burning','Frozen','Lost','Last','Little','Lonely',
    'Midnight','Mystic','Scarlet','Secret','Shining','Twilight','Wandering','Wicked']
NOUN=['Dragon','Drifter','Dream','Dawn','Demon','Diva','Academy','Alchemist','Blade','Bride','Castle','Chronicle','Garden','Ghost','Hero','Knight',
    'Kingdom','Melody','Moon','Princess','Saga','Sword','Tower','Witch']
ANIME_FORMATS=['TV']*12+['MOVIE']*2+['ONA']*2+['OVA']*2+['TV_SHORT','SPECIAL']
SEASONS=['WINTER','SPRING','SUMMER','FALL']
ORDER=['CURRENT','REPEATING','PLANNING','PAUSED','COMPLETED','DROPPED']
LABELS=dict(anime=dict(CURRENT='Watching',REPEATING='Rewatching',PLANNING='Planning',PAUSED='Paused',COMPLETED='Completed',DROPPED='Dropped'),
    manga=dict(CURRENT='Reading',REPEATING='Rereading',PLANNING='Planning',PAUSED='Paused',COMPLETED='Completed',DROPPED='Dropped'))
ANIME_PLAN=dict(CURRENT=75,REPEATING=25,PLANNING=300,PAUSED=60,COMPLETED=950,DROPPED=90)
MANGA_PLAN=dict(CURRENT=70,REPEATING=10,PLANNING=110,PAUSED=25,COMPLETED=150,DROPPED=35)
# Distinct "last updated" times, so the UPDATED_AT_DESC order is unambiguous.
UPDATED=[NOW-i*97 for i in range(2000)];rng.shuffle(UPDATED)

def day(ts):
    t=time.gmtime(ts);return dict(year=t.tm_year,month=t.tm_mon,day=t.tm_mday)
def make_media(n,kind,list_status):
    mid=(10000 if kind=='anime' else 20000)+n
    if list_status in ('COMPLETED','REPEATING'): status='FINISHED'
    elif list_status=='CURRENT': status=rng.choice(['RELEASING']*5+['FINISHED']*4+(['HIATUS'] if kind=='manga' else []))
    elif list_status=='PLANNING': status=rng.choice(['NOT_YET_RELEASED','NOT_YET_RELEASED','FINISHED','FINISHED','RELEASING'])
    else: status=rng.choice(['FINISHED','FINISHED','RELEASING']+(['CANCELLED','HIATUS'] if kind=='manga' else []))
    year=rng.randint(2025,2026) if status=='RELEASING' else rng.randint(2026,2027) if status=='NOT_YET_RELEASED' else rng.randint(1988,2025)
    month=rng.randint(1,12)
    m=dict(id=mid,idMal=60000+mid,title=dict(userPreferred=f'Title {n:04d}',romaji=f'Title {n:04d}',
            english=f'{rng.choice(ADJ)} {rng.choice(NOUN)}' if rng.random()<.7 else None),
        synonyms=[f'{rng.choice(NOUN)} {n}'] if n%4==0 else [],status=status,genres=rng.sample(GENRES,rng.randint(1,4)),
        isAdult=rng.random()<.015 and list_status in ('COMPLETED','PLANNING'),meanScore=rng.randint(45,92),
        startDate=dict(year=year,month=month,day=rng.randint(1,28)),coverImage=dict(large=f'http://lists.test/cover/{mid}.png'))
    if kind=='anime':
        fmt=rng.choice(ANIME_FORMATS)
        episodes=None if status=='NOT_YET_RELEASED' or (status=='RELEASING' and rng.random()<.2) else 1 if fmt=='MOVIE' else rng.choice([10,11,12,12,13,24,25,26,52])
        m.update(format=fmt,season=SEASONS[(month-1)//3],seasonYear=year,episodes=episodes,chapters=None)
        if status=='RELEASING':
            at=NOW+rng.randint(3600,7*D-600)
            m['nextAiringEpisode']=dict(episode=rng.randint(2,max(2,episodes or 24)),airingAt=at,timeUntilAiring=at-NOW)
    else:
        m.update(format=rng.choice(['MANGA']*8+['ONE_SHOT','NOVEL']),chapters=None if status=='RELEASING' else rng.randint(20,400),episodes=None,
            season=None,seasonYear=None)
    return m
def make_entry(m,kind,list_status):
    total=m['episodes'] if kind=='anime' else m['chapters']
    aired=m['nextAiringEpisode']['episode']-1 if m.get('nextAiringEpisode') else total
    progress=(0 if list_status=='PLANNING' else (total or rng.randint(12,200)) if list_status=='COMPLETED'
        else rng.randint(0,aired or total or 60) if list_status=='CURRENT' else rng.randint(1,max(1,(aired or total or 60)-1)))
    scored=list_status!='PLANNING' and rng.random()<(.85 if list_status=='COMPLETED' else .3)
    created=NOW-rng.randint(400*D,3000*D)
    e=dict(id=900000+m['id'],media=m,status=list_status,progress=progress,score=rng.randrange(30,101,5) if scored else 0,repeat=0,
        createdAt=created,updatedAt=UPDATED.pop())
    if list_status!='PLANNING': e['startedAt']=day(created+rng.randint(0,30*D))
    if list_status in ('COMPLETED','REPEATING') and rng.random()<.9: e['completedAt']=day(created+rng.randint(31*D,360*D))
    return e
def collection(kind,plan,start,customs):
    by={};n=start
    for status,count in plan.items():
        by[status]=[]
        for _ in range(count):
            by[status].append(make_entry(make_media(n,kind,status),kind,status));n+=1
        rng.shuffle(by[status])
    # Entries without media (deleted on AniList) are skipped by the screen.
    by['CURRENT'][3:3]=[dict(id=1,media=None,status='CURRENT'),dict(id=2,media=None,status='CURRENT')]
    lists=[dict(status=s,isCustomList=False,name=LABELS[kind][s],entries=by[s]) for s in plan]
    rng.shuffle(lists)
    for name,count,statuses in customs:
        pool=[e for s in statuses for e in by[s] if e.get('media')]
        lists.append(dict(isCustomList=True,name=name,status=None,entries=rng.sample(pool,count)))
    return dict(MediaListCollection=dict(lists=lists))

ANIME=collection('anime',ANIME_PLAN,1,[('Favourites',140,['COMPLETED','CURRENT']),('Seasonal picks',90,['CURRENT','PLANNING','PAUSED'])])
MANGA=collection('manga',MANGA_PLAN,2001,[('To read next',40,['PLANNING','PAUSED'])])
def all_entries(col): return [e for l in col['MediaListCollection']['lists'] for e in l['entries'] if e.get('media')]
def unique(col): return list({e['media']['id']:e for e in all_entries(col)}.values())
ANIME_TAGS={str(e['media']['id']):rng.sample(TAGS,rng.randint(2,7)) for e in unique(ANIME)}
MANGA_TAGS={str(e['media']['id']):rng.sample(TAGS,rng.randint(1,5)) for e in unique(MANGA)}
reading=[e for e in unique(MANGA) if e['status']=='CURRENT' and e['media']['status']=='RELEASING']
CHAPTERS=dict(latestChapterNumbers={str(e['media']['id']):[dict(provider='comick',scanlator='',language='en',number=e['progress']+rng.randint(0,15))] for e in reading},
    storedProviders={str(e['media']['id']):'comick' for e in reading},storedFilters={})
LIBRARY=dict(lists=[dict(status='CURRENT',entries=[dict(mediaId=e['media']['id'],libraryData=dict(mainFileCount=12,unwatchedCount=rng.randint(0,6),sharedPath='',
    allFilesLocked=False)) for e in rng.sample([e for e in unique(ANIME) if e['status'] in ('CURRENT','COMPLETED')],120)])])
def stats_of(col,kind):
    es=unique(col);scored=[e['score'] for e in es if e['score']]
    def rows(key,values):
        counts={}
        for v in values:
            if v is not None: counts[v]=counts.get(v,0)+1
        return [{key:k,'count':c,'meanScore':70,'minutesWatched':c*240,'chaptersRead':c*30} for k,c in sorted(counts.items(),key=lambda kv:-kv[1])]
    s=dict(count=len(es),meanScore=round(sum(scored)/len(scored),1),scores=rows('score',[e['score'] or None for e in es]),
        statuses=rows('status',[e['status'] for e in es]),genres=rows('genre',[g for e in es for g in e['media']['genres']]),
        startYears=rows('startYear',[e.get('startedAt',{}).get('year') for e in es]),releaseYears=rows('releaseYear',[e['media']['startDate']['year'] for e in es]))
    if kind=='anime':
        s.update(minutesWatched=sum(e['progress'] for e in es)*24,episodesWatched=sum(e['progress'] for e in es),formats=rows('format',[e['media']['format'] for e in es]),
            studios=[dict(studio=dict(id=i,name=f'Studio {i:02d}',isAnimationStudio=True),count=80-i*3,meanScore=72,minutesWatched=0,chaptersRead=0) for i in range(20)])
    else: s.update(chaptersRead=sum(e['progress'] for e in es))
    return s
STATUS=dict(user=dict(viewer=dict(name='Nick'),isSimulated=False),isOffline=False,
    settings=dict(library=dict(enableManga=True),anilist=dict(enableAdultContent=True,blurAdultContent=True)),themeSettings=dict(showMangaUnreadCount=True))
SERVER=dict(status=STATUS,anime=ANIME,manga=MANGA,animeTags=ANIME_TAGS,mangaTags=MANGA_TAGS,stats=dict(animeStats=stats_of(ANIME,'anime'),
    mangaStats=stats_of(MANGA,'manga')),streaming=True,states={},mangaChapters=CHAPTERS,library=LIBRARY)

# What the screen must show, from the fixtures (the screen's rules, written again) ///////////////////////////////////////////////
def phone_lists(col):
    lists=col['MediaListCollection']['lists'];keep=lambda es:[e for e in es if e.get('media')]
    status=[(s,keep(l['entries'])) for s in ORDER for l in lists if not l['isCustomList'] and l['status']==s]
    return status+[('custom:'+l['name'],keep(l['entries'])) for l in lists if l['isCustomList']]
LISTS=phone_lists(ANIME);BY_KEY=dict(LISTS)
def label(key): return key[7:] if key.startswith('custom:') else LABELS['anime'][key]
def title_hit(e,query):
    q=' '.join(query.lower().split());t=e['media']['title']
    return any(v and q in v.lower() for v in [t.get('english'),t.get('userPreferred'),t.get('romaji')]+e['media']['synonyms'])
def hits(query='',genres=()):
    return [(k,[e for e in es if (not query.strip() or title_hit(e,query)) and all(g in e['media']['genres'] for g in genres)]) for k,es in LISTS]
def tab_texts(query='',genres=()): return [f'{label(k)}{len(es)}' for k,es in hits(query,genres)]
def selected_for(query,remembered):
    counted=hits(query)
    if not query.strip() or dict(counted)[remembered]: return remembered
    return next((k for k,es in counted if es),remembered)
def signature(query,remembered): return ','.join(str(len(es)) for _,es in hits(query))+'|'+selected_for(query,remembered)
by_score=lambda es:sorted(es,key=lambda e:(-(e['score'] or 0),e['media']['title']['userPreferred']))
by_updated=lambda es:sorted(es,key=lambda e:-e['updatedAt'])
titles=lambda es:[e['media']['title']['userPreferred'] for e in es]
def fresh(e):
    m=e['media'];nxt=m.get('nextAiringEpisode')
    return m['status']=='RELEASING' and nxt and nxt['episode']-1-(e['progress'] or 0)>0
FACTS_TEXT=f'{len(unique(ANIME)):,} anime · {len(BY_KEY["CURRENT"])} watching · {sum(1 for e in BY_KEY["CURRENT"] if fresh(e))} with new episodes'
BIGGEST=max(ORDER,key=lambda k:len(BY_KEY[k]))
# Six result changes over its 12 keys; its hits are outside the remembered Completed, so the search follows them to Paused.
QUERY='silver drago'
SORTS=[('SCORE_DESC','Highest score'),('SCORE','Lowest score'),('TITLE','Title (A-Z)'),('TITLE_DESC','Title (Z-A)'),('AUDIENCE_SCORE_DESC','Highest audience score'),
    ('AUDIENCE_SCORE','Lowest audience score'),('PROGRESS_DESC','Highest progress'),('PROGRESS','Lowest progress'),('START_DATE_DESC','Started recently'),
    ('START_DATE','Oldest start date'),('END_DATE_DESC','Completed recently'),('END_DATE','Oldest completion date'),('RELEASE_DATE_DESC','Released recently'),
    ('RELEASE_DATE','Oldest release'),('CREATED_AT_DESC','Date added (newest first)'),('UPDATED_AT_DESC','Last updated')]
TOGGLED=['Action','Comedy','Drama','Mecha','Music','Mystery','Romance','Sci-Fi','Sports','Fantasy']
KEPT=['Action','Fantasy']

INIT='''(()=>{Object.assign(window,{server:%s,routes:[],requested:[],refetches:[],mutations:[],invalidated:[],toasts:[],previews:[],playNext:[],playlist:[]})})()'''
# Timing helpers: __time runs an action and resolves at the commit that makes `done` true and at the frame after it;
# __first notes when the first covers appear; __scrollToEnd scrolls a step per frame and records frame times and long tasks.
HELPERS='''(()=>{
window.__time=(action,done,timeout=30000)=>new Promise((resolve,reject)=>{
    const t0=performance.now();let finished=false
    const finish=()=>{if(finished)return;finished=true;mo.disconnect();clearTimeout(timer);const commit=performance.now()-t0
        requestAnimationFrame(()=>setTimeout(()=>resolve({commit,paint:performance.now()-t0}),0))}
    const mo=new MutationObserver(()=>{if(done())finish()})
    const timer=setTimeout(()=>{if(!finished){finished=true;mo.disconnect();reject(new Error("timeout"))}},timeout)
    mo.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true})
    action();queueMicrotask(()=>{if(done())finish()})})
window.__watchFirst=()=>{window.__first={};const mo=new MutationObserver(()=>{if(__first.commit||!document.querySelector("[data-lists-grid] [data-phone-card]"))return
    __first.commit=performance.now();mo.disconnect();requestAnimationFrame(()=>setTimeout(()=>{__first.paint=performance.now()},0))})
    mo.observe(document.documentElement,{subtree:true,childList:true})}
window.__scrollToEnd=(step,maxMs)=>new Promise(resolve=>{
    const frames=[],longs=[],samples=[];const po=new PerformanceObserver(list=>{for(const e of list.getEntries())longs.push(e.duration)})
    po.observe({type:"longtask"});const t0=performance.now();let last=0,n=0
    const cards=()=>document.querySelectorAll("[data-lists-grid] [data-phone-card]").length
    const tick=now=>{if(last)frames.push(now-last);last=now;if(++n%10===0)samples.push(cards())
        const end=scrollY>=document.documentElement.scrollHeight-innerHeight-2&&!!document.querySelector("[data-lists-top]")
        if(end||performance.now()-t0>maxMs){for(const e of po.takeRecords())longs.push(e.duration);po.disconnect()
            return resolve({frames,longs,ms:performance.now()-t0,end,maxCards:Math.max(cards(),...samples)})}
        scrollBy(0,step);requestAnimationFrame(tick)}
    requestAnimationFrame(tick)})
window.__sig=()=>[...document.querySelectorAll("[data-lists-status-tabs] [role=tab]")].map(b=>b.querySelector("span")?.textContent??"").join(",")
    +"|"+(document.querySelector("[data-lists-status-tabs] [aria-selected=true]")?.dataset.tabValue??"")
window.__recordSearch=()=>{const rec={keys:[],frames:[],states:[]},input=document.querySelector("[data-lists-search]")
    const onKey=e=>rec.keys.push({key:e.key,t:e.timeStamp,now:performance.now()});input.addEventListener("keydown",onKey,true)
    // The typed letter on screen: from the input to the frame after it.
    const onInput=e=>{const t=Math.min(e.timeStamp,performance.now());requestAnimationFrame(()=>setTimeout(()=>rec.frames.push(performance.now()-t),0))}
    input.addEventListener("input",onInput)
    let last=__sig();const mo=new MutationObserver(()=>{const s=__sig();if(s===last)return;last=s
        const state={sig:s,t:performance.now(),cells:document.querySelectorAll("[data-lists-grid] .pl-cell").length};rec.states.push(state)
        requestAnimationFrame(()=>setTimeout(()=>{state.paint=performance.now()},0))})
    mo.observe(document.querySelector("[data-phone-screen]"),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["aria-selected"]})
    window.__stopSearch=()=>{mo.disconnect();input.removeEventListener("keydown",onKey,true);input.removeEventListener("input",onInput);return rec}}
})()'''
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
# Raster covers as AniList serves them: each SVG cover built its own SVG document on the main thread (2.7 s of a 20 s scroll).
def cover_png(hue,width=230,height=345):
    dark,light=[bytes(round(c*255) for c in colorsys.hls_to_rgb(hue/360,l,.4)) for l in (.3,.5)]
    rows=b''.join(b'\0'+(light if 60<y<200 else dark)*width for y in range(height))
    chunk=lambda kind,data:struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
COVERS=[cover_png(i*15) for i in range(24)]
STATIC=root/'backend/seanime-web/out/static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>b.textContent||b.getAttribute("aria-label")))'''
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
TITLES='[...document.querySelectorAll("[data-lists-grid] .ps-card-title")].map(e=>e.textContent)'
CELLS='document.querySelectorAll("[data-lists-grid] .pl-cell").length'
CARDS='document.querySelectorAll("[data-lists-grid] [data-phone-card]").length'
ELEMENTS='document.getElementsByTagName("*").length'
OPEN='document.querySelectorAll(".UI-Modal__content[data-state=open]").length'
SELECTED='document.querySelector("[data-lists-status-tabs] [aria-selected=true]")?.dataset.tabValue'
CHIPS='(sel=>Object.fromEntries([...document.querySelectorAll(sel)].map(c=>[c.dataset.chip,+c.querySelector("span").textContent])))'

def pct(values,q):
    values=sorted(values);return round(values[min(len(values)-1,int(q*len(values)))],1) if values else None
def spread(values): return dict(n=len(values),p50=pct(values,.5),p95=pct(values,.95),max=round(max(values),1) if values else None)

with tempfile.TemporaryDirectory(prefix='seanime-lists-stress-') as tmp:
    bundle=Path(tmp)/'lists.js'
    subprocess.run(['node',str(root/'tests/mobile_lists_bundle.cjs'),str(bundle),'--production'],check=True,cwd=root)
    # Bundle evaluation is timed apart from the screen's first render.
    SCRIPT='window.__evalStart=performance.now();\n'+bundle.read_text(encoding='utf-8')+'\n;window.__evalEnd=performance.now();'
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,args=['--enable-precise-memory-info'])
        def open_page(storage=None):
            page=browser.new_page(viewport=dict(width=390,height=844),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.set_default_timeout(60000)
            cdp=page.context.new_cdp_session(page)
            cdp.send('Emulation.setCPUThrottlingRate',dict(rate=4));cdp.send('Performance.enable')
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.on('console',lambda m:warnings.append(m.text[:300]) if m.type=='error' else None)
            page.add_init_script(INIT%json.dumps(SERVER));page.add_init_script(HELPERS)
            for key,value in (storage or {}).items(): page.add_init_script(f'localStorage.setItem({json.dumps(key)},{json.dumps(json.dumps(value))})')
            page.route('http://lists.test/cover/**',lambda r:r.fulfill(content_type='image/png',headers={'Cache-Control':'max-age=3600'},
                body=COVERS[int(r.request.url.split('/')[-1].split('.')[0])%24]))
            page.route('http://lists.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            page.route('http://lists.test/lists*',lambda r:r.fulfill(content_type='text/html',body='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'))
            page.goto('http://lists.test/lists')
            for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')))
            page.evaluate('__watchFirst()');page.add_script_tag(content=SCRIPT)
            page.wait_for_function('window.__first&&__first.paint');first=page.evaluate('({...__first,evalStart:__evalStart,evalEnd:__evalEnd})')
            page.evaluate('document.fonts.ready');page.wait_for_timeout(800)
            return page,cdp,dict(evaluate=round(first['evalEnd']-first['evalStart']),render_commit=round(first['commit']-first['evalEnd']),
                render_paint=round(first['paint']-first['evalEnd']),total=round(first['paint']-first['evalStart']))
        def heap(page,cdp):
            for _ in range(2): cdp.send('HeapProfiler.collectGarbage')
            m={x['name']:x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}
            return dict(heap_mb=round(page.evaluate('performance.memory.usedJSHeapSize')/2**20,2),nodes=int(m['Nodes']),listeners=int(m['JSEventListeners']))
        def timed(page,action,done): return page.evaluate(f'__time(()=>{{{action}}},()=>{done})')
        def back(page):
            ok=page.evaluate(NATIVE_BACK);page.wait_for_timeout(400);return ok

        # First render: the default list (Watching) and a remembered long one (Completed, 950 titles)
        log(f'fixtures: {len(unique(ANIME))} anime ({", ".join(f"{label(k)} {len(es)}" for k,es in LISTS)}), {len(unique(MANGA))} manga')
        page,cdp,first=open_page();metrics['first_render_watching']=first
        check('Facts count every anime once, the watching list and the running shows with new episodes',page.evaluate('document.querySelector("[data-phone-facts]")?.textContent')==FACTS_TEXT,
              page.evaluate('document.querySelector("[data-phone-facts]")?.textContent'))
        check('Status tabs: lists in fixed order, custom lists last, every count right',page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==tab_texts())
        check('Watching grid: highest score first, then title',page.evaluate(TITLES)[:12]==titles(by_score(BY_KEY['CURRENT']))[:12])
        page.close()
        page,cdp,first=open_page(storage={'sea-mobile-lists-status-anime':BIGGEST});metrics['first_render_completed']=first
        log(f'first render: watching {metrics["first_render_watching"]}, completed {first}')
        check('A remembered long list opens with 60 cells, cards only near the screen',page.evaluate(SELECTED)==BIGGEST and page.evaluate(CELLS)==60
              and page.evaluate(CARDS)<=60 and page.evaluate(TITLES)[:6]==titles(by_score(BY_KEY[BIGGEST]))[:6])
        shot(page,'stress-lists-first.png')

        # Status tabs, each
        tabs={}
        for key,_ in LISTS[:]+[(BIGGEST,None)]:
            if key==page.evaluate(SELECTED): continue
            tabs[key]=timed(page,f'document.querySelector(\'[data-lists-status-tabs] [data-tab-value="{key}"]\').click()',
                f'document.querySelector("[data-lists-grid]")?.dataset.listsGrid==={json.dumps(key)}')
            page.wait_for_timeout(250)
            check(f'Tab {label(key)}: its covers by score',page.evaluate(TITLES)[:6]==titles(by_score(BY_KEY[key]))[:6])
        metrics['status_tab_switch_ms']={label(k):dict(commit=round(v['commit']),paint=round(v['paint'])) for k,v in tabs.items()}
        log(f'status tabs: {metrics["status_tab_switch_ms"]}')

        # Anime | Manga | Stats, 30 rounds (each round: Manga list, Manga stats, Anime stats, Anime list)
        TYPE='[data-lists-type-tabs] [data-tab-name="{}"]'
        steps=[('manga list',f'document.querySelector(\'{TYPE.format("Manga")}\').click()','!!document.querySelector(\'[data-lists-grid] [data-media-type="manga"]\')'),
            ('manga stats','document.querySelector("[data-lists-stats-button]").click()','!!document.querySelector(\'[data-lists-stats="manga"] [data-lists-stats-hero]\')'),
            ('anime stats',f'document.querySelector(\'{TYPE.format("Anime")}\').click()','!!document.querySelector(\'[data-lists-stats="anime"] [data-lists-stats-hero]\')'),
            ('anime list','document.querySelector("[data-lists-stats-button]").click()','!!document.querySelector(\'[data-lists-grid] [data-media-type="anime"]\')&&!document.querySelector("[data-lists-stats]")')]
        for _,action,done in steps: timed(page,action,done)  # warm-up round
        page.wait_for_timeout(500);before=heap(page,cdp);switches={name:[] for name,_,_ in steps}
        for _ in range(30):
            for name,action,done in steps: switches[name].append(timed(page,action,done)['paint'])
        page.wait_for_timeout(1500);after=heap(page,cdp)
        metrics['type_stats_switch_paint_ms']={name:spread(v) for name,v in switches.items()};metrics['heap_30_rounds']=dict(before=before,after=after)
        log(f'switches: {metrics["type_stats_switch_paint_ms"]}; heap {before} -> {after}')
        check('30 rounds of Anime | Manga | Stats end on the anime list, on the same tab',page.evaluate(SELECTED)==BIGGEST
              and page.locator('[data-lists-stats]').count()==0 and page.evaluate(CELLS)==60)
        check('30 rounds leave no growing heap, DOM or listeners (after GC)',after['heap_mb']-before['heap_mb']<3 and after['nodes']-before['nodes']<500
              and after['listeners']-before['listeners']<200,(before,after))

        # The longest list to its end, a step per frame
        page.evaluate('scrollTo(0,0)');page.wait_for_timeout(400)
        scroll=page.evaluate('__scrollToEnd(160,180000)');page.wait_for_timeout(1000)
        frames=scroll['frames'];longs=scroll['longs']
        end=dict(cells=page.evaluate(CELLS),cards=page.evaluate(CARDS),elements=page.evaluate(ELEMENTS),**heap(page,cdp))
        metrics['scroll_to_end']=dict(list=label(BIGGEST),entries=len(BY_KEY[BIGGEST]),ms=round(scroll['ms']),frames=spread(frames),
            frames_over_34ms=sum(1 for f in frames if f>34),long_tasks=spread(longs),long_task_ms_total=round(sum(longs)),max_cards_during=scroll['maxCards'],at_end=end)
        log(f'scroll: {metrics["scroll_to_end"]}')
        shot(page,'stress-lists-end.png')
        check('The scroll reaches the end of the longest list, every title rendered in order',scroll['end'] and end['cells']==len(BY_KEY[BIGGEST])
              and page.evaluate(TITLES)[-1]==titles(by_score(BY_KEY[BIGGEST]))[-1])
        check('Windowing keeps the mounted cards bounded during and after the scroll',scroll['maxCards']<=90 and end['cards']<=90,(scroll['maxCards'],end['cards']))
        first_id=by_score(BY_KEY[BIGGEST])[0]['media']['id']
        top=timed(page,'document.querySelector("[data-lists-top]").click()',f'!!document.querySelector(\'[data-phone-card="{first_id}"]\')')
        metrics['back_to_top_ms']=dict(commit=round(top['commit']),paint=round(top['paint']));page.wait_for_timeout(400)
        check('"Back to top" returns to the lists with the first covers',page.evaluate('document.querySelector(".pl-controls").getBoundingClientRect().top')<=30
              and page.evaluate(TITLES)[0]==titles(by_score(BY_KEY[BIGGEST]))[0])

        # Long press and Android Back
        menu=timed(page,f'document.querySelector(\'[data-lists-grid] [data-phone-card="{first_id}"]\').dispatchEvent(new MouseEvent("contextmenu",{{bubbles:true,clientX:200,clientY:600,button:2}}))',
            '!!document.querySelector("[role=menuitem]")')
        metrics['long_press_menu_ms']=dict(commit=round(menu['commit']),paint=round(menu['paint']));page.wait_for_timeout(300)
        check('Long press opens the card menu with 48px rows',page.evaluate(TEXT,'[role=menuitem]')[:1]==['Preview']
              and page.evaluate('[...document.querySelectorAll("[role=menuitem]")].every(e=>e.offsetHeight>=48)'))
        check('Android Back closes the card menu',back(page) is True and page.get_by_role('menuitem').count()==0)

        # Live search: 12 keys, one every 40 ms
        page.locator('[data-lists-search]').click();page.wait_for_timeout(400);page.evaluate('__recordSearch()')
        page.keyboard.type(QUERY,delay=40);page.wait_for_timeout(2000);rec=page.evaluate('__stopSearch()')
        expected=[signature(QUERY[:i+1],BIGGEST) for i in range(len(QUERY))]
        latencies=[];paints=[]
        for i,key in enumerate(rec['keys']):
            if i and expected[i]==expected[i-1]: continue
            t=key['t'] if key['now']-5000<key['t']<=key['now'] else key['now']
            seen=next((s for s in rec['states'] if s['t']>=t and s['sig'] in expected[i:]),None)
            latencies.append(round(seen['t']-t) if seen else None);paints.append(round(seen['paint']-t) if seen and 'paint' in seen else None)
        metrics['search']=dict(query=QUERY,cells_before=metrics['scroll_to_end']['at_end']['cells'],keys=len(rec['keys']),
            input_to_frame_ms=spread(rec['frames']),result_changes=len(latencies),input_to_result_commit_ms=latencies,input_to_result_paint_ms=paints,
            states_rendered=len(rec['states']),cells_per_result=[s['cells'] for s in rec['states']])
        log(f'search: {metrics["search"]}')
        final=hits(QUERY);chosen=selected_for(QUERY,BIGGEST)
        check('Every key reached the screen (12 keys)',len(rec['keys'])==len(QUERY) and len(rec['frames'])==len(QUERY),rec['keys'])
        check('Every result change reached the screen',None not in latencies and None not in paints,(latencies,paints))
        # After the scroll the grid held 950 cells; a new search starts at its first page instead of rendering every page again.
        check('Each search result renders at most one page of cells',all(s['cells']<=60 for s in rec['states']),[s['cells'] for s in rec['states']])
        check('The final result matches the last query: tab counts, followed list, titles',page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==tab_texts(QUERY)
              and page.evaluate(SELECTED)==chosen and page.evaluate(TITLES)==titles(by_score(dict(final)[chosen])),
              (page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]'),tab_texts(QUERY),page.evaluate(SELECTED),chosen))
        shot(page,'stress-lists-search.png')
        clear=timed(page,'document.querySelector(".ps-search-clear").click()',f'__sig()==={json.dumps(signature("",BIGGEST))}')
        metrics['search_clear_ms']=dict(commit=round(clear['commit']),paint=round(clear['paint']));page.wait_for_timeout(800)
        check('Clearing brings every list back on the remembered tab',page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==tab_texts()
              and page.evaluate(SELECTED)==BIGGEST and page.evaluate(TITLES)[:6]==titles(by_score(BY_KEY[BIGGEST]))[:6])
        metrics['after_search']=dict(cells=page.evaluate(CELLS),cards=page.evaluate(CARDS),elements=page.evaluate(ELEMENTS))
        page.evaluate('document.activeElement.blur();scrollTo(0,0)');page.wait_for_timeout(300)

        # Filter & sort sheet under rapid input
        sheet=timed(page,'document.querySelector("[data-lists-filter-button]").click()','!!document.querySelector("[data-lists-filters] [data-lists-genres] [data-chip]")')
        metrics['filter_sheet_open_ms']=dict(commit=round(sheet['commit']),paint=round(sheet['paint']));page.wait_for_timeout(500)
        genre_counts={g:sum(1 for e in BY_KEY[BIGGEST] if g in e['media']['genres']) for g in GENRES}
        check('Genre chips: all 18, each counting the shown list',page.evaluate(CHIPS,'[data-lists-genres] [data-chip]')==genre_counts)
        t0=time.perf_counter()
        for genre in TOGGLED: page.locator(f'[data-lists-genres] [data-chip="{genre}"]').click()
        page.wait_for_function(f'document.querySelector("[data-lists-filter-done]").textContent==="Show 0 anime"&&document.querySelectorAll("[data-lists-genres] [aria-pressed=true]").length===10')
        ten=round((time.perf_counter()-t0)*1000);page.wait_for_timeout(400)
        check('10 genres on in a row: every chip pressed, nothing has all ten, every tab says 0',page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==tab_texts(genres=TOGGLED)
              and page.locator('[data-lists-filter-button]').get_attribute('aria-label')=='Filter and sort, 10 active')
        t0=time.perf_counter()
        for genre in TOGGLED:
            if genre not in KEPT: page.locator(f'[data-lists-genres] [data-chip="{genre}"]').click()
        kept=dict(hits(genres=KEPT))[BIGGEST]
        page.wait_for_function(f'document.querySelector("[data-lists-filter-done]").textContent==="Show {len(kept)} anime"&&document.querySelectorAll("[data-lists-genres] [aria-pressed=true]").length===2')
        eight=round((time.perf_counter()-t0)*1000);page.wait_for_timeout(400)
        metrics['genre_toggles_ms']=dict(ten_on=ten,eight_off=eight)
        check('8 off again: the two kept genres pressed, counts and tabs right',sorted(page.evaluate('[...document.querySelectorAll("[data-lists-genres] [aria-pressed=true]")].map(c=>c.dataset.chip)'))==KEPT
              and page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==tab_texts(genres=KEPT)
              and page.locator('[data-lists-filter-button]').get_attribute('aria-label')=='Filter and sort, 2 active')
        sorts={}
        for value,text in SORTS[1:]:
            sorts[value]=round(timed(page,f'const s=document.querySelector("[data-lists-sort]");s.value="{value}";s.dispatchEvent(new Event("change",{{bubbles:true}}))',
                f'document.querySelector(".pl-select-text")?.textContent==="{text}"')['paint'])
        metrics['sort_change_paint_ms']=dict(spread(list(sorts.values())),each=sorts);page.wait_for_timeout(400)
        check('All 16 sorts, ending on "Last updated": the chosen one shown, the grid in that order',page.locator('[data-lists-sort]').input_value()=='UPDATED_AT_DESC'
              and page.evaluate(TITLES)[:12]==titles(by_updated(kept))[:12])
        t0=time.perf_counter()
        for value,_ in reversed(SORTS[:-1]): page.locator('[data-lists-sort]').select_option(value)
        page.wait_for_function('document.querySelector(".pl-select-text")?.textContent==="Highest score"');metrics['sorts_rapid_ms']=round((time.perf_counter()-t0)*1000)
        page.wait_for_timeout(400)
        check('15 sorts back in a row end on "Highest score", the grid by score, the sort remembered',page.evaluate(TITLES)[:12]==titles(by_score(kept))[:12]
              and page.evaluate('localStorage.getItem("sea-mobile-lists-sort-anime")')=='"SCORE_DESC"')
        shot(page,'stress-lists-sheet.png')
        reset=timed(page,'document.querySelector("[data-lists-filter-reset]").click()',f'document.querySelector("[data-lists-filter-done]").textContent==="Show {len(BY_KEY[BIGGEST])} anime"')
        metrics['filter_reset_ms']=dict(commit=round(reset['commit']),paint=round(reset['paint']));page.wait_for_timeout(400)
        check('Reset: no genre pressed, every count back, the sort kept',page.locator('[data-lists-genres] [aria-pressed=true]').count()==0
              and page.evaluate(TEXT,'[data-lists-status-tabs] [role=tab]')==tab_texts() and page.locator('[data-lists-sort]').input_value()=='SCORE_DESC'
              and page.locator('[data-lists-filter-reset]').count()==0)
        check('Sheet buttons are at least 48px with every chip of a long list',page.evaluate(SMALL,'.ps-sheet button')==[])
        check('Android Back closes the sheet',back(page) is True and page.evaluate(OPEN)==0)
        check('The grid after the sheet: the longest list by score, no filter line',page.evaluate(TITLES)[:6]==titles(by_score(BY_KEY[BIGGEST]))[:6]
              and page.locator('[data-lists-active-filters]').count()==0)

        # The whole screen with 1,500 titles
        check('No horizontal overflow',page.evaluate(NO_OVERFLOW))
        check('Every button and link is at least 48px',page.evaluate(SMALL,'[data-phone-screen] button,[data-phone-screen] a')==[])
        metrics['end']=heap(page,cdp)
        page.close()

        # The floor of this browser setup: the same scroll over a static grid of as many plain covers (no React, no windowing).
        page=browser.new_page(viewport=dict(width=390,height=844),device_scale_factor=3,has_touch=True,is_mobile=True)
        cdp=page.context.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',dict(rate=4));page.add_init_script(HELPERS)
        covers=''.join(f'<a class="ps-card" href="#"><span class="ps-card-cover"><img class="ps-cover-image" alt="" src="http://lists.test/cover/{e["media"]["id"]}.png" '
            f'style="position:absolute;inset:0;width:100%;height:100%"></span><span class="ps-card-title">{e["media"]["title"]["userPreferred"]}</span>'
            f'<span class="ps-card-meta">Fall 2020</span></a>' for e in BY_KEY[BIGGEST])
        page.route('http://lists.test/cover/**',lambda r:r.fulfill(content_type='image/png',headers={'Cache-Control':'max-age=3600'},
            body=COVERS[int(r.request.url.split('/')[-1].split('.')[0])%24]))
        page.route('http://lists.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
        page.route('http://lists.test/lists*',lambda r:r.fulfill(content_type='text/html',body=f'<html class="dark" lang="en"><head><meta name="viewport" '
            f'content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div data-phone-screen="lists"><div class="ps-grid">{covers}</div>'
            f'<button data-lists-top>Top</button></div></body></html>'))
        page.goto('http://lists.test/lists')
        for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
        page.add_style_tag(path=str(bundle.with_suffix('.css')));page.wait_for_timeout(1500)
        control=page.evaluate('__scrollToEnd(160,180000)')
        metrics['scroll_control_static']=dict(ms=round(control['ms']),frames=spread(control['frames']),frames_over_34ms=sum(1 for f in control['frames'] if f>34),
            long_tasks=spread(control['longs']))
        log(f'control scroll (static, no React): {metrics["scroll_control_static"]}')
        page.close();browser.close()
check('No script errors',errors==[],errors)
check('No React errors in the console',warnings==[],warnings[:5])
if out: (out/'metrics.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
print(json.dumps(dict(metrics=metrics,checks=checks),indent=2))
