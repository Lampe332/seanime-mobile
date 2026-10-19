"""Headless Android-size stress of the production Home bundle. No user data writes.

Device backend must be forwarded to localhost:14321. Controlled stress cards stay
inside this browser context; this is not a Samsung frame-performance benchmark.
"""
import argparse
import asyncio
import copy
import json
import re
from collections import Counter
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    root=Path(__file__).resolve().parents[1];out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    bundle=root/'backend/seanime-web/out';origin='http://127.0.0.1:14321'
    results=[];errors=[];requests=Counter();mode='real';fixture=None;blocked=[]
    anime_cards='[data-library-collection-lists-container] [data-media-entry-card-container]'
    def record(name,ok,detail=None):
        results.append(dict(name=name,passed=bool(ok),detail=detail))
        (out/'stress-checks.json').write_text(json.dumps(results,indent=2),encoding='utf8')
        if not ok:raise AssertionError(name)
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(viewport={'width':384,'height':823},has_touch=True,is_mobile=True,device_scale_factor=1)
        page=await context.new_page();page.set_default_timeout(20000)
        page.on('pageerror',lambda e:errors.append(str(e)))
        async def route(request):
            nonlocal fixture
            path=request.request.url.removeprefix(origin).split('?')[0]
            requests[(request.request.method,path)]+=1
            file=bundle/('index.html' if path=='/' or not path.startswith(('/api/','/static/','/icons/','/jassub/','/fonts/')) and '.' not in path else path.lstrip('/'))
            if path=='/api/v1/library/collection' and mode=='many':
                await request.fulfill(json=fixture);return
            if path.startswith('/api/'):
                if request.request.method not in ('GET','HEAD','OPTIONS'):
                    # Read queries are POST in parts of Seanime. No mutation is forwarded.
                    if path=='/api/v1/manga/preferences/import':
                        await request.fulfill(json={'data':{}});return
                    readonly=any(word in path for word in ('/entry','/collection','/episode-list','/get-','/history')) or path in ('/api/v1/announcements','/api/v1/extensions/all','/api/v1/anilist/list-recent-anime')
                    if not readonly or path=='/api/v1/status/home-items':
                        blocked.append(path);(out/'stress-blocked.json').write_text(json.dumps(blocked,indent=2))
                        await request.fulfill(status=409,json={'error':'Writes disabled in isolated stress context'});return
                await request.fulfill(response=await request.fetch());return
            if file.is_file():await request.fulfill(path=str(file));return
            await request.fulfill(response=await request.fetch())
        await page.route(origin+'/**',route)
        await page.add_init_script("window.SeanimeAndroid={getAppVersion:()=> '1.9.4',setLanguage:()=>{}}")
        native=(root/'app/src/main/java/com/seanime/app/UIHomePatch.kt').read_text(encoding='utf8')
        for js in re.findall(r'val js = """(.*?)"""\.trimIndent\(\)',native,re.S):
            await page.add_init_script("document.addEventListener('DOMContentLoaded',()=>{"+js.replace("${'$'}",'$')+"})")
        await page.goto(origin);await page.locator('[data-home-episode-card]').first.wait_for()
        library=await page.evaluate("fetch('/api/v1/library/collection').then(r=>r.json())")
        record('Production bundle renders real Home at phone size',await page.locator('[data-home-mobile]').count()==1)
        original_anime_ids=await page.locator(anime_cards).evaluate_all('es=>es.map(e=>e.dataset.mediaId).sort()')
        for size in [(320,740),(384,823),(740,360)]:
            await page.set_viewport_size({'width':size[0],'height':size[1]})
            for _ in range(8):
                await page.evaluate("window.scrollTo(0,document.scrollingElement.scrollHeight);document.querySelector('.home-resume-row').scrollLeft=10000")
                await page.wait_for_timeout(30)
                await page.evaluate("window.scrollTo(0,0);document.querySelector('.home-resume-row').scrollLeft=0")
                await page.wait_for_timeout(30)
            record(f'Fast bidirectional scroll and horizontal rows at {size[0]}x{size[1]}',await page.locator('[data-home-episode-card]').count()==2 and await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
        await page.set_viewport_size({'width':384,'height':823})
        await page.screenshot(path=str(out/'immersive-headless.png'))
        for _ in range(20):
            await page.locator('[data-library-toolbar-switch-view-button]').click()
            await page.locator('.home-mobile-settings').first.wait_for()
            await page.keyboard.press('Escape')
            await page.locator('.home-mobile-settings').wait_for(state='hidden')
        record('20 rapid customization open/close cycles leave no modal',await page.locator('.home-mobile-settings').count()==0)
        for _ in range(15):
            genre=page.locator('.home-genre-row button').first
            await genre.click();await genre.click()
        await page.wait_for_timeout(400)
        genre_state=await page.locator('.home-genre-row button').evaluate_all("es=>es.map(e=>[e.textContent,e.getAttribute('aria-pressed')])")
        await page.screenshot(path=str(out/'stress-genre.png'))
        current_anime_ids=await page.locator(anime_cards).evaluate_all('es=>es.map(e=>e.dataset.mediaId).sort()')
        record('30 rapid genre toggles restore all real anime cards',current_anime_ids==original_anime_ids,{'animeCards':len(current_anime_ids),'genres':genre_state})
        counts_before=requests.copy()
        for _ in range(10):
            await page.reload();await page.locator('[data-home-episode-card]').first.wait_for()
        record('10 full Home reopens retain the real content',await page.locator(anime_cards).evaluate_all('es=>es.map(e=>e.dataset.mediaId).sort()')==original_anime_ids,{'homeQueries':requests[('GET','/api/v1/status/home-items')]-counts_before[('GET','/api/v1/status/home-items')],'libraryQueries':requests[('GET','/api/v1/library/collection')]-counts_before[('GET','/api/v1/library/collection')]})
        record('Closed customization dialog does not refetch Home settings on each reopen',requests[('GET','/api/v1/status/home-items')]-counts_before[('GET','/api/v1/status/home-items')]==10)
        fixture=copy.deepcopy(library);source=fixture['data']['stream']['anime'][0]
        fixture['data']['stream']=None
        fixture['data']['continueWatchingList']=library['data']['stream']['continueWatchingList']
        entries=[]
        for i in range(96):
            media=copy.deepcopy(source);media['id']=9000000+i;media['title']={'userPreferred':f'CONTROLLED STRESS CARD {i+1}: '+source['title']['userPreferred']}
            entries.append({'mediaId':media['id'],'media':media,'listData':{'status':'CURRENT','progress':i%10}})
        fixture['data']['lists']=[{'type':'CURRENT','status':'CURRENT','entries':entries}]
        mode='many';await page.reload();await page.locator('[data-home-mobile]').wait_for();await page.wait_for_timeout(1500)
        for _ in range(15):
            await page.evaluate('window.scrollTo(0,document.scrollingElement.scrollHeight)');await page.wait_for_timeout(50)
            await page.evaluate('window.scrollTo(0,0)');await page.wait_for_timeout(50)
        record('96 controlled entries survive repeated scroll without document overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),{'renderedCards':await page.locator('[data-media-entry-card-container]').count(),'nodes':await page.locator('*').count()})
        await page.evaluate('window.scrollTo(0,document.scrollingElement.scrollHeight)');await page.wait_for_timeout(500)
        await page.locator('[data-library-collection-lists-container]').scroll_into_view_if_needed()
        await page.screenshot(path=str(out/'controlled-stress-96.png'))
        mode='real';await page.reload();await page.locator('[data-home-episode-card]').first.wait_for()
        record('Stress fixture is removed and the original real content returns',await page.locator(anime_cards).evaluate_all('es=>es.map(e=>e.dataset.mediaId).sort()')==original_anime_ids)
        record('No uncaught errors across stress cycles',not errors,errors)
        await browser.close()
    print(json.dumps(results,indent=2))

asyncio.run(main())
