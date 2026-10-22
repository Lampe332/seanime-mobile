"""Torrents on Android phones: the torrent search sheet for streaming a torrent, streaming through debrid and downloading
(provider, episode or title search, resolution, batches, best releases, debrid cache, rows with their facts), the stream
start with the app's own player, the download sheet (library folder, only the missing episodes of a batch, no folder set),
no provider / no results / provider errors, "Download a torrent" in the anime page's More sheet, the source controls (auto
select, remembered batch, missing episode data) and the Downloads tab's torrents (progress, pause / resume, removing with
or without files); German texts, 48px targets, no overflow at 390px and at 320px with 200% text. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, copy, datetime
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name):
    if shots: page.screenshot(path=str(shots/name),full_page=True)

now=datetime.datetime.now(datetime.timezone.utc)
def ago(**kw): return (now-datetime.timedelta(**kw)).isoformat()
def torrent(h,name,**kw):
    t=dict(provider='nyaa',name=name,date=ago(hours=5),size=1,formattedSize='1.4 GiB',seeders=812,leechers=20,downloadCount=900,link=f'https://nyaa.test/{h}',
           downloadUrl=f'https://nyaa.test/{h}.torrent',magnetLink=f'magnet:?xt=urn:btih:{h}',infoHash=h,resolution='1080p',isBatch=False,episodeNumber=5,
           releaseGroup='SubsPlease',isBestRelease=False,confirmed=True)
    t.update(kw);return t
TORRENTS=[torrent('h1','[SubsPlease] Sousou no Frieren - 05 (1080p) [ABC123].mkv'),
          torrent('h2','[Erai-raws] Sousou no Frieren (01-28) [1080p] [Batch]',isBestRelease=True,isBatch=True,formattedSize='38.2 GiB',seeders=140,releaseGroup='Erai-raws',date=ago(days=40)),
          torrent('h3','[ASW] Sousou no Frieren - 05 [720p]',resolution='720p',seeders=0,releaseGroup='ASW',formattedSize='310 MiB',date=ago(days=400))]
PROVIDER=lambda i,n:dict(id=i,name=n,lang='multi',settings=dict(canSmartSearch=True,smartSearchFilters=['batch','episodeNumber','resolution','bestReleases'],supportsAdult=False,type='main'))
ENTRY=dict(mediaId=154587,localFiles=[],libraryData=None,listData=dict(status='CURRENT',progress=4),
    downloadInfo=dict(canBatch=True,absoluteOffset=0,episodesToDownload=[dict(episodeNumber=n) for n in (1,2,3,5)]),
    media=dict(id=154587,format='TV',status='FINISHED',episodes=12,endDate=dict(year=2024,month=3,day=22),isAdult=False,
               title=dict(romaji='Sousou no Frieren',english="Frieren: Beyond Journey's End",userPreferred='Sousou no Frieren')))
LIBRARY='/storage/emulated/0/Anime'
STATUS=dict(version='3.10.4',os='android',isOffline=False,user=dict(viewer=dict(name='Nick')),themeSettings=dict(id=1),
    settings=dict(library=dict(libraryPath=LIBRARY,torrentProvider='nyaa',enableOnlinestream=True),torrent=dict(defaultTorrentClient='seanime')),
    torrentstreamSettings=dict(enabled=True,autoSelect=False),debridSettings=dict(enabled=True,provider='torbox'))
LIST=[dict(name='[Erai-raws] Sousou no Frieren (01-28) [1080p] [Batch]',hash='h2',seeds=40,upSpeed='120 KB/s',downSpeed='3.4 MB/s',progress=.42,size='38.2 GiB',
           eta='2 hours left',status='downloading',contentPath=f'{LIBRARY}/Sousou no Frieren',peers=55,ratio=0,queueIndex=0,forceStart=False,sequential=False,error=''),
      dict(name='[SubsPlease] Sousou no Frieren - 05 (1080p) [ABC123].mkv',hash='h1',seeds=200,upSpeed='40 KB/s',downSpeed='0 B/s',progress=1,size='1.4 GiB',
           eta='N/A',status='seeding',contentPath=f'{LIBRARY}/Sousou no Frieren',peers=12,ratio=.3,queueIndex=1,forceStart=False,sequential=False,error='')]
COVER='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>'
EPISODES=dict(hasMappingError=False,episodes=[dict(episodeNumber=n,progressNumber=n,aniDBEpisode=str(n),displayTitle=f'Episode {n}',episodeTitle=f'Chapter {n}',type='main',
    baseAnime=ENTRY['media'],episodeMetadata=dict(image=COVER,length=24,isFiller=False)) for n in range(1,5)])
SERVER=dict(status=STATUS,entry=ENTRY,providers=[PROVIDER('nyaa','Nyaa'),PROVIDER('animetosho','AnimeTosho')],torrents=TORRENTS,cached={'h1':{'cachedFiles':{}}},list=LIST,
    episodes=EPISODES)
INIT='''(()=>{Object.assign(window,{server:%s,harnessView:%s,routes:[],requests:[],toasts:[],batchName:%s,mappingError:%s})})()'''
STATIC=root/'backend/seanime-web/out/static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SHEET='.UI-Modal__content[data-state=open]'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>(b.textContent||b.getAttribute("aria-label")||b.tagName).trim().slice(0,40)))'''
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
def reqs(page,method,endpoint): return [r[2] for r in page.evaluate('requests') if r[0]==method and r[1].split('?')[0]==endpoint]

with tempfile.TemporaryDirectory(prefix='seanime-torrents-') as tmp:
    bundle=Path(tmp)/'torrents.js'
    subprocess.run(['node',str(root/'tests/mobile_torrents_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(screen='entry',width=390,height=844,language=None,html_style='',server=None,batch=None,mapping=False):
            page=browser.new_page(viewport=dict(width=width,height=height),screen=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script(INIT%(json.dumps(server or copy.deepcopy(SERVER)),json.dumps(screen),json.dumps(batch),json.dumps(mapping)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            page.route('http://torrents.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            html=f'<html class="dark" lang="en" style="{html_style}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
            page.route('http://torrents.test/',lambda r:r.fulfill(content_type='text/html',body=html))
            page.goto('http://torrents.test/')
            for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.wait_for_timeout(600)
            return page
        def search(page,type,episode=None,wait=900):
            page.evaluate(f'openSearch({json.dumps(type)},{json.dumps(episode)})');page.wait_for_timeout(wait)
        def small(page): return page.evaluate(SMALL,f'{SHEET} :is(button,a,input,select)')

        # Streaming a torrent
        page=open_page()
        search(page,'torrentstream-select',5)
        sheet=page.locator(SHEET)
        check('Stream: one sheet titled for torrents, with the episode',page.locator(SHEET).count()==1 and sheet.locator('.UI-Modal__title').inner_text()=='Stream a torrent'
              and page.locator('[data-torrent-context]').inner_text()=='Episode 5')
        check('Stream: provider picker, episode / title search, resolution, batch and best-release filters',page.locator('[data-torrent-provider] option').count()==2
              and page.evaluate(TEXT,'[data-torrent-mode] [role=tab]')==['Episode','Title'] and page.locator('[data-torrent-resolution] button').count()==4
              and page.evaluate(TEXT,'[data-torrent-flags] button')==['Whole season','Best releases'])
        first=reqs(page,'POST','/api/v1/torrent/search')
        check('Stream: searches the default provider for the episode',first and first[-1]['type']=='smart' and first[-1]['provider']=='nyaa' and first[-1]['episodeNumber']==5)
        rows=page.locator('[data-torrent-row]')
        check('Stream: best release first, each row with its facts',rows.count()==3 and rows.first.get_attribute('data-torrent-row')=='h2'
              and 'Best release · Batch · Erai-raws · 1080p · 38.2 GiB · 140 seeders' in rows.first.inner_text())
        check('Stream: a torrent without seeders says so',"No seeders" in page.locator('[data-torrent-row="h3"]').inner_text())
        check('Every control in the sheet is at least 48px',small(page)==[])
        check('390px: no page overflow',page.evaluate(NO_OVERFLOW))
        shot(page,'torrents-stream-390.png')
        page.locator('[data-torrent-resolution] button',has_text='720p').click();page.wait_for_timeout(900)
        check('Resolution chip searches again with it',reqs(page,'POST','/api/v1/torrent/search')[-1]['resolution']=='720')
        page.locator('[data-torrent-row="h1"]').click();page.wait_for_timeout(500)
        start=reqs(page,'POST','/api/v1/torrentstream/start')
        check("Tapping a torrent streams it in the app's own player and closes the sheet",start and start[-1]['torrent']['infoHash']=='h1' and start[-1]['episodeNumber']==5
              and start[-1]['aniDBEpisode']=='5' and start[-1]['autoSelect'] is False and start[-1]['playbackType']=='nativeplayer'
              and page.locator(SHEET).count()==0)
        search(page,'torrentstream-select-file',5)
        page.locator('[data-torrent-mode] [role=tab]',has_text='Title').click();page.wait_for_timeout(900)
        last=reqs(page,'POST','/api/v1/torrent/search')[-1]
        check('Title search starts from the title; picking a file is automatic on phones',last['type']=='simple' and last['query']=='sousou no frieren'
              and page.locator('[data-torrent-query]').input_value()=='Sousou no Frieren' and page.locator('[data-torrent-search-phone=torrent]').count()==1)
        page.keyboard.press('Escape');page.wait_for_timeout(400)

        # Streaming through debrid
        search(page,'debridstream-select',5)
        check('Debrid: own title, cached torrents marked, a note on the cache',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Stream with debrid'
              and 'Cached' in page.locator('[data-torrent-row="h1"]').inner_text() and 'Cached' not in page.locator('[data-torrent-row="h3"]').inner_text()
              and 'Cached torrents start at once.' in page.locator(SHEET).inner_text())
        shot(page,'torrents-debrid-390.png')
        page.locator('[data-torrent-row="h1"]').click();page.wait_for_timeout(500)
        d=reqs(page,'POST','/api/v1/debrid/stream/start')
        check("Debrid: tapping a torrent streams it in the app's own player",d and d[-1]['torrent']['infoHash']=='h1' and d[-1]['playbackType']=='nativeplayer'
              and d[-1]['episodeNumber']==5 and page.locator(SHEET).count()==0)

        # Downloading
        search(page,'download')
        check('Download: own title and the missing episodes',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Download a torrent'
              and page.locator('[data-torrent-context]').inner_text()=='Missing episodes: 1–3, 5')
        check('Download: rows are check boxes, no action until one is picked',page.locator('[data-torrent-row][role=checkbox]').count()==3 and page.locator('[data-torrent-continue]').count()==0)
        check('Download: no "Cached" (the debrid cache plays no part in the app\'s own client)',
              'Cached' not in page.locator(SHEET).inner_text() and 'Cached torrents start at once.' not in page.locator(SHEET).inner_text())
        page.locator('[data-torrent-row="h1"]').click();page.locator('[data-torrent-row="h3"]').click();page.wait_for_timeout(200)
        check('Download: the action counts the picks',page.locator('[data-torrent-continue]').inner_text()=='Continue with 2')
        page.locator('[data-torrent-continue]').click();page.wait_for_timeout(500)
        check('Download sheet: both torrents, the library folder plus the title, no episode choice for two torrents',page.locator('[data-torrent-download-sheet] .tsp-chosen li').count()==2
              and page.locator('[data-torrent-destination]').inner_text()==f'{LIBRARY}/Sousou no Frieren' and page.locator('[data-torrent-only-missing]').count()==0)
        check('Download sheet: 48px controls',small(page)==[])
        page.locator('[data-torrent-download-start]').click();page.wait_for_timeout(500)
        dl=reqs(page,'POST','/api/v1/torrent-client/download')
        check('Start download: both torrents to the folder, everything in them, then Downloads › Torrents',dl and [t['infoHash'] for t in dl[-1]['torrents']]==['h1','h3']
              and dl[-1]['destination']==f'{LIBRARY}/Sousou no Frieren' and dl[-1]['smartSelect']['enabled'] is False
              and page.evaluate('routes')[-1]=='/android-downloads?kind=torrents' and page.locator(SHEET).count()==0)
        search(page,'download')
        page.locator('[data-torrent-row="h2"]').click();page.locator('[data-torrent-continue]').click();page.wait_for_timeout(500)
        check('One batch of a finished show: only the missing episodes is chosen first',page.locator('[data-torrent-only-missing]').get_attribute('aria-checked')=='true'
              and '1–3, 5' in page.locator('[data-torrent-only-missing]').inner_text())
        shot(page,'torrents-download-390.png')
        page.locator('[data-torrent-download-start]').click();page.wait_for_timeout(500)
        dl=reqs(page,'POST','/api/v1/torrent-client/download')[-1]
        check('Only the missing episodes are downloaded from the batch',dl['smartSelect']=={'enabled':True,'missingEpisodeNumbers':[1,2,3,5]} and dl['torrents'][0]['infoHash']=='h2')
        # A batch without every missing episode: the server refuses the pick; the sheet stays and says how to go on
        page.evaluate("server.downloadError='failed to select files, could not find the right season files'")
        search(page,'download')
        page.locator('[data-torrent-row="h2"]').click();page.locator('[data-torrent-continue]').click();page.wait_for_timeout(500)
        routes_before=len(page.evaluate('routes'))
        page.locator('[data-torrent-download-start]').click();page.wait_for_timeout(500)
        check('Smart pick refused: plain words, the sheet stays for "Everything in the torrent"',page.evaluate('toasts')[-1]==['error',
              'This torrent doesn\'t hold every missing episode. Choose "Everything in the torrent" or another torrent.']
              and page.locator('[data-torrent-download-sheet]').count()==1 and len(page.evaluate('routes'))==routes_before)
        page.evaluate("server.downloadError=null")
        for _ in range(2):  # the download sheet goes back to the search, then the search closes
            page.keyboard.press('Escape');page.wait_for_timeout(400)

        # The More sheet
        page.locator('[data-anime-entry-dropdown-menu-trigger]').click();page.wait_for_timeout(450)
        row=page.locator('[data-entry-open="torrent-download"]')
        check('More: "Download a torrent" in Episodes',row.count()==1 and 'Download a torrent' in row.inner_text())
        row.click();page.wait_for_timeout(900)
        check('It opens the torrent search for downloading',page.locator('[data-torrent-search-phone=download]').count()==1 and page.locator(SHEET).count()==1)
        page.keyboard.press('Escape');page.wait_for_timeout(300)

        # Source controls
        check('Source controls: one switch to pick the best torrent, explained',page.locator('[data-stream-auto-select]').count()==1
              and 'Tapping an episode shows the torrents to choose from.' in page.locator('[data-stream-controls-phone]').inner_text())
        check('No pick-a-file switch on phones',page.locator('[data-stream-controls-phone] [role=switch]').count()==1)
        page.close()

        page=open_page(batch='[Erai-raws] Sousou no Frieren (01-28) [1080p] [Batch]',mapping=True)
        check('A remembered batch is shown with a way to stop it; missing episode data is explained',page.locator('[data-stream-batch]').count()==1
              and '[Erai-raws]' in page.locator('[data-stream-batch]').inner_text() and page.locator('[data-stream-mapping-error]').count()==1)
        page.locator('[data-stream-batch] button').click()
        check('Stop asks before the batch is forgotten',page.evaluate('window.forgot===true'))
        page.close()

        # No library folder
        s=copy.deepcopy(SERVER);s['status']['settings']['library']['libraryPath']=''
        page=open_page(server=s);search(page,'download')
        page.locator('[data-torrent-row="h1"]').click();page.locator('[data-torrent-continue]').click();page.wait_for_timeout(500)
        check('Without a library folder: a notice with a way to choose one, no start',page.locator('[data-torrent-no-library]').count()==1
              and page.locator('[data-torrent-download-start]').is_disabled())
        page.locator('[data-torrent-no-library] a').click();page.wait_for_timeout(300)
        check('The notice opens the library settings',page.evaluate('routes')[-1]=='/settings?tab=library')
        page.close()

        # Settings still on "none" (earlier Android versions stored it) with one provider: the phone searches that provider
        s=copy.deepcopy(SERVER);s['providers']=[PROVIDER('nyaa','Nyaa')];s['status']['settings']['library']['torrentProvider']='none'
        page=open_page(server=s);search(page,'torrentstream-select',5)
        last=reqs(page,'POST','/api/v1/torrent/search')
        check('"none" stored, one provider: it is searched and its torrents are listed',bool(last) and last[-1]['provider']=='nyaa'
              and page.locator('[data-torrent-row]').count()==3 and page.locator('[data-torrent-provider]').count()==0)
        page.close()

        # No provider, no results, provider error
        s=copy.deepcopy(SERVER);s['providers']=[]
        page=open_page(server=s);search(page,'torrentstream-select',5)
        check('No provider: says how to get one and links to Extensions',page.locator('[data-torrent-no-provider]').count()==1)
        page.locator('[data-torrent-no-provider] a').click();page.wait_for_timeout(300)
        check('…and the link goes there',page.evaluate('routes')[-1]=='/extensions')
        page.locator('[data-anime-entry-dropdown-menu-trigger]').click();page.wait_for_timeout(450)
        check('More: no torrent download without a provider',page.locator('[data-entry-open="torrent-download"]').count()==0)
        page.close()
        s=copy.deepcopy(SERVER);s['empty']=True
        page=open_page(server=s);search(page,'torrentstream-select',5)
        check('No results: says so and offers the title search',page.locator('[data-torrent-empty]').count()==1 and 'Search by title' in page.locator('[data-torrent-empty]').inner_text())
        page.locator('[data-torrent-empty] button').click();page.wait_for_timeout(900)
        check('…which switches to it',reqs(page,'POST','/api/v1/torrent/search')[-1]['type']=='simple')
        page.close()
        s=copy.deepcopy(SERVER);s['searchFails']=True
        page=open_page(server=s);search(page,'torrentstream-select',5,wait=1200)
        check('Provider error: a notice with Try again',page.locator('[data-torrent-error]').count()==1)
        n=len(reqs(page,'POST','/api/v1/torrent/search'))
        page.locator('[data-torrent-error] button').click();page.wait_for_timeout(600)
        check('Try again searches again',len(reqs(page,'POST','/api/v1/torrent/search'))>n)
        page.close()

        # The Torrent source: a tap on an episode (a real touch) opens the search for it
        page=open_page(screen='source');page.wait_for_timeout(800)
        targets=page.locator('[data-torrent-stream-page] .mobile-episode-target')
        check('Torrent source on a phone: the phone switch, not the desktop switches',page.locator('[data-torrent-stream-page] [data-stream-controls-phone]').count()==1
              and page.locator('[data-torrent-stream-page-content-actions-container]').count()==0)
        check('Torrent source: every episode is one large tap target',targets.count()>=4 and all(b['height']>=48 for b in [targets.nth(i).bounding_box() for i in range(targets.count())]))
        targets.nth(1).tap();page.wait_for_timeout(1200)
        check('Tapping an episode opens the torrent search for that episode',page.locator('[data-torrent-search-phone=torrent]').count()==1
              and page.locator('[data-torrent-context]').inner_text()=='Episode 2' and reqs(page,'POST','/api/v1/torrent/search')[-1]['episodeNumber']==2)
        shot(page,'torrents-source-tap-390.png')
        page.close()

        # Downloads › Torrents
        page=open_page(screen='downloads');page.wait_for_timeout(500)
        check('Torrents tab: downloading and done in their own groups',page.evaluate(TEXT,'[data-torrent-group] h2')==['Downloading','Done'])
        active=page.locator('[data-torrent-group=active] [data-torrent-hash]')
        check('A download shows progress, size, speed and time left',active.count()==1 and active.locator('[role=progressbar]').get_attribute('aria-valuenow')=='42'
              and active.locator('.mdl-row-meta').inner_text()=='42 % · 38.2 GiB · ↓ 3.4 MB/s · 2 hours left')
        check('A finished one says it is done and shared',page.locator('[data-torrent-group=done] .mdl-row-meta').inner_text()=='Done · sharing · 1.4 GiB')
        check('Rows and buttons are at least 48px',page.evaluate(SMALL,'[data-torrent-downloads] button')==[])
        shot(page,'torrents-tab-390.png')
        page.locator('[data-torrent-toggle]').click();page.wait_for_timeout(1800)
        check('Pause sends pause and the row offers resume',reqs(page,'POST','/api/v1/torrent-client/action')[-1]=={'hash':'h2','action':'pause'}
              and 'Resume' in page.locator('[data-torrent-toggle]').get_attribute('aria-label'))
        page.locator('[data-torrent-hash="h2"] .mdl-row-main').click();page.wait_for_timeout(500)
        check('Sheet: state, progress, peers and the folder',page.locator('[data-torrent-sheet]').count()==1 and 'Paused' in page.locator('[data-torrent-facts]').inner_text()
              and f'{LIBRARY}/Sousou no Frieren' in page.locator('[data-torrent-facts]').inner_text())
        check('Sheet controls are at least 48px',small(page)==[])
        page.locator('[data-torrent-delete]').click();page.wait_for_timeout(300)
        check('Deleting asks first and says the files go too',page.locator('[data-torrent-delete-confirm]').count()==1
              and 'everything it downloaded is deleted' in page.locator(SHEET).inner_text())
        shot(page,'torrents-delete-390.png')
        page.locator('[data-torrent-delete-confirm]').click();page.wait_for_timeout(1800)
        check('Delete files removes the torrent with its files',reqs(page,'POST','/api/v1/torrent-client/action')[-1]=={'hash':'h2','action':'remove'}
              and page.locator('[data-torrent-hash="h2"]').count()==0 and page.locator(SHEET).count()==0)
        page.locator('[data-torrent-hash="h1"] .mdl-row-main').click();page.wait_for_timeout(500)
        page.locator('[data-torrent-remove]').click();page.wait_for_timeout(1800)
        check('Remove from the list keeps the files',reqs(page,'POST','/api/v1/torrent-client/action')[-1]=={'hash':'h1','action':'remove-keep-files'}
              and page.locator('[data-torrent-downloads-empty]').count()==1)
        shot(page,'torrents-empty-390.png')
        page.close()

        # German, narrow and large text
        page=open_page(language='de');search(page,'download')
        check('German: sheet, context and rows',page.locator(f'{SHEET} .UI-Modal__title').inner_text()=='Torrent herunterladen'
              and page.locator('[data-torrent-context]').inner_text()=='Fehlende Folgen: 1–3, 5' and '140 Seeder' in page.locator('[data-torrent-row="h2"]').inner_text())
        page.close()
        page=open_page(screen='downloads',language='de')
        check('German: Torrents tab',page.evaluate(TEXT,'[data-torrent-group] h2')==['Wird geladen','Fertig'])
        page.close()
        page=open_page(width=320,height=640,html_style='font-size:200%');search(page,'torrentstream-select',5)
        check('320px with 200% text: no overflow in the search sheet',page.evaluate(NO_OVERFLOW) and page.evaluate(
            f'[...document.querySelectorAll("{SHEET} [data-torrent-row]")].every(e=>e.getBoundingClientRect().right<=innerWidth+1)'))
        shot(page,'torrents-320-200.png')
        page.close()
        page=open_page(screen='downloads',width=320,height=640,html_style='font-size:200%')
        check('320px with 200% text: no overflow in the Torrents tab',page.evaluate(NO_OVERFLOW))
        page.close()
        browser.close()
check('No script errors',errors==[])
print(json.dumps(checks,indent=2))
