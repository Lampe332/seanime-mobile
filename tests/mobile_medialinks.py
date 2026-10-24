"""External player on Android phones: the /medialinks phone screen (downloaded episodes as rows with thumbnail, title,
length, filler and watched marks; specials and openings in their own sections; a tap opens the episode in the external
player through its link and starts progress tracking; the opened one marked), the progress tracking sheet (episode,
"watched" as the one action, stop, the player again), the empty state, German texts, 48px targets and no overflow at
390px and at 320px with 200% text. Optional arg: screenshot dir."""
from pathlib import Path
from web_build import WEB
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, copy
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name):
    if shots: page.screenshot(path=str(shots/name))

A='/storage/emulated/0/Anime/Frieren'
IMG='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>'
def ep(n,kind='main',title='',length=24,filler=False):
    name=f'Frieren - {n:02d}.mkv' if kind=='main' else f'Frieren - {kind.upper()}{n}.mkv'
    return dict(type=kind,displayTitle=f'Episode {n}' if kind=='main' else (f'Special {n}' if kind=='special' else f'Opening {n}'),episodeTitle=title,episodeNumber=n,
        progressNumber=n if kind=='main' else 0,isInvalid=False,localFile=dict(path=f'{A}/{name}',name=name,parsedInfo=dict(original=name)),
        episodeMetadata=dict(image=IMG,length=length,isFiller=filler),baseAnime=dict(id=154587,title=dict(userPreferred='Sousou no Frieren')))
ENTRY=dict(mediaId=154587,listData=dict(status='CURRENT',progress=2),media=dict(id=154587,title=dict(userPreferred='Sousou no Frieren')),
    episodes=[ep(1,title='The Journey\'s End'),ep(2,title='It Didn\'t Have to Be Magic...'),ep(3,title='Killing Magic',filler=True),ep(1,'special','',12),ep(1,'nc','',2)])
STATUS=dict(version='3.10.4',os='android',isOffline=False,user=dict(viewer=dict(name='Nick')),themeSettings=dict(id=1),settings=dict(library=dict()))
SERVER=dict(status=STATUS,collection=dict(lists=[],unmatchedLocalFiles=[],unmatchedGroups=[],unknownGroups=[],ignoredLocalFiles=[]),media={},suggestions={},
    entries={'154587':ENTRY})
LINK='intent://{url}#Intent;package=org.videolan.vlc;type=video/*;S.title={mediaTitle};end'
INIT='''(()=>{Object.assign(window,{server:%s,routes:[],requests:[],toasts:[],tabs:[],clipboard:[],previews:[],command:[],explorer:[],completed:0});
    localStorage.setItem("sea-playback-external-player-link",JSON.stringify(%s))})()'''
STATIC=WEB/'static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SHEET='.UI-Modal__content[data-state=open]'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>(b.textContent||b.getAttribute("aria-label")||b.tagName).trim().slice(0,40)))'''
TARGETS=f'[data-phone-screen] :is(button,a), {SHEET} :is(button,a)'
STATE=dict(mediaId=154587,mediaTitle='Sousou no Frieren',mediaCoverImage=IMG,episodeNumber=3,mediaTotalEpisodes=28,progressUpdated=False,completionPercentage=0.4,canPlayNext=False,filename='Frieren - 03.mkv')
def reqs(page,method,endpoint): return [r[2] for r in page.evaluate('requests') if r[0]==method and r[1]==endpoint]
def ws(page,type,payload): page.evaluate('([t,p])=>dispatchEvent(new CustomEvent("ws",{detail:{type:t,payload:p}}))',[type,payload]);page.wait_for_timeout(300)

