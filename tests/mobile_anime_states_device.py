"""Controlled read-response fixtures in the installed Android WebView; no writes."""
import argparse,asyncio,json,copy,subprocess,shutil
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);o=p.parse_args();out=Path(o.output);results=[]
 def check(name,v):
  results.append(dict(name=name,passed=bool(v)));(out/'anime-state-checks.json').write_text(json.dumps(results,indent=2));assert v,name
 async with async_playwright() as pw:
  b=await pw.chromium.connect_over_cdp('http://127.0.0.1:19222');page=next(p for c in b.contexts for p in c.pages if ':43211' in p.url);page.set_default_timeout(30000)
  async def get(path):return await page.evaluate('p=>fetch(p).then(r=>r.json())',path)
  original=await get('/api/v1/library/anime-entry/209983')
  fixture=copy.deepcopy(original);m=fixture['data']['media'];m.update(title={'userPreferred':'[Controlled test] '+('Langer deutscher und englischer Anime-Titel ' * 8)},coverImage=None,bannerImage=None,description=None,startDate=None,meanScore=None,episodes=120)
  episodes=[dict(number=n,title=f'[Controlled test] Folge {n} – '+('Sehr langer englischer und deutscher Titel ' * 6),description='Testbeschreibung',image=None) for n in range(1,121)]
  state={'list':'many','source':'error','requests':0};gate=asyncio.Event();gate.set()
  async def entry(r):await r.fulfill(json=fixture)
  async def details(r):await r.fulfill(json={'data':{}})
  async def listing(r):
   await gate.wait()
   if state['list']=='error':await r.fulfill(status=500,json={'error':'Controlled episode list error'})
   else:await r.fulfill(json={'data':{'episodes':[] if state['list']=='empty' else episodes}})
  async def source(r):
   state['requests']+=1
   if state['source']=='error':await r.fulfill(status=500,json={'error':'Controlled source error'})
   else:await r.fulfill(json={'data':{'videoSources':[],'servers':[{'server':'Controlled unavailable source','status':'unavailable','error':'Controlled: source unavailable'}]}})
  async def continuity(r):
   if r.request.method=='PATCH':await r.fulfill(json={'data':True})
   else:await r.continue_()
  routes=[('**/api/v1/library/anime-entry/209983',entry),('**/api/v1/anilist/media-details/209983',details),('**/api/v1/onlinestream/episode-list',listing),('**/api/v1/onlinestream/episode-source',source),('**/api/v1/continuity/item',continuity)]
  storage=await page.evaluate('Object.fromEntries(Object.entries(localStorage))')
  session=await page.context.new_cdp_session(page)
  try:
   for pattern,handler in routes:await page.route(pattern,handler)
   await page.evaluate("(async()=>{const id=document.querySelector('[data-home-episode-card]').dataset.mediaId;history.pushState({},'','/entry?id='+id);dispatchEvent(new PopStateEvent('popstate'));return '/entry?id='+id})()");await page.locator('.mobile-anime-header').wait_for()
   await page.get_by_role('button',name='Retry source',exact=True).wait_for(timeout=60000)
   check('Failed source has explicit retry with disabled download action',await page.locator('[data-android-download-episode]').is_disabled())
   state['source']='empty';before=state['requests'];await page.get_by_role('button',name='Retry source',exact=True).click()
   await page.get_by_text('No playable source. Select a different server or provider.',exact=True).wait_for()
   check('Retry performs a new request and unavailable source never reports success',state['requests']>before and await page.locator('[data-android-download-episode]').is_disabled())
   check('Many episodes and missing optional artwork render without invented metadata',await page.locator('[data-episode-grid-item]').count()==120 and await page.locator('.mobile-anime-cover img').count()==0)
   await page.locator('.mobile-anime-details summary').click()
   check('Missing description is explicit',await page.get_by_text('No description available.',exact=True).is_visible())
   await page.evaluate('scrollTo(0,0)');await page.screenshot(path=str(out/'controlled-missing-metadata.png'))
   await session.send('Emulation.setDeviceMetricsOverride',dict(width=320,height=740,deviceScaleFactor=3,mobile=True));await page.evaluate('document.documentElement.style.fontSize="200%"')
   check('120 long titles at 320px and 200 percent have no horizontal page overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   await page.locator('#episode-120').scroll_into_view_if_needed();await page.screenshot(path=str(out/'controlled-long-episodes-320-200.png'))
   check('Final episode main action remains reachable',await page.locator('#episode-120 .mobile-episode-target').evaluate('e=>{let r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+10,r.y+10))}'))
   await page.evaluate('document.documentElement.style.fontSize=""');await session.send('Emulation.clearDeviceMetricsOverride')
   state['list']='empty';await page.reload();await page.get_by_text('No episodes available from this provider. Choose another source above.',exact=True).wait_for()
   check('Empty episode list is an explicit completed state without a player spinner',await page.locator('video').count()==0 and await page.locator('[data-android-download-episode]').is_disabled())
   await page.locator('.mobile-anime-episodes-link').click();await page.screenshot(path=str(out/'controlled-empty-episodes.png'))
   state['list']='error';await page.reload();await page.get_by_role('button',name='Retry',exact=True).wait_for(timeout=60000)
   check('Episode-list failure exposes retry',await page.get_by_text('Could not fetch episode list from provider.',exact=True).is_visible())
   state['list']='many';await page.get_by_role('button',name='Retry',exact=True).click();await page.locator('#episode-120').wait_for()
   check('Episode-list retry restores all available episodes',await page.locator('[data-episode-grid-item]').count()==120)
   gate.clear();reload=asyncio.create_task(page.reload(wait_until='domcontentloaded'));await reload
   await page.locator('[data-vc-element="inline-layout-loading-container"]').wait_for()
   check('Delayed episode request has a real loading state',await page.locator('[data-vc-element="inline-layout-loading-container"]').is_visible())
   gate.set();await page.locator('#episode-120').wait_for()
  finally:
   gate.set();await page.evaluate('document.documentElement.style.fontSize=""');await session.send('Emulation.clearDeviceMetricsOverride')
   for pattern,handler in routes:await page.unroute(pattern,handler)
   await page.evaluate('s=>{for(let k of Object.keys(localStorage)){if(k.startsWith("sea-onlinestream")){if(k in s)localStorage.setItem(k,s[k]);else localStorage.removeItem(k)}}}',storage)
   await page.locator('#__seanime_bottom_nav [data-nav-id=home]').click();await page.reload();await page.locator('[data-home-episode-card]').first.wait_for()
   check('Controlled responses removed; original Home restored',not await page.get_by_text('[Controlled test]',exact=False).count())
   await b.close()
asyncio.run(main())
