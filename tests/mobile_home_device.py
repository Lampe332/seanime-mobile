"""Opt-in Home acceptance against the regular Samsung app over an audit CDP forward.

Run: python tests/mobile_home_device.py --output D:\path\to\evidence
Requires the signed instrumentation audit to enable WebView debugging temporarily.
No browser is launched. Controlled response fixtures never write server data.
"""
import argparse
import asyncio
import base64
import copy
import json
import re
import shutil
import subprocess
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    args = argparse.ArgumentParser()
    args.add_argument("--cdp", default="http://127.0.0.1:19222")
    args.add_argument("--output", required=True)
    args.add_argument("--serial", default="R3CT60PD7YA")
    opt = args.parse_args()
    output = Path(opt.output); output.mkdir(parents=True, exist_ok=True)
    adb = shutil.which("adb")
    results = []
    def record(name, value, detail=None):
        results.append(dict(name=name, passed=bool(value), detail=detail))
        (output/'device-checks.json').write_text(json.dumps(results,indent=2),encoding='utf8')
        if not value: raise AssertionError(name)
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(opt.cdp)
        page = next(p for c in browser.contexts for p in c.pages if ":43211" in p.url)
        page.set_default_timeout(15000)
        errors = []
        episode_requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        def requested(request):
            if '/api/v1/onlinestream/episode-source' in request.url and request.method=='POST':
                data=request.post_data_json
                episode_requests.append({k:data.get(k) for k in ('mediaId','episodeNumber')})
        page.on('request',requested)
        fixture_session = await page.context.new_cdp_session(page)
        fixture_state = None
        fixture_tasks = set()
        seen_requests = set()
        async def paused(event):
            request_id=event['requestId']
            if request_id in seen_requests: return
            seen_requests.add(request_id)
            state=fixture_state
            if not state:
                await fixture_session.send('Fetch.continueRequest',{'requestId':request_id})
                return
            await asyncio.sleep(state['delay'])
            body=base64.b64encode(json.dumps(state['response']).encode()).decode()
            await fixture_session.send('Fetch.fulfillRequest',{'requestId':request_id,'responseCode':state['status'],'responseHeaders':[{'name':'Content-Type','value':'application/json'},{'name':'Cache-Control','value':'no-store'}],'body':body})
            state['delivered'].set()
        def pause_event(event):
            task=asyncio.create_task(paused(event));fixture_tasks.add(task);task.add_done_callback(fixture_tasks.discard)
        fixture_session.on('Fetch.requestPaused',pause_event)
        async def fixture(pattern=None,response=None,status=200,delay=0):
            nonlocal fixture_state
            if pattern is None:
                await asyncio.gather(*fixture_tasks)
                await fixture_session.send('Fetch.disable')
                fixture_state=None
                return
            seen_requests.clear()
            fixture_state={'response':response,'status':status,'delay':delay,'delivered':asyncio.Event()}
            await fixture_session.send('Fetch.enable',{'patterns':[{'urlPattern':pattern,'requestStage':'Request'}]})
            return fixture_state['delivered']
        async def get(path): return await page.evaluate("path=>fetch(path).then(r=>r.json())", path)
        async def shot(name):
            remote='/sdcard/seanime-home-audit.png'
            subprocess.run([adb,'-s',opt.serial,'shell','screencap','-p',remote],check=True,capture_output=True)
            subprocess.run([adb,'-s',opt.serial,'pull',remote,str(output/name)],check=True,capture_output=True)
        async def home():
            if "/entry" in page.url:
                subprocess.run([adb,"-s",opt.serial,"shell","input","keyevent","4"],check=True,capture_output=True)
                await page.wait_for_timeout(500)
            if not await page.locator('[data-home-mobile="true"]').count():
                await page.locator('#__seanime_bottom_nav [data-nav-id="home"]').click()
            await page.locator('[data-home-episode-card]').first.wait_for()
        original = await get('/api/v1/status/home-items')
        original_history = (await get('/api/v1/continuity/history'))['data']
        library = await get('/api/v1/library/collection')
        original_language = await page.evaluate("localStorage.getItem('seanime-mobile-language')")
        session = None
        series_id = None
        try:
            await home()
            expected = {(str(e['baseAnime']['id']),str(e['episodeNumber'])) for e in library['data'].get('continueWatchingList',[])+library['data'].get('stream',{}).get('continueWatchingList',[])}
            shown = await page.locator('[data-home-episode-card]').evaluate_all("es=>es.map(e=>[e.dataset.mediaId,e.dataset.episodeNumber])")
            record('Real continuation series and episode numbers', set(map(tuple,shown))==expected, shown)
            record('Mobile Home has no scrolling library header', await page.locator('[data-home-mobile] [data-library-header-container]').count()==0)
            record('Primary resume targets contain no nested links or buttons',await page.locator('[data-home-episode-card] a,[data-home-episode-card] button').count()==0)

            row = page.locator('.home-resume-row')
            box = await row.bounding_box(); viewport = await page.evaluate('({w:innerWidth,h:innerHeight})')
            size = subprocess.check_output([adb,'-s',opt.serial,'shell','wm','size'],text=True)
            physical = [int(n) for n in re.search(r'(\d+)x(\d+)',size).groups()]
            scale = physical[0]/viewport['w']
            y = int((box['y']+min(box['height']/2,70))*scale)
            subprocess.run([adb,'-s',opt.serial,'shell','input','swipe',str(int(310*scale)),str(y),str(int(60*scale)),str(y),'450'],check=True,capture_output=True)
            await page.wait_for_timeout(500)
            record('Physical horizontal swipe moves the continuation row',await row.evaluate('e=>e.scrollLeft')>20)
            await row.evaluate('e=>e.scrollLeft=0')

            genre = page.locator('.home-genre-row button').filter(has_text='Sci-Fi')
            if await genre.count():
                await genre.click(); await page.wait_for_timeout(500)
                record('Genre filter selects and filters the library',await genre.get_attribute('aria-pressed')=='true' and await page.locator('[data-library-filtered-lists] [data-media-entry-card-container]').count()>0)
                await genre.click(); await page.wait_for_timeout(500)
                record('Genre filter clears',await genre.get_attribute('aria-pressed')=='false')
            filter_button = page.get_by_role('button',name='Filter currently watching')
            await filter_button.click(); await page.get_by_text('Show unwatched only',exact=True).click()
            record('Unwatched filter changes state',await filter_button.get_attribute('aria-pressed')=='true')
            await filter_button.click(); await page.get_by_text('Show all',exact=True).click()
            record('Unwatched filter restores',await filter_button.get_attribute('aria-pressed')=='false')

            await page.locator('[data-library-toolbar-switch-view-button]').click()
            modal=page.locator('.home-mobile-settings').first
            await modal.wait_for()
            record('Existing section selection is reachable on the phone',await modal.locator('[data-home-mobile-item]').count()==len(original['data'] or [1,2]))
            items = modal.locator('[data-home-mobile-item]')
            initial_ids = await items.evaluate_all("es=>es.map(e=>e.dataset.homeMobileItem)")
            first_id = await items.first.get_attribute('data-home-mobile-item')
            await items.first.get_by_role('button',name=re.compile('Move down:')).click()
            await page.wait_for_function('(id)=>document.querySelectorAll("[data-home-mobile-item]")[1]?.getAttribute("data-home-mobile-item")===id',arg=first_id)
            saved = await get('/api/v1/status/home-items')
            record('Reorder is persisted through the existing settings endpoint',saved['data'][1]['id']==first_id)
            await items.nth(1).get_by_role('button',name=re.compile('Move up:')).click()
            await page.wait_for_function('(id)=>document.querySelector("[data-home-mobile-item]")?.getAttribute("data-home-mobile-item")===id',arg=first_id)
            record('Original Home order restores',await items.evaluate_all("es=>es.map(e=>e.dataset.homeMobileItem)")==initial_ids)
            options_before = await get('/api/v1/status/home-items')
            await items.get_by_role('button',name='Options',exact=True).first.click()
            await page.get_by_role('button',name='Save',exact=True).click()
            await page.get_by_role('button',name='Save',exact=True).wait_for(state='hidden')
            def normalized_options(value):
                value=copy.deepcopy(value)
                for item in value['data'] or []:
                    if item.get('options')=={}:item.pop('options')
                return value
            record('Existing section options save without losing values',normalized_options(await get('/api/v1/status/home-items'))==normalized_options(options_before))
            await modal.locator('.home-mobile-available button').first.click()
            await page.wait_for_function('(n)=>document.querySelectorAll("[data-home-mobile-item]").length===n',arg=len(initial_ids)+1)
            record('Existing section picker adds a persisted section',len((await get('/api/v1/status/home-items'))['data'])==len(initial_ids)+1)
            await items.last.get_by_role('button',name=re.compile('Remove:')).click()
            await page.wait_for_function('(n)=>document.querySelectorAll("[data-home-mobile-item]").length===n',arg=len(initial_ids))
            record('Added section can be removed without changing the originals',await items.evaluate_all("es=>es.map(e=>e.dataset.homeMobileItem)")==initial_ids)
            await page.keyboard.press('Escape')

            await home()
            series_id=shown[0][0]
            # Exercise the real player/entry selection without saving test playback time.
            await fixture('*api/v1/continuity/item',{'data':True})
            await page.locator('.home-episode-page').first.click()
            await page.wait_for_url(re.compile(r'/entry\?id='+series_id))
            record('Secondary details action opens the correct series',True,series_id)
            await home()
            episode_requests.clear()
            await page.locator('[data-home-episode-card]').first.click()
            await page.wait_for_url(re.compile(r'/entry\?id='+series_id))
            for _ in range(30):
                if episode_requests: break
                await page.wait_for_timeout(250)
            record('Primary continuation uses the existing entry route',True,{'series':series_id,'episode':shown[0][1]})
            record('Continuation requests the correct episode from the existing provider',any(r['mediaId']==int(series_id) and r['episodeNumber']==int(shown[0][1]) for r in episode_requests),episode_requests)
            await shot('resume-entry.png')
            await home()
            record('Android Back returns from entry to Home',await page.locator('[data-home-mobile]').count()==1)
            await page.locator('[data-library-collection-list-item-media-card-lazy-grid] [data-media-entry-card-body-link]').first.click()
            await page.wait_for_url(re.compile(r'/entry\?id=\d+'))
            record('Library poster opens its series',True,page.url)
            await home()
            await fixture()

            # Response-only fixtures. Real configuration, progress and files are never replaced.
            empty_data=copy.deepcopy(library)
            empty_data['data']['lists']=[];empty_data['data']['continueWatchingList']=[]
            if empty_data['data'].get('stream'):
                empty_data['data']['stream']['anime']=[];empty_data['data']['stream']['continueWatchingList']=[]
            await fixture('*api/v1/library/collection',empty_data)
            await page.reload(); await page.locator('[data-home-screen="no-entries"], [data-continue-watching-container] .home-state').first.wait_for()
            record('Empty library state renders with configuration access',await page.locator('[data-library-toolbar-switch-view-button]').is_visible())
            await shot('controlled-empty.png')
            await fixture()

            await fixture('*api/v1/status/home-items',{'error':'Controlled Home test'},status=503)
            await page.reload(); await page.get_by_role('alert').filter(has_text='Home could not load').wait_for(timeout=30000)
            record('Home error exposes a retry action',await page.get_by_role('button',name='Try again',exact=True).is_visible())
            await shot('controlled-error.png')
            await fixture()
            await page.get_by_role('button',name='Try again',exact=True).click()
            await page.locator('[data-home-episode-card]').first.wait_for()
            record('Retry recovers the real saved Home',True)

            loaded_home = await get('/api/v1/status/home-items')
            loading_delivered = await fixture('*api/v1/status/home-items',loaded_home,delay=4)
            await page.reload(wait_until='domcontentloaded')
            await page.locator('[data-home-mobile][aria-busy="true"]').wait_for()
            record('Loading state is exposed accessibly',True)
            await shot('controlled-loading.png')
            await asyncio.wait_for(loading_delivered.wait(),timeout=12)
            await page.locator('[data-home-episode-card]').first.wait_for()
            await fixture()
            await page.wait_for_timeout(500)

            # Trigger the real image error handler on a temporary DOM source only.
            # Android WebView does not reliably support intercepting third-party image requests.
            await page.locator('[data-home-episode-card] img').first.evaluate("e=>e.src='/__controlled_home_missing_image__.png'")
            await page.wait_for_function("document.querySelector('[data-home-episode-card] img')?.getAttribute('src')?.includes('no-cover')")
            record('Missing image retains a named, usable resume target',await page.locator('[data-home-episode-card]').first.get_attribute('aria-label') is not None)
            await shot('controlled-missing-image.png')
            await page.reload(); await home()

            # Small layout and large text are rendering probes on the actual WebView.
            session=await page.context.new_cdp_session(page)
            await session.send('Emulation.setDeviceMetricsOverride',{'width':320,'height':740,'deviceScaleFactor':3.75,'mobile':True})
            await page.evaluate("document.documentElement.style.fontSize='200%'")
            await page.emulate_media(reduced_motion='reduce')
            await page.wait_for_timeout(400)
            record('320px / 200% text Home does not overflow the document',await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
            record('Large text retains a visible resume action',await page.locator('.home-resume-action').first.is_visible())
            record('200% card text and actions fit their own containers',await page.locator('.home-episode-meta,.home-resume-action').evaluate_all('es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)'))
            await page.locator('[data-home-episode-card]').first.scroll_into_view_if_needed()
            await shot('small-200-percent.png')
            await page.evaluate("document.documentElement.style.removeProperty('font-size')")
            await session.send('Emulation.clearDeviceMetricsOverride')
            await page.emulate_media(reduced_motion='no-preference')

            await page.evaluate("localStorage.setItem('seanime-mobile-language',JSON.stringify('de'))")
            await page.reload();await page.get_by_role('heading',name='Weiterschauen',exact=True).wait_for()
            record('German Home labels and long real titles render',await page.get_by_role('button',name='Anpassen',exact=True).is_visible())
            await shot('home-german.png')
            await page.evaluate("v=>v===null?localStorage.removeItem('seanime-mobile-language'):localStorage.setItem('seanime-mobile-language',v)",original_language)
            await page.reload(); await home()
            await page.evaluate('window.scrollTo(0,document.scrollingElement.scrollHeight)')
            await page.wait_for_timeout(300)
            record('Last Home poster title can clear the unchanged bottom navigation',await page.evaluate('''()=>{const e=[...document.querySelectorAll('[data-home-mobile] [data-media-entry-card-title-section]')].pop();return e.getBoundingClientRect().bottom<=document.querySelector('#__seanime_bottom_nav').getBoundingClientRect().top}'''))
            await shot('home-bottom.png')
            await page.evaluate('window.scrollTo(0,0)')
            final_items=(await get('/api/v1/status/home-items'))['data']
            record('Home configuration survives leaving, returning and reload',[i['id'] for i in final_items]==initial_ids)
            record('No uncaught JavaScript exceptions',not errors,errors)
        finally:
            (output/'device-checks.json').write_text(json.dumps(results,indent=2),encoding='utf8')
            try:
                await fixture()
            except Exception as cleanup_error:
                print('Interception cleanup:',cleanup_error)
            if session:
                await session.send('Emulation.clearDeviceMetricsOverride')
            await page.evaluate("document.documentElement.style.removeProperty('font-size')")
            await page.emulate_media(reduced_motion='no-preference')
            await page.evaluate("v=>v===null?localStorage.removeItem('seanime-mobile-language'):localStorage.setItem('seanime-mobile-language',v)",original_language)
            if (await get('/api/v1/status/home-items'))!=original:
                await page.evaluate("items=>fetch('/api/v1/status/home-items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})})",original['data'])
            await page.reload()
            # Native playback can save outside WebView Fetch interception. Restore only
            # our short test marker for the tested episode; never overwrite real progress.
            history = (await get('/api/v1/continuity/history'))['data']
            for media_id, before in original_history.items():
                after = history.get(media_id)
                if after and after.get('currentTime') != before.get('currentTime'):
                    if (media_id != series_id or after.get('episodeNumber') != before.get('episodeNumber')
                            or after.get('duration') != before.get('duration')
                            or not 0 <= after.get('currentTime', 999) < 5):
                        raise AssertionError('Unexpected continuity change; refusing to overwrite playback progress')
                    await page.evaluate("options=>fetch('/api/v1/continuity/item',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({options})}).then(r=>{if(!r.ok)throw Error('Continuity restoration failed')})",before)
            restored = (await get('/api/v1/continuity/history'))['data']
            fields = ('mediaId','episodeNumber','kind','filepath','currentTime','duration')
            record('Playback fields retained after the device test',all(
                all(restored.get(k,{}).get(f)==v.get(f) for f in fields)
                for k,v in original_history.items()))
            (output/'device-checks.json').write_text(json.dumps(results,indent=2),encoding='utf8')
            print(json.dumps(results,indent=2))

asyncio.run(main())