with tempfile.TemporaryDirectory(prefix='seanime-medialinks-') as tmp:
    bundle=Path(tmp)/'medialinks.js'
    subprocess.run(['node',str(root/'tests/mobile_library_bundle.cjs'),str(bundle),'mobile_medialinks_harness.tsx'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,language=None,server=None,html_style='',mid='154587'):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script(INIT%(json.dumps(server or copy.deepcopy(SERVER)),json.dumps(LINK)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            page.route('http://links.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            html=f'<html class="dark" lang="en" style="{html_style}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
            page.route('http://links.test/medialinks*',lambda r:r.fulfill(content_type='text/html',body=html))
            page.goto(f'http://links.test/medialinks?id={mid}')
            for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator('[data-phone-screen="medialinks"] h1').wait_for();page.wait_for_timeout(700)
            return page
        def small(page): return page.evaluate(SMALL,TARGETS)

        page=open_page()
        check("Phone screen: the anime as title, what a tap does, a way to the anime's page",page.locator('h1').inner_text()=='Sousou no Frieren'
              and page.locator('[data-phone-facts]').inner_text()=='A tap opens the episode in your external player'
              and page.locator('[data-medialinks-back]').get_attribute('href')=='/entry?id=154587' and page.locator('[data-medialinks-back]').get_attribute('aria-label')=="The anime's page")
        check('Sections: episodes, specials, openings and endings',page.evaluate('[...document.querySelectorAll("[data-medialinks-section]")].map(s=>s.dataset.medialinksSection)')==['main','special','nc'])
        rows=page.evaluate('[...document.querySelectorAll("[data-medialinks-section=main] .pml-row")].map(r=>[r.querySelector(".ps-list-title").textContent,r.querySelector(".ps-list-meta").textContent,!!r.querySelector(".pml-watched")])')
        check('Rows: title, length and filler, watched up to the progress',rows==[['Episode 1','24 min',True],['Episode 2','24 min',True],['Episode 3','24 min · Filler',False]])
        check('48px targets, no overflow, no desktop grid',small(page)==[] and page.evaluate(NO_OVERFLOW) and page.locator('[data-episode-list-grid]').count()==0)
        shot(page,'medialinks-390.png')
        page.locator(f'[data-medialinks-episode="{A}/Frieren - 03.mkv"]').click()
        # The link is built asynchronously (tokens, subtitles); wait for it and for the tracking request
        page.wait_for_function('tabs.length>0 && requests.some(r=>r[1]==="/api/v1/playback-manager/manual-tracking/start")',timeout=8000);page.wait_for_timeout(200)
        tabs=page.evaluate('tabs')
        check('A tap opens the episode in the external player and starts tracking',len(tabs)==1 and tabs[0].startswith('intent://') and 'org.videolan.vlc' in tabs[0]
              and 'Frieren%20-%2003.mkv' in tabs[0] and reqs(page,'POST','/api/v1/playback-manager/manual-tracking/start')[-1]['episodeNumber']==3)
        check('The opened episode is marked',page.locator(f'[data-medialinks-episode="{A}/Frieren - 03.mkv"]').get_attribute('aria-current')=='true'
              and 'Opened in your player' in page.locator(f'[data-medialinks-episode="{A}/Frieren - 03.mkv"]').inner_text())
        ws(page,'playback-manager-manual-tracking-playback-state',STATE)
        check('Tracking: a sheet with the episode, watched as the one action',page.locator(f'{SHEET}[data-manual-progress-tracking-modal], {SHEET} [data-manual-progress-tracking-modal]').count()>=0
              and page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Playing in your player' and 'Episode 3 / 28' in page.locator(SHEET).inner_text()
              and page.locator('[data-mpt-sync]').inner_text()=='Episode 3 watched' and page.locator(f'{SHEET} .ps-primary').count()==1)
        check('Tracking: 48px targets, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'medialinks-tracking-390.png')
        page.locator('[data-mpt-reopen]').click();page.wait_for_timeout(300)
        check('Open the player again uses the same link',page.evaluate('tabs').count(tabs[0])==2)
        page.locator('[data-mpt-sync]').click();page.wait_for_timeout(500)
        check('Watched: syncs the progress',len(reqs(page,'POST','/api/v1/playback-manager/sync-current-progress'))==1)
        page.locator('[data-mpt-stop]').click();page.wait_for_timeout(600)
        check('Stop tracking: cancels and closes',len(reqs(page,'POST','/api/v1/playback-manager/manual-tracking/cancel'))==1 and page.locator(SHEET).count()==0)
        page.close()

        server=copy.deepcopy(SERVER);server['entries']['154587']=dict(ENTRY,episodes=[])
        page=open_page(server=server)
        check('No downloaded episodes: says why',page.locator('[data-medialinks-empty]').inner_text().startswith('No downloaded episodes'))
        page.close()

        page=open_page(width=320,height=640,language='de',html_style='-webkit-text-size-adjust:200%;text-size-adjust:200%')
        check('German',page.locator('[data-phone-facts]').inner_text()=='Ein Tipp öffnet die Folge in deinem externen Player' and page.locator('#pml-main').inner_text()=='Folgen3')
        check('320px, 200% text: no overflow, 48px',page.evaluate(NO_OVERFLOW) and small(page)==[])
        shot(page,'medialinks-320-200.png')
        ws(page,'playback-manager-manual-tracking-playback-state',STATE)
        check('German tracking sheet, no overflow',page.locator('[data-mpt-sync]').inner_text()=='Folge 3 gesehen' and page.evaluate(NO_OVERFLOW))
        page.close()
        check('No page errors',errors==[])
        browser.close()
print(json.dumps(checks,indent=2))
print(f'{sum(c["passed"] for c in checks)}/{len(checks)} passed')
