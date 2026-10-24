"""Search tab (Android phones) under stress, without AniList: a synthetic AniList answers any variables with 25 pages of 48
(titles name the request they came from, ids repeat across pages), with random delays and failing pages. Headless Chromium
at 390x844 with touch, the CPU slowed 4x, React in production mode. Measures frames, long tasks, mounted cards, DOM nodes
and the JS heap through 25 pages of endless scrolling; races typing, sort and type switches, filter chips and links against
answers that arrive out of order; a failure storm while scrolling; the card menu and the filter sheet with Android Back;
overflow and 48px targets. Prints the numbers and the checks; exits 1 when a check fails. Optional arg: screenshot dir."""
from pathlib import Path
from web_build import WEB
from playwright.sync_api import sync_playwright
from PIL import Image, ImageColor, ImageDraw
import tempfile, subprocess, json, sys, io
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];numbers={}
def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok)))
    print(('PASS  ' if ok else 'FAIL  ')+name+('' if ok or detail is None else f'\n      {detail!r}'),flush=True)
def shot(page,name):
    if shots: page.screenshot(path=str(shots/name))
STATUS=dict(isOffline=False,settings=dict(anilist=dict(enableAdultContent=True,blurAdultContent=True),library=dict(enableOnlinestream=True)))
# Two synthetic results are on the user's lists, so some cards carry progress, status and score
COLLECTIONS=dict(animeListData={'1000004':dict(status='CURRENT',progress=3),'1000500':dict(status='COMPLETED',progress=12,score=80)},
    library=dict(lists=[]),manga=dict(lists=[]),chapters=dict(latestChapterNumbers={},storedProviders={},storedFilters={}))
FIXTURE=dict(serverStatus=STATUS,collections=COLLECTIONS,server=dict(total=0,delay=0,failNext=False),customSources=[],streaming=True,
    requests=[],routes=[],previews=[],playlist=[],explorer=[])
PAGES,PER,NEW=25,48,44
UNIQUE=PER+(PAGES-1)*NEW
# The synthetic AniList (mobile_search_stubs.tsx calls window.synthetic). Seeded, so a run repeats. Page 1 has results 0-47;
# each later page repeats the last 3 new results of the page before, then 22 new, the first new one of the page before
# (not adjacent), 22 new: 48 per page, 1104 different results in 25 pages. A title reads "<sig> <type> <search> <sort> #<n>";
# stress.sigs[sig] holds the variables of the request. stress.queue: delays used before the random ones. Exactly `failRate`
# of the requests for later pages fail, spread evenly (retries are requests too).
SYNTHETIC=r'''(() => {
    let seed = 20261021
    const random = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
    const stress = window.stress = { minDelay: 50, maxDelay: 300, failRate: 0, pages: 25, queue: [], sigs: {}, sent: 0, answered: [], failed: 0, inFlight: 0, debt: 0 }
    const hash = text => { let h = 5381; for (let i = 0; i < text.length; i++) h = Math.imul(h, 33) ^ text.charCodeAt(i); return (h >>> 0).toString(36) }
    const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"]
    const fresh = page => page === 1 ? 0 : 48 + (page - 2) * 44
    const indices = page => {
        if (page === 1) return Array.from({ length: 48 }, (_, i) => i)
        const start = fresh(page), news = Array.from({ length: 44 }, (_, i) => start + i)
        return [start - 3, start - 2, start - 1, ...news.slice(0, 22), fresh(page - 1), ...news.slice(22)]
    }
    window.synthetic = async (endpoint, request) => {
        const { page, perPage, ...variables } = request
        const type = endpoint.includes("/manga/") ? "manga" : "anime"
        const sig = hash(JSON.stringify([type, variables]))
        stress.sigs[sig] = { type, ...variables }
        const number = ++stress.sent
        const delay = stress.queue.length ? stress.queue.shift() : stress.minDelay + random() * (stress.maxDelay - stress.minDelay)
        let fail = false
        if (page > 1 && stress.failRate && (stress.debt += stress.failRate) >= 1) { stress.debt -= 1; fail = true }
        stress.inFlight++
        await new Promise(resolve => setTimeout(resolve, delay))
        stress.inFlight--
        stress.answered.push(number)
        if (fail) { stress.failed++; throw new Error("Synthetic page failed") }
        const manga = type === "manga", base = manga ? 2000000 : 1000000
        const media = indices(page).map(i => ({
            id: base + i, idMal: base + i, isAdult: false, status: i % 8 === 7 ? "RELEASING" : "FINISHED",
            title: { userPreferred: `${sig} ${type} ${variables.search ?? "-"} ${variables.sort.join("+")} #${i}` },
            coverImage: { large: `/cover/${base + i}.jpg` }, format: manga ? "MANGA" : "TV", startDate: { year: 2000 + i % 25 },
            ...(manga ? { chapters: 50 + i % 200 } : { season: SEASONS[i % 4], seasonYear: 2000 + i % 25, episodes: 12 + i % 24 }),
        }))
        return { Page: { pageInfo: { currentPage: page, hasNextPage: page < stress.pages, total: stress.pages * perPage, perPage }, media } }
    }
})()'''
# Covers as AniList serves them: a 230x345 JPEG per result (360 different ones), decoded like real covers
JPEGS={}
def jpeg(n):
    if n not in JPEGS:
        hue=n*47%360;img=Image.new('RGB',(230,345),ImageColor.getrgb(f'hsl({hue},32%,30%)'));draw=ImageDraw.Draw(img)
        draw.ellipse((98,70,198,170),fill=ImageColor.getrgb(f'hsl({hue},45%,56%)'))
        for k in range(60): draw.rectangle(((k*37)%230,(k*53)%345,(k*37)%230+14,(k*53)%345+10),fill=ImageColor.getrgb(f'hsl({(hue+k*7)%360},40%,{20+k%50}%)'))
        data=io.BytesIO();img.save(data,'JPEG',quality=85);JPEGS[n]=data.getvalue()
    return JPEGS[n]
SHELL='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
# AndroidNavigation.backScript: what the app runs when the Android Back button is pressed.
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>b.textContent||b.getAttribute("aria-label")))'''
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
OPEN='document.querySelectorAll(".UI-Modal__content[data-state=open]").length'
IDLE='!document.querySelector(".pq-grid[aria-busy=true],[data-search-results] .ps-loading,[data-search-loading-more]")'
SIGS='[...new Set([...document.querySelectorAll("[data-phone-card] .ps-card-title")].map(e=>e.textContent.split(" ")[0]))]'
IDS='[...document.querySelectorAll("[data-phone-card]")].map(c=>c.getAttribute("data-phone-card"))'
COUNT='document.querySelector("[data-search-results] h2").textContent.replace(/[^0-9+]/g,"")'
# Cells of the grid that cross the screen but show no card (a blank hole while scrolling)
HOLES='[...document.querySelectorAll(".pq-grid > *")].filter(c=>{const r=c.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&!c.querySelector("[data-phone-card]")&&!c.matches("[data-phone-card]")}).length'
# Answers that arrived after an answer to a later request: the race is real
OUT_OF_ORDER='stress.answered.filter((n,i,a)=>a.slice(0,i).some(m=>m>n)).length'
# Scrolls by `step` px a frame until "That's all" is in sight, noting every frame; a failed page gets "Try again" after
# `retryAfter` ms, as a user would. Frames after a frame that moved the page count as scrolling frames.
SCROLL=r'''async ({step, timeout, retryAfter}) => {
    const t0 = performance.now(), frames = [], moving = []
    let last = t0, moved = false, errorAt = 0, retries = 0, failures = 0, alert = null
    return await new Promise(resolve => {
        const done = (finished, now) => resolve({ frames, moving, ms: now - t0, finished, retries, failures, alert })
        const tick = now => {
            frames.push(now - last)
            if (moved) moving.push(now - last)
            last = now
            const bottom = scrollY + innerHeight >= document.documentElement.scrollHeight - 2
            if (document.querySelector("[data-search-end]") && bottom) return done(true, now)
            if (now - t0 > timeout) return done(false, now)
            const retry = document.querySelector("[data-search-more-error] [data-search-load-more]")
            if (retry) {
                if (!errorAt) { errorAt = now; failures++; alert = alert ?? document.querySelector("[data-search-more-error] [role=alert]")?.textContent }
                else if (now - errorAt > retryAfter) { retry.click(); retries++; errorAt = 0 }
            } else errorAt = 0
            const y = scrollY
            scrollBy(0, step)
            moved = scrollY !== y
            requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
    })
}'''
# A fast fling upwards (`step` px a frame): frames in which the middle column shows an empty cell at one of three heights
FLING=r'''async ({step, limit}) => {
    const frames = []; let last = performance.now(), blank = 0
    return await new Promise(resolve => {
        const tick = now => {
            frames.push(now - last); last = now
            if ([200, 420, 640].some(y => document.elementFromPoint(195, y)?.matches(".pq-cell:empty"))) blank++
            if (frames.length >= limit || scrollY <= 0) return resolve({ frames: frames.slice(1), blank })
            scrollBy(0, -step)
            requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
    })
}'''
LONG_TASKS='window.longTasks=[];new PerformanceObserver(l=>{for(const e of l.getEntries())longTasks.push(e.duration)}).observe({type:"longtask"})'
# Frames while something else drives the page (typing)
REC_START='window.rec={frames:[],on:true,last:performance.now()};(function f(now){if(!rec.on)return;rec.frames.push(now-rec.last);rec.last=now;requestAnimationFrame(f)})(performance.now())'
REC_STOP='(rec.on=false,rec.frames.slice(1))'
# Taps by text, `gap` ms apart (a click event, which the chips and tabs listen to), timed in the page
TAPS=r'''async ({sel, labels, gap}) => { for (const label of labels) { [...document.querySelectorAll(sel)].find(b => b.textContent.trim() === label).click(); await new Promise(r => setTimeout(r, gap)) } }'''
def stats(frames):
    s=sorted(frames);n=len(s)
    if not n: return dict(frames=0)
    at=lambda q:round(s[min(n-1,int(q*n))],1)
    return dict(frames=n,p50=at(.5),p95=at(.95),max=round(s[-1],1),over34=sum(f>34 for f in s),over50=sum(f>50 for f in s))
def reqs(page): return page.evaluate('requests')
def settle(page,extra=1000):
    # Every answer in, late ones included, and nothing loading
    page.wait_for_function(IDLE+'&&stress.inFlight===0',timeout=60000);page.wait_for_timeout(extra);page.wait_for_function(IDLE,timeout=60000)
def until(page,expr,timeout=8000):
    try: page.wait_for_function(expr,timeout=timeout);return True
    except Exception: return False
def grid(page): return [page.evaluate('s=>stress.sigs[s]',s) for s in page.evaluate(SIGS)]
def focus(page,attr): return page.evaluate(f'!!document.activeElement?.hasAttribute("{attr}")')
DEFAULT=dict(type='anime',sort=['SCORE_DESC'],isAdult=False)

with tempfile.TemporaryDirectory(prefix='seanime-search-stress-') as tmp:
    bundle=Path(tmp)/'search.js'
    subprocess.run(['node',str(root/'tests/mobile_search_bundle.cjs'),str(bundle),'production'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,args=['--enable-precise-memory-info'])
        def open_page(delays=(50,300),fail=0.0,query='',pages=PAGES):
            page=browser.new_page(viewport=dict(width=390,height=844),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.on('console',lambda m:errors.append('console: '+m.text[:300]) if m.type=='error' else None)
            cdp=page.context.new_cdp_session(page)
            cdp.send('Emulation.setCPUThrottlingRate',dict(rate=4))
            page.add_init_script('Object.assign(window,%s)'%json.dumps(FIXTURE))
            page.add_init_script(SYNTHETIC)
            page.add_init_script('Object.assign(stress,%s)'%json.dumps(dict(minDelay=delays[0],maxDelay=delays[1],failRate=fail,pages=pages)))
            page.route('http://search.test/cover/**',lambda r:r.fulfill(content_type='image/jpeg',body=jpeg(int(r.request.url.split('/')[-1].split('.')[0])%360)))
            page.route('http://search.test/search*',lambda r:r.fulfill(content_type='text/html',body=SHELL))
            page.route('http://search.test/static/**',lambda r:r.fulfill(path=str(WEB/r.request.url.split('search.test/')[1])))
            page.goto(f'http://search.test/search{query}')
            for css in (WEB/'static/css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator('[data-phone-card]').first.wait_for(timeout=60000);settle(page,300)
            return page,cdp
        def dom(page,cdp):
            cdp.send('HeapProfiler.collectGarbage')
            counters=cdp.send('Memory.getDOMCounters')
            return dict(cards=page.locator('[data-phone-card]').count(),elements=page.evaluate('document.getElementsByTagName("*").length'),
                nodes=counters['nodes'],listeners=counters['jsEventListeners'],images=page.evaluate('document.images.length'),
                heapMB=round(page.evaluate('performance.memory.usedJSHeapSize')/2**20,1))
        def back(page):
            ok=page.evaluate(NATIVE_BACK);page.wait_for_timeout(350);return ok
        def scroll(page,retry_after=300):
            page.evaluate(LONG_TASKS)
            run=page.evaluate(SCROLL,dict(step=60,timeout=240000,retryAfter=retry_after))
            run['longTasks']=page.evaluate('longTasks')
            return run

        # 1. Endless scrolling through 25 pages
        p,cdp=open_page()
        numbers['start']=dom(p,cdp)
        run=scroll(p)
        settle(p,300)
        end=dom(p,cdp)
        ids=p.evaluate(IDS)
        pages=[r['page'] for r in reqs(p)]
        numbers['scroll']=dict(seconds=round(run['ms']/1000,1),all=stats(run['frames']),scrolling=stats(run['moving']),
            longTasks=len(run['longTasks']),longTaskMs=round(sum(run['longTasks'])),longestTask=round(max(run['longTasks'],default=0)),requests=len(pages))
        numbers['end']=end
        check('Scrolling reaches "That\'s all" after 25 pages',run['finished'] and p.locator('[data-search-end]').inner_text()=="That's all",run['ms'])
        check('Each page is asked for once, in order',pages==list(range(1,PAGES+1)),pages)
        check(f'Results counted once each: {UNIQUE} of {PAGES*PER} answers (repeats dropped)',p.evaluate(COUNT)==str(UNIQUE),p.evaluate(COUNT))
        check('No card shows twice',len(ids)==len(set(ids)),len(ids)-len(set(ids)))
        check('The grid is the default search',grid(p)==[DEFAULT],grid(p))
        check('No page overflow sideways after 1104 results',p.evaluate(NO_OVERFLOW))
        check('Every button, link and field is at least 48px',p.evaluate(SMALL,'[data-phone-screen] button,[data-phone-screen] a,[data-phone-screen] input')==[])
        shot(p,'stress-end-390.png')
        fling=p.evaluate(FLING,dict(step=150,limit=400))
        numbers['fling']=dict(pxPerFrame=150,blankFrames=fling['blank'],**stats(fling['frames']))
        check('A fast fling up (150 px a frame) never shows a blank cell',fling['blank']==0,fling['blank'])
        p.evaluate('scrollTo(0,document.documentElement.scrollHeight)');p.wait_for_timeout(400)
        # A jump into the middle (a fling, the scrollbar) must not show blank cells
        p.evaluate('scrollTo(0,document.documentElement.scrollHeight*.5)');p.wait_for_timeout(400)
        check('A jump to the middle shows cards, no blank cells',p.evaluate(HOLES)==0,p.evaluate(HOLES))
        y=p.evaluate('scrollY')
        target=p.evaluate('[...document.querySelectorAll("[data-phone-card]")].find(c=>{const r=c.getBoundingClientRect();return r.top>120&&r.bottom<innerHeight-160})?.getAttribute("data-phone-card")')
        box=p.locator(f'[data-phone-card="{target}"]').bounding_box()
        p.locator(f'[data-phone-card="{target}"]').dispatch_event('contextmenu',dict(clientX=box['x']+20,clientY=box['y']+40,button=2))
        p.get_by_role('menuitem',name='Preview').wait_for();p.wait_for_timeout(300)
        check('Long press deep in the results opens the card menu',p.evaluate(TEXT,'[role=menu] [role=menuitem]')==['Preview'])
        shot(p,'stress-card-menu-390.png')
        check('Android Back closes the card menu (native script) and keeps the place',back(p) is True and p.locator('[role=menu]').count()==0
              and abs(p.evaluate('scrollY')-y)<=2 and p.locator(f'[data-phone-card="{target}"]').count()==1,[p.evaluate('scrollY'),y])
        p.locator('[data-search-filter-button]').click();p.locator('[data-search-filters]').wait_for();p.wait_for_timeout(350)
        n=len(reqs(p))
        check('Android Back closes the filter sheet; nothing changed, nothing asked',back(p) is True and p.evaluate(OPEN)==0 and len(reqs(p))==n)
        check('Android Back with nothing open leaves the page to the app',back(p) is False)
        # Back from an entry page deep in the results: the same covers at the same place, no blank cells
        p.evaluate('scrollTo(0,document.documentElement.scrollHeight*.7)');p.wait_for_timeout(400)
        target=p.evaluate('[...document.querySelectorAll("[data-phone-card]")].find(c=>c.getBoundingClientRect().top>120)?.getAttribute("data-phone-card")')
        y=p.evaluate('scrollY');top=p.evaluate(f'document.querySelector(\'[data-phone-card="{target}"]\').getBoundingClientRect().top')
        n=len(reqs(p))
        p.locator(f'[data-phone-card="{target}"]').click();p.locator('[data-other-page]').wait_for()
        p.evaluate('history.back()');p.locator('[data-phone-card]').first.wait_for();p.wait_for_timeout(700)
        after=p.evaluate(f'document.querySelector(\'[data-phone-card="{target}"]\')?.getBoundingClientRect().top')
        # The pixels may differ (cells never shown are only about a card high); the covers in sight must not
        check('Back from an entry page deep in the results: the same covers at the same place, no blank cells, nothing asked again',
              after is not None and abs(after-top)<=12 and p.evaluate(HOLES)==0 and len(reqs(p))==n,[p.evaluate('scrollY'),y,after,top,p.evaluate(HOLES)])
        shot(p,'stress-back-deep-390.png')
        p.evaluate('scrollTo(0,document.documentElement.scrollHeight*.5)');p.wait_for_timeout(300)
        p.locator('[data-search-top]').click();p.wait_for_function('scrollY===0',timeout=5000);p.wait_for_timeout(400)
        check('Back to top shows the first covers again',p.locator('[data-phone-card="1000000"]').is_visible() and p.evaluate(HOLES)==0)
        p.close()

        # 2. Typing against random delays (50-900 ms), answers out of order, clearing quickly
        p,cdp=open_page(delays=(50,900))
        field=p.locator('[data-search-field]')
        n=len(reqs(p))
        p.evaluate(REC_START);field.press_sequentially('attack on titan',delay=50);typing=p.evaluate(REC_STOP)
        during=len(reqs(p))-n
        # The slowed CPU also delays timers (the 400 ms pause fires after up to ~650 ms): wait for the search, not a fixed time
        until(p,f'requests.length>{n}');settle(p)
        sent=[r.get('search') for r in reqs(p)[n:]]
        numbers['typing']=dict(keys=15,requestsWhileTyping=during,requests=len(sent),frames=stats(typing))
        check('15 keys 50 ms apart: nothing while typing, one search after the pause',during==0 and sent==['attack on titan'],sent)
        check('The grid and the title are the final words',grid(p)==[dict(type='anime',sort=['SEARCH_MATCH','SCORE_DESC'],search='attack on titan',isAdult=False)]
              and p.locator('[data-phone-facts]').inner_text()=='Results for “attack on titan”',grid(p))
        n=len(reqs(p))
        p.locator('.ps-search-clear').click();p.wait_for_timeout(80)
        check('Clearing shows the search without words at once (from the cache)',grid(p)==[DEFAULT] and p.locator('.pq-grid[aria-busy=true]').count()==0)
        settle(p)
        check('… and asks nothing',len(reqs(p))==n,reqs(p)[n:])
        # Older answers land last: "eren" and "eren y" take 900 ms, "eren ye" 50 ms
        n=len(reqs(p));order=len(p.evaluate('stress.answered'))
        p.evaluate('stress.queue=[900,900,50]')
        for piece in ('eren',' y','e'):
            before=len(reqs(p));field.press_sequentially(piece,delay=50);until(p,f'requests.length>{before}')
        settle(p,1200)
        sent=[r.get('search') for r in reqs(p)[n:]]
        late=p.evaluate(f'stress.answered.slice({order}).filter((n,i,a)=>a.slice(0,i).some(m=>m>n)).length')
        numbers['typing']['outOfOrderAnswers']=late
        check('Pauses between words: one search per pause',sent==['eren','eren y','eren ye'],sent)
        check('An older answer landed after the newest (the race happened)',late>=1,late)
        check('… and does not overwrite the grid: it shows "eren ye"',grid(p)==[dict(type='anime',sort=['SEARCH_MATCH','SCORE_DESC'],search='eren ye',isAdult=False)]
              and field.input_value()=='eren ye',grid(p))
        # Cleared while the answer is on its way
        p.evaluate('stress.queue=[900]');n=len(reqs(p))
        field.fill('');settle(p,200)
        before=len(reqs(p));field.press_sequentially('mikasa',delay=50);until(p,f'requests.length>{before}');p.locator('.ps-search-clear').click();settle(p,1200)
        check('Cleared while "mikasa" was on its way: its late answer does not come back',[r.get('search') for r in reqs(p)[n:]]==['mikasa'] and grid(p)==[DEFAULT]
              and field.input_value()=='' and p.locator('[data-phone-facts]').inner_text()=='Highest rated anime',grid(p))
        n=len(reqs(p))
        field.press_sequentially('armin',delay=50);p.locator('.ps-search-clear').click();settle(p,900)
        check('Cleared before the pause: no search for it at all',len(reqs(p))==n and grid(p)==[DEFAULT],reqs(p)[n:])
        numbers['typing']['outOfOrderTotal']=p.evaluate(OUT_OF_ORDER)
        p.close()

        # 3. Sort chips and Anime / Manga, tapped 80 ms apart against random delays
        p,cdp=open_page(delays=(50,900))
        n=len(reqs(p))
        labels=['Trending','Popular','Newest','Most episodes','Highest score']
        taps=[labels[(i*3+1)%5] for i in range(19)];taps.append('Popular' if taps[-1]!='Popular' else 'Trending')
        p.evaluate(TAPS,dict(sel='[data-search-sort] button',labels=taps,gap=80))
        settle(p,1200)
        final=taps[-1];sort={'Popular':'POPULARITY_DESC','Trending':'TRENDING_DESC'}[final]
        made=reqs(p)[n:]
        numbers['sort']=dict(taps=len(taps),requests=len(made),outOfOrderAnswers=p.evaluate(OUT_OF_ORDER))
        check(f'20 sort taps: the last ({final}) is chosen, named, and its results are shown',p.evaluate(TEXT,'[data-search-sort] [aria-checked=true]')==[final]
              and p.locator('[data-phone-facts]').inner_text()==f'{final} anime' and grid(p)==[dict(type='anime',sort=[sort],isAdult=False)],grid(p))
        check('One request per sort at most (answers are shared and kept)',len(made)<=4 and len({json.dumps(r,sort_keys=True) for r in made})==len(made),made)
        n=len(reqs(p))
        p.evaluate(TAPS,dict(sel='[data-search-type-tabs] [role=tab]',labels=['Manga','Anime']*10,gap=80))
        settle(p,1200)
        made=reqs(p)[n:]
        numbers['type']=dict(taps=20,requests=len(made))
        check('20 Anime / Manga switches: anime with the same sort, its results, its field',p.locator('[data-search-type-tabs] [aria-selected=true]').inner_text()=='Anime'
              and grid(p)==[dict(type='anime',sort=[sort],isAdult=False)] and p.locator('[data-search-field]').get_attribute('placeholder')=='Search anime'
              and p.evaluate(TEXT,'[data-search-sort] [aria-checked=true]')==[final],grid(p))
        check('… with one manga request at most',len(made)<=1 and all(r['endpoint']=='/api/v1/manga/anilist/list' for r in made),made)
        p.close()

        # 4. Every filter and 15 tags, chips removed quickly, links pushed while the page is open
        p,cdp=open_page(delays=(50,900))
        p.locator('[data-search-filter-button]').click();p.locator('[data-search-filters]').wait_for();p.wait_for_timeout(350)
        genres=['Action','Adventure','Comedy','Drama','Fantasy']
        for genre in genres: p.locator(f'[data-search-genres] [data-chip="{genre}"]').click()
        p.locator('[data-search-format] [data-chip="TV"]').click();p.locator('[data-search-season] [data-chip="FALL"]').click()
        p.locator('[data-search-year]').select_option('2024');p.locator('[data-search-status] [data-chip="RELEASING"]').click()
        p.locator('[data-search-score]').select_option('7')
        tags=[]
        for q in ('ma','ti','sc','ar','sp','mu','sw','de','fo','ro','va','ni','zo','ga','id','a','e','o'):
            if len(tags)==15: break
            p.locator('[data-search-tag-field]').fill(q);p.wait_for_timeout(60)
            chip=p.locator('[data-search-tags] [aria-pressed=false]').first
            if chip.count(): tags.append(chip.get_attribute('data-chip'));chip.click()
        p.locator('[data-search-tag-field]').fill('');p.wait_for_timeout(60)
        check('15 tags found by searching and chosen; they lead the tag chips',len(tags)==15 and p.evaluate(TEXT,'[data-search-tags] [aria-pressed=true]')==tags,tags)
        n=len(reqs(p))
        p.locator('[data-search-show]').click();p.locator('[data-search-filters]').wait_for(state='detached');settle(p)
        want=dict(type='anime',sort=['SCORE_DESC'],isAdult=False,status=['RELEASING'],genres=genres,tags=tags,format='TV',season='FALL',seasonYear=2024,averageScore_greater=70)
        check('Show results: one request with everything',len(reqs(p))==n+1 and grid(p)==[want],[reqs(p)[n:],grid(p)])
        chips=p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')
        check('25 removable chips in one row, the filter button counts them',len(chips)==25 and p.locator('[data-search-filter-button]').get_attribute('aria-label')=='Filters, 25 active'
              and p.evaluate('(()=>{const r=document.querySelector("[data-search-active-filters]");return new Set([...r.children].map(e=>Math.round(e.getBoundingClientRect().top))).size===1})()'),chips)
        check('25 chips: no page overflow, 48px targets',p.evaluate(NO_OVERFLOW) and p.evaluate(SMALL,'[data-phone-screen] button,[data-phone-screen] a,[data-phone-screen] input')==[])
        shot(p,'stress-filters-390.png')
        n=len(reqs(p))
        removed=p.evaluate('''async gap=>{let n=0;while(n<80){const chip=document.querySelector("[data-search-active-filters] .pq-chip");if(!chip)break;chip.click();n++;await new Promise(r=>setTimeout(r,gap))}return n}''',40)
        settle(p,1200)
        numbers['chips']=dict(chips=25,taps=removed,requests=len(reqs(p))-n,outOfOrderAnswers=p.evaluate(OUT_OF_ORDER))
        check('Chips removed 40 ms apart: none left, the default search shows',p.locator('[data-search-active-filters]').count()==0 and grid(p)==[DEFAULT]
              and p.locator('[data-phone-facts]').inner_text()=='Highest rated anime' and p.locator('[data-search-filter-button]').get_attribute('aria-label')=='Filters',grid(p))
        check('… and the focus is on the filter button, not lost',focus(p,'data-search-filter-button'))
        urls=['/search?genre=Action','/search?sorting=TRENDING_DESC&type=manga','/search?q=naruto','/search?format=MOVIE&year=2010',
            '/search?season=SPRING&year=2023&genre=Comedy','/search?type=manga&country=KR&status=FINISHED','/search?tags=Isekai,Time%20Skip&sorting=POPULARITY_DESC',
            '/search?genre=Hentai','/search?q=one%20piece&type=manga','/search?type=manga&sorting=TRENDING_DESC&genre=Drama,Romance&country=KR&year=2019&status=FINISHED&q=love']
        n=len(reqs(p))
        p.evaluate('async urls=>{for(const url of urls){navigate(url);await new Promise(r=>setTimeout(r,30))}}',urls)
        settle(p,1200)
        numbers['links']=dict(links=len(urls),requests=len(reqs(p))-n,outOfOrderAnswers=p.evaluate(OUT_OF_ORDER))
        want=dict(type='manga',sort=['SEARCH_MATCH','TRENDING_DESC'],search='love',isAdult=False,status=['FINISHED'],genres=['Drama','Romance'],year=2019,countryOfOrigin='KR')
        check('10 links 30 ms apart: the page is the last link',grid(p)==[want] and p.locator('[data-search-field]').input_value()=='love'
              and p.locator('[data-search-type-tabs] [aria-selected=true]').inner_text()=='Manga' and p.evaluate(TEXT,'[data-search-sort] [aria-checked=true]')==['Trending']
              and p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')==['Drama','Romance','2019','Finished','South Korea']
              and p.locator('[data-phone-facts]').inner_text()=='Results for “love”',[grid(p),p.evaluate(TEXT,'[data-search-active-filters] .pq-chip')])
        p.close()

        # 5. Back deep in a short grid (3 pages, every card kept): covers not drawn yet after Back stand in at 15rem
        p,cdp=open_page(pages=3)
        p.evaluate(SCROLL,dict(step=120,timeout=120000,retryAfter=300));settle(p,300)
        p.evaluate('scrollTo(0,document.documentElement.scrollHeight*.9)');p.wait_for_timeout(400)
        target=p.evaluate('[...document.querySelectorAll("[data-phone-card]")].find(c=>c.getBoundingClientRect().top>120)?.getAttribute("data-phone-card")')
        top=p.evaluate(f'document.querySelector(\'[data-phone-card="{target}"]\').getBoundingClientRect().top')
        p.locator(f'[data-phone-card="{target}"]').click();p.locator('[data-other-page]').wait_for()
        p.evaluate('history.back()');p.locator('[data-phone-card]').first.wait_for();p.wait_for_timeout(700)
        after=p.evaluate(f'document.querySelector(\'[data-phone-card="{target}"]\')?.getBoundingClientRect().top')
        check(f'Back deep in {p.evaluate(COUNT)} results (all kept): the same covers at the same place',p.locator('[data-phone-card]').count()==PER+2*NEW
              and after is not None and abs(after-top)<=12,[after,top])
        p.close()

        # 6. Failure storm: 30 % of the later pages fail while scrolling
        p,cdp=open_page(delays=(50,300),fail=.3)
        run=scroll(p,retry_after=250)
        settle(p,300)
        ids=p.evaluate(IDS);made=reqs(p);failed=p.evaluate('stress.failed')
        numbers['failures']=dict(seconds=round(run['ms']/1000,1),failed=failed,retries=run['retries'],requests=len(made),scrolling=stats(run['moving']),
            longTasks=len(run['longTasks']),cards=len(ids))
        check('Failures were shown as "More results could not be loaded."',failed>0 and run['alert']=='More results could not be loaded.',[failed,run['alert']])
        check('Try again recovers every time: "That\'s all" at the end, no dead end',run['finished'] and p.locator('[data-search-end]').count()==1,run['ms'])
        check('One request per answer: the pages plus one per failure, never two at once',len(made)==PAGES+failed and run['retries']==failed
              and sorted({r['page'] for r in made})==list(range(1,PAGES+1)),[len(made),failed,run['retries']])
        check(f'No duplicates after the storm: {UNIQUE} results, every card once',p.evaluate(COUNT)==str(UNIQUE) and len(ids)==len(set(ids)),[p.evaluate(COUNT),len(ids)-len(set(ids))])
        p.close()
        browser.close()

check('No script errors on any page',errors==[],errors)
print(json.dumps(numbers,indent=1))
failed=[c['name'] for c in checks if not c['passed']]
print(f'{len(checks)-len(failed)}/{len(checks)} checks passed')
sys.exit(1 if failed else 0)
