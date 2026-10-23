"""Settings on Android phones: the area list and every area's page (App, Appearance, Playback, Local library, Online
streaming, Torrents & debrid, Manga, Nakama, Logs & cache, About), instant saving per row (PATCH /settings/path, the theme as the stored theme
plus the change, device-only values in localStorage) that survives a reload, rollback with a toast when saving fails, saves
in a row that do not undo each other, confirmations before anything that cannot be undone, text sheets with validation,
the folder picker bridge, deep links (?tab=), Android Back (sheet, then page, then the screen), desktop-only settings
absent, German texts, 48px targets, no overflow at 390px and at 320px with 200% text, the tablet layout on tablets.
Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, copy
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
if shots: shots.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];warnings=[];console_all=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name,full=True):
    if shots: page.screenshot(path=str(shots/name),full_page=full)

THEME=dict(id=1,enableColorSettings=False,backgroundColor='',accentColor='',sidebarBackgroundColor='',animeEntryScreenLayout='',expandSidebarOnHover=False,
    hideTopNavbar=False,enableMediaCardBlurredBackground=False,libraryScreenCustomBackgroundImage='',libraryScreenCustomBackgroundOpacity=0,
    smallerEpisodeCarouselSize=False,libraryScreenBannerType='',libraryScreenCustomBannerImage='',libraryScreenCustomBannerPosition='',
    libraryScreenCustomBannerOpacity=0,disableLibraryScreenGenreSelector=False,libraryScreenCustomBackgroundBlur='',enableMediaPageBlurredBackground=False,
    disableSidebarTransparency=False,useLegacyEpisodeCard=False,disableCarouselAutoScroll=False,mediaPageBannerType='',mediaPageBannerSize='',
    mediaPageBannerInfoBoxSize='',showEpisodeCardAnimeInfo=False,continueWatchingDefaultSorting='',animeLibraryCollectionDefaultSorting='',
    mangaLibraryCollectionDefaultSorting='',showAnimeUnwatchedCount=False,showMangaUnreadCount=False,hideEpisodeCardDescription=False,
    hideDownloadedEpisodeCardFilename=False,customCSS='',mobileCustomCSS='',unpinnedMenuItems=None,homeItems=None,enableBlurringEffects=False,
    hideAnimeSpoilers=False,hideAnimeSpoilerThumbnails=False,hideAnimeSpoilerTitles=False,hideAnimeSpoilerDescriptions=False,hideAnimeSpoilerSkipNextEpisode=False)
LIBRARY=dict(libraryPath='',autoUpdateProgress=True,disableUpdateCheck=False,torrentProvider='none',autoScan=False,enableOnlinestream=True,
    includeOnlineStreamingInLibrary=True,disableAnimeCardTrailers=False,enableManga=True,openWebURLOnStart=False,refreshLibraryOnStart=False,
    autoPlayNextEpisode=False,enableWatchContinuity=True,libraryPaths=None,scannerMatchingThreshold=0,scannerMatchingAlgorithm='',autoSyncToLocalAccount=False,
    useFallbackMetadataProvider=False,scannerUseLegacyMatching=False,scannerConfig='',updateChannel='github',enableExtensionSecureMode=False,defaultPlaybackSource='')
STATUS=dict(version='3.10.4',versionName='Hakumei',os='android',isOffline=False,dataDir='/data/user/0/com.seanime.app.local/files',
    user=dict(viewer=dict(name='Nick'),isSimulated=False),featureFlags=dict(),themeSettings=THEME,
    settings=dict(library=LIBRARY,anilist=dict(hideAudienceScore=False,enableAdultContent=False,blurAdultContent=False,disableCacheLayer=False),
        manga=dict(defaultMangaProvider='',mangaAutoUpdateProgress=False,mangaLocalSourceDirectory=''),
        nakama=dict(enabled=False,username='',isHost=False,hostPassword='',remoteServerURL='',remoteServerPassword='',includeNakamaAnimeLibrary=False),
        mediaPlayer=dict(defaultPlayer='mpv'),torrent=dict(defaultTorrentClient='seanime',seanimeDownloadLimit=0,seanimeUploadLimit=0,seanimeMaxActiveDownloads=3),
        discord=dict(),notifications=dict()),
    torrentstreamSettings=dict(id=1,enabled=False,autoSelect=False,preferredResolution='',disableIPV6=False,downloadDir='',addToLibrary=False,torrentClientHost='',
        torrentClientPort=43213,streamingServerHost='',streamingServerPort=43214,includeInLibrary=False,streamUrlAddress='',slowSeeding=False,preloadNextStream=False,
        disableAcceleratedStartup=False),
    debridSettings=dict(id=1,enabled=False,provider='',apiKey='',includeDebridStreamInLibrary=False,streamAutoSelect=False,streamPreferredResolution=''))
SERVER=dict(status=STATUS,apiWorking=False,cacheSize='4.3 MiB',logContent='2026-10-21 12:00:00 |INF| app started\n2026-10-21 12:00:01 |WRN| cache-only mode',
    logFiles=['seanime-2026-10-21_10-00-00.log','seanime-2026-10-20_09-00-00.log','2026-10-21_10-05-00-scan.log'],
    memory=dict(alloc=1,totalAlloc=52428800,sys=1,heapAlloc=1,heapSys=33554432,heapInuse=20971520,numGoroutine=42,numGC=17),
    mangaProviders=[dict(id='dipland-mangafire',name='MangaFire'),dict(id='local-manga',name='Local')],episodeTabs=[],
    storedProviders={'117460':'local-manga'},validDebridKey='good-key-123',
    torrentProviders=[dict(id='nyaa',name='Nyaa',lang='en',settings=dict(type='main',canSmartSearch=True,supportsAdult=False)),
        dict(id='animetosho',name='AnimeTosho',lang='en',settings=dict(type='main',canSmartSearch=True,supportsAdult=False)),
        dict(id='nyaa-sukebei',name='Sukebei',lang='en',settings=dict(type='special',canSmartSearch=False,supportsAdult=True))])
INIT='''(()=>{const stored=sessionStorage.getItem("settings-fixture");Object.assign(window,{server:stored?JSON.parse(stored):%s,routes:[],requests:[],toasts:[],clipboard:[],
    tabs:[],saves:[],updateModal:[],issueRecorder:[],mangaSources:[],tutorial:0,updateChecks:0});
    window.SeanimeAndroid={getAppVersion:()=>"1.9.37",setLanguage:l=>{window.nativeLanguage=l},pickFolder:id=>{window.picks=(window.picks||0)+1;setTimeout(()=>
        dispatchEvent(new CustomEvent("seanime-folder-picked",{detail:Object.assign({requestId:id},window.folderAnswer||{path:"/storage/emulated/0/Anime"})})),60)}}})()'''
# AndroidNavigation.backScript: what the app runs when the Android Back button is pressed.
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
TEXT_ZOOM='-webkit-text-size-adjust:200%;text-size-adjust:200%'
STATIC=root/'backend/seanime-web/out/static'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
TARGETS=':is(button,a,select,input,textarea,[role=switch],[role=tab],[role=radio])'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>(b.textContent||b.getAttribute("aria-label")||b.tagName).trim().slice(0,40)))'''
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
OPEN_SHEETS='document.querySelectorAll(".UI-Modal__content[data-state=open]").length'
SECTION='document.querySelector("[data-phone-screen=settings]")?.dataset.settingsSection'
H1='document.querySelector("[data-phone-screen=settings] h1")?.textContent'
SECTIONS=['seanime','ui','playback','library','onlinestream','torrents','manga','nakama','logs','about']
# Desktop-only settings (§5.1, the verify results V2-V4) that must not reach the phone screen.
DESKTOP_ONLY=['Desktop media player','Transcoding','Direct Play','Discord','Open Data directory','Open data directory','assets directory','Keyboard',
    'command palette','Torrent','Debrid','Expand sidebar','sidebar transparency','top navbar','Unpinned','Import local','logs directory',
    'media streaming cache','card trailers','web UI on startup','system notifications','Auto Scanner','Home screen banner','Media screen banner',
    'genre selector','glassy','Hosting','Share local anime library','Update channel','Denshi','MpvCore','above 1024px']
SWITCH='[data-phone-screen=settings] [data-setting="%s"]'
THEME_SWITCH='[data-phone-screen=settings] [data-theme-field="%s"]'

def last(page,method,endpoint):
    hits=[r for r in page.evaluate('requests') if r[0]==method and r[1]==endpoint]
    return hits[-1][2] if hits else None
def count(page,method,endpoint): return len([r for r in page.evaluate('requests') if r[0]==method and r[1]==endpoint])
def checked(page,sel): return page.locator(sel).get_attribute('aria-checked')

with tempfile.TemporaryDirectory(prefix='seanime-settings-') as tmp:
    bundle=Path(tmp)/'settings.js'
    subprocess.run(['node',str(root/'tests/mobile_settings_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,language=None,server=None,storage=None,path='/settings',html_style='',ready='[data-phone-screen="settings"]'):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.on('console',lambda m:warnings.append(m.text[:300]) if m.type=='error' else None)
            page.on('console',lambda m:console_all.append(m.text))
            page.add_init_script(INIT%json.dumps(server or copy.deepcopy(SERVER)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            for key,value in (storage or {}).items(): page.add_init_script(f'if(!sessionStorage.getItem("seeded-{key}")){{sessionStorage.setItem("seeded-{key}","1");localStorage.setItem({json.dumps(key)},{json.dumps(json.dumps(value))})}}')
            page.route('http://settings.test/static/font/**',lambda r:r.fulfill(path=str(STATIC/'font'/r.request.url.split('/')[-1])))
            html=f'<html class="dark" lang="en" style="{html_style}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'
            page.route('http://settings.test/settings*',lambda r:r.fulfill(content_type='text/html',body=html))
            page.route('http://settings.test/',lambda r:r.fulfill(content_type='text/html',body=html))
            def load():
                for css in (STATIC/'css').rglob('*.css'):page.add_style_tag(path=str(css))
                page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
                page.locator(ready).first.wait_for();page.evaluate('document.fonts.ready');page.wait_for_timeout(500)
            page.goto('http://settings.test'+path);load()
            page.load=load
            page.reload_app=lambda:(page.reload(),load())
            return page
        def back(page):
            ok=page.evaluate(NATIVE_BACK);page.wait_for_timeout(350);return ok
        def open_section(page,id):
            page.locator(f'[data-settings-open="{id}"]').click();page.locator(f'[data-settings-page="{id}"]').wait_for();page.wait_for_timeout(250)
        def tap(page,sel,wait=350):
            page.locator(sel).first.click();page.wait_for_timeout(wait)
        def small(page): return page.evaluate(SMALL,f'[data-phone-screen] {TARGETS}, .ps-sheet {TARGETS}')
        def page_text(page): return page.locator('[data-phone-screen=settings]').inner_text()

        # Home
        page=open_page()
        check('Phone screen replaces the desktop tabs',page.locator('[data-desktop-settings]').count()==0 and page.locator('[data-settings-page-tabs]').count()==0
              and page.evaluate(H1)=='Settings' and page.evaluate(SECTION)=='home')
        check('Facts: the server and app versions',page.locator('[data-phone-facts]').inner_text()=='Seanime 3.10.4 · App 1.9.37')
        check('Areas in order, each with a summary',page.evaluate('[...document.querySelectorAll("[data-settings-open]")].map(b=>b.dataset.settingsOpen)')==SECTIONS
              and page.evaluate(TEXT,'[data-settings-open] .pst-row-text > span')==['App','Appearance','Playback','Local library','Online streaming','Torrents & debrid','Manga','Nakama','Logs & cache','About']
              and all(page.evaluate(TEXT,'[data-settings-open] small')))
        check('Home: every target at least 48px, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'settings-home-390.png')

        # Every area: its page, 48px, no overflow, no desktop-only setting, Back to the list (focus on the area), then out
        for id in SECTIONS:
            open_section(page,id)
            text=page_text(page)
            check(f'{id}: page with Back and its title, no Save button',page.evaluate(SECTION)==id and page.locator('[data-settings-back]').count()==1
                  and page.get_by_role('button',name='Save',exact=True).count()==0)
            check(f'{id}: every target at least 48px, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
            # The torrents area is about torrents and Debrid; its desktop-only parts are checked below (TORRENT_DESKTOP_ONLY)
            found=[word for word in DESKTOP_ONLY if word.lower() in text.lower() and not (id=='torrents' and word in ('Torrent','Debrid'))]
            check(f'{id}: no desktop-only setting ({found})',found==[])
            shot(page,f'settings-{id}-390.png')
            check(f'{id}: Back returns to the list with the focus on the area',back(page) and page.evaluate(SECTION)=='home'
                  and page.evaluate('document.activeElement?.dataset.settingsOpen')==id)
        check('Back on the list leaves the screen (the app goes back)',back(page) is False)

        # App: instant saves, theme merge without defaults, selects, failures, saves in a row
        open_section(page,'seanime')
        sw=SWITCH%'library.autoUpdateProgress'
        check('A switch shows the stored value',checked(page,sw)=='true')
        page.locator(sw).click()
        check('Tap saves at once: the switch flips and PATCH /settings/path carries only that value',checked(page,sw)=='false'
              and last(page,'PATCH','/api/v1/settings/path')=={'path':'library.autoUpdateProgress','value':False})
        page.wait_for_timeout(400)
        page.locator(THEME_SWITCH%'hideAnimeSpoilers').click();page.wait_for_timeout(500)
        sent=last(page,'PATCH','/api/v1/theme')['theme']
        check('Theme switch: the stored theme plus the change, empty fields stay empty (no defaults stored)',sent['hideAnimeSpoilers'] is True
              and sent['accentColor']=='' and sent['continueWatchingDefaultSorting']=='' and sent['libraryScreenCustomBannerOpacity']==0)
        check('Spoiler parts appear under the switch',page.locator('[data-phone-screen] [data-settings-sub][data-theme-field^="hideAnimeSpoiler"]').count()==4)
        page.select_option('#pst-default-source','library');page.wait_for_timeout(400)
        check('Default episode source: options without torrent/Debrid, saved at once',page.evaluate(TEXT,'#pst-default-source option')==['Automatic','Local library','Online streaming']
              and last(page,'PATCH','/api/v1/settings/path')=={'path':'library.defaultPlaybackSource','value':'library'})
        page.locator(SWITCH%'anilist.enableAdultContent').click();page.wait_for_timeout(400)
        check('Adult content shows its blur switch',page.locator(SWITCH%'anilist.blurAdultContent').count()==1)
        page.evaluate('failWhen=["settings/path"]')
        page.locator(SWITCH%'library.enableExtensionSecureMode').click()
        flipped=checked(page,SWITCH%'library.enableExtensionSecureMode');page.wait_for_timeout(500)
        check('A failed save flips back with a toast',flipped=='true' and checked(page,SWITCH%'library.enableExtensionSecureMode')=='false'
              and ['error','The setting could not be saved. Try again.'] in page.evaluate('toasts'))
        page.evaluate('failWhen=[];latency=300')
        page.locator(THEME_SWITCH%'hideAnimeSpoilerTitles').click();page.locator(THEME_SWITCH%'hideAnimeSpoilerDescriptions').click();page.wait_for_timeout(1200)
        stored=page.evaluate('server.status.themeSettings')
        check('Two quick saves in a row both stay stored',stored['hideAnimeSpoilerTitles'] is True and stored['hideAnimeSpoilerDescriptions'] is True and stored['hideAnimeSpoilers'] is True)
        page.evaluate('latency=80')
        page.locator('[data-settings-cache-only]').click();page.wait_for_timeout(500)
        check('Cache-only mode switches the server state',count(page,'POST','/api/v1/anilist/cache-layer/status')==1 and checked(page,'[data-settings-cache-only]')=='false')
        page.locator('[data-settings-tutorial]').click();page.wait_for_timeout(200)
        check('Setup tutorial starts',page.evaluate('tutorial')==1)
        page.locator('[data-settings-upload-lists]').click();page.locator('[data-settings-upload-confirm]').wait_for();page.wait_for_timeout(300)
        check('Upload to AniList asks first; the sheet\'s targets are 48px',page.evaluate(OPEN_SHEETS)==1 and small(page)==[])
        shot(page,'settings-confirm-390.png',full=False)
        check('Back closes the question first, the page stays',back(page) and page.evaluate(OPEN_SHEETS)==0 and page.evaluate(SECTION)=='seanime'
              and count(page,'POST','/api/v1/local/sync-simulated-to-anilist')==0)
        page.locator('[data-settings-upload-lists]').click();page.locator('[data-confirm-action]').click();page.wait_for_timeout(400)
        check('Confirmed upload is sent once',count(page,'POST','/api/v1/local/sync-simulated-to-anilist')==1)
        page.reload_app();open_section(page,'seanime')
        check('After a reload every saved value is still there (no Save button needed)',checked(page,SWITCH%'library.autoUpdateProgress')=='false'
              and checked(page,THEME_SWITCH%'hideAnimeSpoilers')=='true' and page.locator('#pst-default-source').input_value()=='library'
              and checked(page,SWITCH%'library.enableExtensionSecureMode')=='false' and checked(page,SWITCH%'anilist.enableAdultContent')=='true')
        with page.expect_navigation(): page.locator('[data-settings-language] [data-tab-value="de"]').click()
        page.load()
        check('Language: Deutsch is stored, told to Android and the app reloads in German',page.evaluate('localStorage.getItem("seanime-mobile-language")')=='"de"'
              and page.evaluate('nativeLanguage')=='de' and page.evaluate(H1)=='Einstellungen')
        page.evaluate('localStorage.setItem("seanime-mobile-language",JSON.stringify("en"))')
        page.close()

        # Appearance
        page=open_page();open_section(page,'ui')
        page.locator(THEME_SWITCH%'enableColorSettings').click();page.wait_for_timeout(400)
        check('Custom colours: presets and both colour dialogs appear',page.locator('[data-settings-colour-presets] button').count()==8
              and page.locator('input[type=color]').count()==2)
        page.locator('[data-preset="Midnight"]').click();page.wait_for_timeout(400)
        sent=last(page,'PATCH','/api/v1/theme')['theme']
        check('A preset saves both colours at once and shows as chosen',sent['backgroundColor']=='#000' and sent['accentColor']=='#5649bb'
              and sent['enableColorSettings'] is True and page.locator('[data-preset="Midnight"]').get_attribute('aria-pressed')=='true')
        page.evaluate('''(()=>{const i=document.querySelector('input[data-theme-field=backgroundColor]');i.value="#f0f0f0";i.dispatchEvent(new Event("change"))})()''');page.wait_for_timeout(300)
        check('A light background is refused',['error','Seanime only supports dark backgrounds.'] in page.evaluate('toasts') and page.evaluate('server.status.themeSettings.backgroundColor')=='#000')
        page.evaluate('''(()=>{const i=document.querySelector('input[data-theme-field=accentColor]');i.value="#1d975a";i.dispatchEvent(new Event("change"))})()''');page.wait_for_timeout(400)
        check('The accent colour saves from its dialog',page.evaluate('server.status.themeSettings.accentColor')=='#1d975a')
        page.locator('[data-theme-field="libraryScreenCustomBackgroundImage"]').click();page.locator('[data-settings-text-sheet]').wait_for();page.wait_for_timeout(300)
        page.locator('[data-text-input]').fill('ftp://example.com/bg.png')
        check('A background that is not an https link is refused',page.locator('[data-text-apply]').is_disabled()
              and page.locator('[data-settings-text-sheet] small').inner_text()=='Enter a link that starts with https://')
        shot(page,'settings-text-sheet-390.png',full=False)
        page.locator('[data-text-input]').fill('https://example.com/bg.png');page.locator('[data-text-apply]').click();page.wait_for_timeout(400)
        check('A background link saves and its opacity appears',page.evaluate('server.status.themeSettings.libraryScreenCustomBackgroundImage')=='https://example.com/bg.png'
              and page.locator('#pst-background-opacity').count()==1 and page.locator('#pst-background-opacity').input_value()=='10')
        page.select_option('#pst-background-opacity','40');page.wait_for_timeout(400)
        page.select_option('#pst-sort-continue','LAST_WATCHED_DESC');page.wait_for_timeout(400)
        check('Opacity and sorting save at once',page.evaluate('server.status.themeSettings.libraryScreenCustomBackgroundOpacity')==40
              and page.evaluate('server.status.themeSettings.continueWatchingDefaultSorting')=='LAST_WATCHED_DESC'
              and 'LAST_WATCHED' not in [o for o in page.evaluate(TEXT,'#pst-sort-anime option') if 'END' in o])
        page.locator(THEME_SWITCH%'useLegacyEpisodeCard').click();page.wait_for_timeout(400)
        page.select_option('#pst-preload','viewport');page.wait_for_timeout(200)
        check('Card switch and page preloading (this phone) save',page.evaluate('server.status.themeSettings.useLegacyEpisodeCard') is True
              and page.evaluate('localStorage.getItem("sea-ui-settings-navigation-preload-mode")')=='"viewport"')
        page.locator('[data-theme-field="mobileCustomCSS"]').click();page.locator('[data-settings-text-sheet] textarea').fill('.x { color: red }')
        page.locator('[data-text-apply]').click();page.wait_for_timeout(500)
        check('Phone CSS is stored and applied to this phone',page.evaluate('server.status.themeSettings.mobileCustomCSS')=='.x { color: red }'
              and json.loads(page.evaluate('localStorage.getItem("sea-custom-css")'))['mobileCustomCSS']=='.x { color: red }'
              and page.locator('[data-settings-apply-css]').count()==0)
        check('Appearance after the changes: 48px, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'settings-ui-changed-390.png')
        page.close()

        # Playback
        page=open_page();open_section(page,'playback')
        check('Files play in the built-in player by default',page.locator('[data-choice="builtin"]').get_attribute('aria-checked')=='true')
        page.locator('[data-choice="external"]').click();page.wait_for_timeout(200)
        check('External player without a link says what to do',page.evaluate('localStorage.getItem("sea-playback-downloaded-media")')=='"externalPlayerLink"'
              and page.locator('[data-settings-external-missing]').count()==1)
        page.locator('[data-settings-external-presets] [data-chip="org.videolan.vlc"]').click();page.wait_for_timeout(200)
        check('VLC preset fills in the intent link',json.loads(page.evaluate('localStorage.getItem("sea-playback-external-player-link")'))
              =='intent://{url}#Intent;scheme=http;type=video/*;package=org.videolan.vlc;end'
              and page.locator('[data-settings-external-missing]').count()==0 and page.locator('[data-settings-external-link] .pst-row-value').inner_text()=='VLC'
              and page.locator('[data-chip="org.videolan.vlc"]').get_attribute('aria-pressed')=='true')
        page.locator(SWITCH%'library.autoPlayNextEpisode').click();page.wait_for_timeout(400)
        page.locator('[data-settings-encode-path]').click();page.wait_for_timeout(200)
        check('Next episode saves on the server, path encoding on the phone',page.evaluate('server.status.settings.library.autoPlayNextEpisode') is True
              and page.evaluate('localStorage.getItem("sea-playback-external-player-link-encode-path")')=='true')
        page.reload_app();open_section(page,'playback')
        check('After a reload: external player, VLC and next episode kept',page.locator('[data-choice="external"]').get_attribute('aria-checked')=='true'
              and page.locator('[data-chip="org.videolan.vlc"]').get_attribute('aria-pressed')=='true' and checked(page,SWITCH%'library.autoPlayNextEpisode')=='true')
        page.close()

        # Local library: folder picker, extra folders, matching, export
        page=open_page();open_section(page,'library')
        page.locator('[data-setting="library.libraryPath"]').click();page.locator('[data-settings-pick-folder]').click();page.wait_for_timeout(400)
        check('Choose folder fills the field with the picked path',page.locator('[data-text-input]').input_value()=='/storage/emulated/0/Anime')
        page.locator('[data-text-apply]').click();page.wait_for_timeout(400)
        check('The library folder is saved',last(page,'PATCH','/api/v1/settings/path')=={'path':'library.libraryPath','value':'/storage/emulated/0/Anime'}
              and page.locator('[data-setting="library.libraryPath"] .pst-row-value').inner_text()=='/storage/emulated/0/Anime')
        page.evaluate('folderAnswer={error:"permission"}');page.locator('[data-settings-add-folder]').click();page.wait_for_timeout(400)
        check('Without file access: a toast says how, nothing is saved',['error','Allow "All files access" for Seanime, then choose the folder again.'] in page.evaluate('toasts')
              and count(page,'PATCH','/api/v1/settings/path')==1)
        page.evaluate('folderAnswer={error:"cancelled"};toasts=[]');page.locator('[data-settings-add-folder]').click();page.wait_for_timeout(400)
        check('Cancelling the picker stays silent',page.evaluate('toasts')==[] and count(page,'PATCH','/api/v1/settings/path')==1)
        page.evaluate('folderAnswer={path:"/storage/emulated/0/Movies/Anime"}');page.locator('[data-settings-add-folder]').click();page.wait_for_timeout(500)
        check('Another folder is added',page.evaluate('server.status.settings.library.libraryPaths')==['/storage/emulated/0/Movies/Anime']
              and page.locator('[data-settings-extra-folder]').count()==1)
        page.locator('[data-settings-extra-folder]').click();page.locator('[data-settings-remove-folder]').wait_for();page.wait_for_timeout(300)
        check('Removing a folder asks first; Back keeps it',back(page) and page.evaluate(OPEN_SHEETS)==0 and page.evaluate('server.status.settings.library.libraryPaths')==['/storage/emulated/0/Movies/Anime'])
        page.locator('[data-settings-extra-folder]').click();page.locator('[data-confirm-action]').click();page.wait_for_timeout(500)
        check('Confirmed: the folder is removed',page.evaluate('server.status.settings.library.libraryPaths')==[] and page.locator('[data-settings-extra-folder]').count()==0)
        page.locator('[data-setting="library.scannerConfig"]').click();page.locator('[data-settings-text-sheet] textarea').fill('{"matching": ')
        check('Scanner rules: invalid JSON cannot be applied',page.locator('[data-text-apply]').is_disabled())
        page.locator('[data-settings-text-sheet] textarea').fill('{"matching":{"rules":[]}}');page.locator('[data-text-apply]').click();page.wait_for_timeout(400)
        page.locator(SWITCH%'library.scannerUseLegacyMatching').click();page.wait_for_timeout(500)
        page.select_option('#pst-matching-threshold','0.7');page.wait_for_timeout(400)
        check('Scanner rules, legacy matching and its threshold save',page.evaluate('server.status.settings.library.scannerConfig')=='{"matching":{"rules":[]}}'
              and page.evaluate('server.status.settings.library.scannerMatchingThreshold')==0.7 and page.locator('#pst-matching-algorithm').count()==1)
        page.locator('[data-settings-export]').click();page.wait_for_timeout(300)
        check('Export saves the library data through the Save dialog',page.evaluate('saves')==[['/api/v1/library/local-files/dump','seanime-localfiles-2026-10-21_12-00-00.json',False]])
        check('Library: 48px, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        page.close()

        # Online streaming, Manga, Nakama, About
        page=open_page();open_section(page,'onlinestream')
        page.locator(SWITCH%'library.includeOnlineStreamingInLibrary').click();page.wait_for_timeout(400)
        check('Online streaming in lists saves',page.evaluate('server.status.settings.library.includeOnlineStreamingInLibrary') is False)
        back(page);open_section(page,'manga')
        check('Manga: sources listed, no overwrite without a default source',page.evaluate(TEXT,'#pst-manga-provider option')==['Automatic','Local','MangaFire']
              and page.locator('[data-settings-overwrite-sources]').count()==0)
        page.select_option('#pst-manga-provider','dipland-mangafire');page.wait_for_timeout(400)
        page.locator('[data-settings-overwrite-sources]').click();page.locator('[data-confirm-cancel]').click();page.wait_for_timeout(300)
        check('Overwriting all sources asks first; Cancel changes nothing',page.evaluate('mangaSources')==[])
        page.locator('[data-settings-overwrite-sources]').click();page.locator('[data-confirm-action]').click();page.wait_for_timeout(300)
        page.locator('[data-settings-undo-sources]').click();page.wait_for_timeout(300)
        check('Overwrite and Undo',page.evaluate('mangaSources')==[['all','dipland-mangafire'],['restore',{'117460':'local-manga'}]])
        page.locator('[data-setting="manga.mangaLocalSourceDirectory"]').click();page.locator('[data-settings-pick-folder]').click();page.wait_for_timeout(400)
        page.locator('[data-text-apply]').click();page.wait_for_timeout(400)
        check('Local manga folder from the picker',page.evaluate('server.status.settings.manga.mangaLocalSourceDirectory')=='/storage/emulated/0/Anime')
        back(page);open_section(page,'nakama')
        page.locator('[data-setting="nakama.remoteServerPassword"]').click();page.locator('[data-text-input]').fill('s3cret');page.locator('[data-text-apply]').click();page.wait_for_timeout(400)
        check('Nakama passcode saves and shows as dots, never as text',page.evaluate('server.status.settings.nakama.remoteServerPassword')=='s3cret'
              and 's3cret' not in page_text(page) and page.locator('[data-setting="nakama.remoteServerPassword"] .pst-row-value').inner_text()=='••••••'
              and page.locator('[data-setting="nakama.remoteServerPassword"] input').count()==0)
        check('No host mode on a phone that never hosted',page.locator(SWITCH%'nakama.isHost').count()==0)
        check('No connection row while Nakama is off',page.locator('[data-nakama-connection]').count()==0)
        page.locator(SWITCH%'nakama.enabled').click();page.wait_for_timeout(300)
        page.locator('[data-setting="nakama.remoteServerURL"]').click();page.locator('[data-text-input]').fill('http://192.168.1.20:43211');page.locator('[data-text-apply]').click();page.wait_for_timeout(400)
        conn=page.locator('[data-nakama-connection]')
        check('Nakama on with a host: the connection says not connected and how to fix it',conn.get_attribute('data-nakama-connection')=='offline'
              and 'Not connected' in conn.inner_text() and 'passcode' in conn.inner_text())
        page.evaluate("setNakamaStatus({isHost:false,isConnectedToHost:true,connectionMode:'direct',hostConnectionStatus:{connected:true,authenticated:true,url:'',peerId:'p1',username:'HomeServer',connectionMode:'direct'}})")
        page.wait_for_timeout(200)
        check('Connected to the host by its name',conn.get_attribute('data-nakama-connection')=='connected' and 'Connected to HomeServer' in conn.inner_text())
        conn.click();page.wait_for_timeout(400)
        check('A tap connects again',count(page,'POST','/api/v1/nakama/reconnect')==1)
        page.evaluate("setNakamaStatus(null)")
        back(page);open_section(page,'about')
        check('About: versions, update check switch (on = checking)',page.evaluate(TEXT,'[data-settings-versions] dd')==['1.9.37','3.10.4 Hakumei']
              and checked(page,SWITCH%'library.disableUpdateCheck')=='true')
        page.locator(SWITCH%'library.disableUpdateCheck').click();page.wait_for_timeout(400)
        check('Turning the check off stores disableUpdateCheck',page.evaluate('server.status.settings.library.disableUpdateCheck') is True)
        page.locator('[data-settings-check-updates]').click();page.wait_for_timeout(300)
        check('Check now: the native check, then a toast',page.evaluate('updateChecks')==1 and ['success','You are running the latest version'] in page.evaluate('toasts'))
        page.evaluate('server.update={release:{version:"1.9.99"}}');page.locator('[data-settings-check-updates]').click();page.wait_for_timeout(300)
        check('A new version opens the update dialog',page.evaluate('updateModal')==[True])
        check('Donate is a quiet link at the end',page.locator('[data-settings-donate]').get_attribute('href')=='https://github.com/sponsors/5rahim'
              and page.evaluate('getComputedStyle(document.querySelector("[data-settings-donate]")).textDecorationLine')=='underline')
        page.close()

        # Logs & cache
        page=open_page();open_section(page,'logs')
        page.locator('[data-settings-copy-log]').click();page.wait_for_timeout(400)
        page.locator('[data-settings-save-log]').click();page.wait_for_timeout(200)
        check('Current log: copied and saved as a file',page.evaluate('clipboard')==[SERVER['logContent']] and ['success','Log copied'] in page.evaluate('toasts')
              and page.evaluate('saves')==[['/api/v1/logs/latest','seanime-2026-10-21_12-00-00.log',True]])
        check('Cache size shows at once',page.locator('[data-settings-cache-size] .pst-row-value').inner_text()=='4.3 MiB')
        page.locator('[data-settings-log-filter] [data-tab-value="scanner"]').click();page.wait_for_timeout(200)
        check('Log filter: scanner logs only',page.evaluate('[...document.querySelectorAll("[data-settings-log-file]")].map(e=>e.dataset.settingsLogFile)')==['2026-10-21_10-05-00-scan.log'])
        page.locator('[data-settings-log-filter] [data-tab-value="all"]').click();page.wait_for_timeout(200)
        page.locator('[data-settings-log-file="seanime-2026-10-20_09-00-00.log"]').click();page.locator('[data-settings-log-content]').wait_for();page.wait_for_timeout(400)
        check('A log file opens with its content; its buttons are 48px',page.locator('[data-settings-log-content]').inner_text().startswith('seanime-2026-10-20_09-00-00.log')
              and small(page)==[])
        shot(page,'settings-log-sheet-390.png',full=False)
        page.locator('[data-log-delete]').click();page.locator('[data-settings-log-confirm]').wait_for();page.wait_for_timeout(300)
        check('Delete asks first; Back returns to the log',back(page) and page.locator('[data-settings-log-content]').count()==1 and count(page,'DELETE','/api/v1/logs')==0)
        page.locator('[data-log-delete]').click();page.locator('[data-confirm-action]').click();page.wait_for_timeout(500)
        check('Confirmed: the log is deleted and gone from the list',last(page,'DELETE','/api/v1/logs')=={'filenames':['seanime-2026-10-20_09-00-00.log']}
              and page.locator('[data-settings-log-file="seanime-2026-10-20_09-00-00.log"]').count()==0 and page.evaluate(OPEN_SHEETS)==0)
        page.locator('[data-settings-clear="manga"]').click();page.locator('[data-confirm-cancel]').click();page.wait_for_timeout(300)
        check('Clearing a cache asks first; Cancel clears nothing',count(page,'DELETE','/api/v1/filecache/bucket')==0)
        page.locator('[data-settings-clear="onlinestream"]').click();page.locator('[data-confirm-action]').click();page.wait_for_timeout(500)
        check('Confirmed: that cache is cleared and the size updates',last(page,'DELETE','/api/v1/filecache/bucket')=={'bucket':'onlinestream'}
              and page.locator('[data-settings-cache-size] .pst-row-value').inner_text()=='0 B')
        check('Developer tools start folded',page.locator('[data-settings-developer]').get_attribute('aria-expanded')=='false' and page.locator('[data-settings-gc]').count()==0)
        page.locator('[data-settings-developer]').click();page.wait_for_timeout(500)
        page.locator('[data-settings-profile="heap"]').click();page.wait_for_timeout(300)
        check('Unfolded: memory statistics and profiles through the Save dialog',page.locator('[data-settings-memory]').count()==1
              and page.evaluate('saves')[-1]==['/api/v1/memory/profile?heap=true','seanime-heap-profile-2026-10-21_12-00-00.pprof',False])
        check('Logs & cache: 48px, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'settings-logs-open-390.png')
        page.locator('[data-settings-record-issue]').click();page.wait_for_timeout(300)
        check('Record an issue opens the recorder on Home',page.evaluate('issueRecorder')==[True] and page.evaluate('routes')[-1]==['push','/'])
        page.close()

        # Torrents & debrid
        GROUPS='[...document.querySelectorAll("[data-settings-page] [data-settings-group]")].map(e=>e.dataset.settingsGroup)'
        TORRENT_DESKTOP_ONLY=['Port','Host','Stream URL','IPv6','Slow seeding','accelerated startup','Cache directory','Auto Downloader','qBittorrent','Transmission']
        page=open_page();open_section(page,'torrents')
        check('Torrents: providers, streaming, downloads, Debrid in order',page.evaluate(GROUPS)==['torrents-providers','torrents-streaming','torrents-downloads','torrents-debrid'])
        check('Providers: installed main providers sorted (special ones left out); "none" stored shows the provider searched, the first installed',
              page.evaluate(TEXT,'#pst-torrent-provider option')==['AnimeTosho','Nyaa'] and page.locator('#pst-torrent-provider').input_value()=='nyaa'
              and page.locator('[data-settings-no-providers]').count()==0)
        page.select_option('#pst-torrent-provider','animetosho');page.wait_for_timeout(400)
        check('Provider saves at once through settings/path',last(page,'PATCH','/api/v1/settings/path')=={'path':'library.torrentProvider','value':'animetosho'})
        check('Streaming off: only its switch, the data note above it',page.locator('[data-torrentstream-field]').count()==1
              and "connection's data" in page.locator('[data-settings-group="torrents-streaming"] .pst-group-note').inner_text())
        page.locator('[data-torrentstream-field="enabled"]').click()
        flipped=checked(page,'[data-torrentstream-field="enabled"]');page.wait_for_timeout(500)
        sent=last(page,'PATCH','/api/v1/torrentstream/settings')['settings']
        check('Turning streaming on saves at once: the stored row plus enabled through PATCH /torrentstream/settings',flipped=='true'
              and sent['enabled'] is True and sent['torrentClientPort']==43213 and sent['id']==1 and count(page,'PATCH','/api/v1/settings/path')==1)
        check('Streaming on: auto-select, preload and lists appear; resolution only with auto-select',
              page.evaluate('[...document.querySelectorAll("[data-torrentstream-field]")].map(e=>e.dataset.torrentstreamField)')==['enabled','autoSelect','preloadNextStream','includeInLibrary']
              and page.locator('#pst-torrentstream-resolution').count()==0)
        page.locator('[data-torrentstream-field="autoSelect"]').click();page.wait_for_timeout(400)
        check('Resolution choices',page.evaluate(TEXT,'#pst-torrentstream-resolution option')==['Highest','1080p','720p','480p'])
        page.select_option('#pst-torrentstream-resolution','720');page.wait_for_timeout(400)
        page.locator('[data-torrentstream-field="preloadNextStream"]').click();page.wait_for_timeout(400)
        ts=page.evaluate('server.status.torrentstreamSettings')
        check('Auto-select, resolution and preload stored, the rest of the row untouched',ts['enabled'] is True and ts['autoSelect'] is True
              and ts['preferredResolution']=='720' and ts['preloadNextStream'] is True and ts['torrentClientPort']==43213 and ts['streamUrlAddress']=='')
        found=[word for word in TORRENT_DESKTOP_ONLY if word.lower() in page_text(page).lower()]
        check(f'No desktop-only torrent setting ({found})',found==[])
        check('Downloads: no library folder yet, so a notice with a way there',page.locator('[data-settings-no-library-folder]').count()==1
              and 'local library folder' in page.locator('[data-settings-group="torrents-downloads"] .pst-group-note').inner_text())
        check('Limit choices: Unlimited first, KB/s and MB/s',page.evaluate(TEXT,'#pst-download-limit option')[:3]==['Unlimited','512 KB/s','1 MB/s'])
        page.select_option('#pst-download-limit','2048');page.wait_for_timeout(400)
        page.select_option('#pst-upload-limit','256');page.wait_for_timeout(400)
        page.select_option('#pst-active-downloads','2');page.wait_for_timeout(400)
        check('Download limit, upload limit and active downloads save as numbers',page.evaluate('server.status.settings.torrent')=={'defaultTorrentClient':'seanime',
              'seanimeDownloadLimit':2048,'seanimeUploadLimit':256,'seanimeMaxActiveDownloads':2}
              and last(page,'PATCH','/api/v1/settings/path')=={'path':'torrent.seanimeMaxActiveDownloads','value':2})
        check('Debrid off: only its switch',page.locator('[data-debrid-field]').count()==1 and page.locator('[data-settings-debrid-key]').count()==0)
        page.locator('[data-debrid-field="enabled"]').click();page.wait_for_timeout(400)
        check('Debrid on: providers the server accepts, no key field before a provider',page.evaluate(TEXT,'#pst-debrid-provider option')
              ==['None','TorBox','Real-Debrid','AllDebrid','Premiumize'] and page.locator('[data-settings-debrid-key]').count()==0
              and last(page,'PATCH','/api/v1/debrid/settings')['settings']['enabled'] is True)
        page.select_option('#pst-debrid-provider','torbox');page.wait_for_timeout(400)
        check('Provider saved; the key field is an empty password field and Save key waits for a key',page.evaluate('server.status.debridSettings.provider')=='torbox'
              and page.locator('[data-settings-debrid-key-input]').get_attribute('type')=='password' and page.locator('[data-settings-debrid-key-input]').input_value()==''
              and page.locator('[data-settings-debrid-key-save]').is_disabled() and count(page,'GET','/api/v1/debrid/torrents')==0)
        page.locator('[data-settings-debrid-key-input]').fill('bad-key-999');page.locator('[data-settings-debrid-key-save]').click()
        page.locator('[data-settings-debrid-error]').wait_for();page.wait_for_timeout(300)
        detail=page.locator('[data-settings-debrid-error-detail]').inner_text()
        check('Save key: PATCH /debrid/settings with the key, then the key is checked with the provider',last(page,'PATCH','/api/v1/debrid/settings')['settings']['apiKey']=='bad-key-999'
              and count(page,'GET','/api/v1/debrid/torrents')==1)
        check('A refused key: the error stays in the section with the server message, the key blanked out',
              'TorBox did not accept the API key' in page.locator('[data-settings-debrid-error]').inner_text() and 'code 403' in detail and '•••' in detail
              and page.locator('[data-settings-debrid-key-input]').get_attribute('aria-invalid')=='true')
        check('The key is never shown: field emptied, not in the page text, not in the console',page.locator('[data-settings-debrid-key-input]').input_value()==''
              and 'bad-key-999' not in page_text(page) and not [m for m in console_all if 'bad-key-999' in m])
        check('Torrents with the error and every group open: 48px, no overflow',small(page)==[] and page.evaluate(NO_OVERFLOW))
        shot(page,'settings-torrents-error-390.png')
        page.locator('[data-settings-debrid-key-input]').fill('good-key-123');page.locator('[data-settings-debrid-key-input]').press('Enter')
        page.wait_for_timeout(800)
        check('A good key (Enter saves too): the error goes, the field says it is connected',page.locator('[data-settings-debrid-error]').count()==0
              and page.locator('[data-settings-debrid-key]').get_attribute('data-key-state')=='ok'
              and 'Connected to TorBox.' in page.locator('[data-settings-debrid-key] small').inner_text() and 'good-key-123' not in page_text(page))
        page.locator('[data-debrid-field="streamAutoSelect"]').click();page.wait_for_timeout(400)
        page.select_option('#pst-debrid-resolution','1080');page.wait_for_timeout(400)
        db=page.evaluate('server.status.debridSettings')
        check('Debrid auto-select and resolution stored, the saved key kept',db['streamAutoSelect'] is True and db['streamPreferredResolution']=='1080' and db['apiKey']=='good-key-123')
        checks_before=count(page,'GET','/api/v1/debrid/torrents')
        back(page);open_section(page,'torrents');page.wait_for_timeout(400)
        check('Opening the area checks the stored key again',count(page,'GET','/api/v1/debrid/torrents')==checks_before+1
              and page.locator('[data-settings-debrid-key]').get_attribute('data-key-state')=='ok')
        shot(page,'settings-torrents-390.png')
        page.locator('[data-settings-open-library]').click();page.wait_for_timeout(300)
        check('The notice opens Local library',page.evaluate(SECTION)=='library')
        page.locator('[data-setting="library.libraryPath"]').click();page.locator('[data-settings-pick-folder]').click();page.wait_for_timeout(400)
        page.locator('[data-text-apply]').click();page.wait_for_timeout(400)
        back(page);open_section(page,'torrents')
        check('With a library folder the notice is gone',page.locator('[data-settings-no-library-folder]').count()==0)
        back(page);open_section(page,'seanime')
        check('Default episode source offers torrent and Debrid streaming once they are on',page.evaluate(TEXT,'#pst-default-source option')
              ==['Automatic','Local library','Online streaming','Torrent streaming','Debrid streaming'])
        page.select_option('#pst-default-source','torrentstream');page.wait_for_timeout(400)
        check('Torrent streaming as the default source saves',last(page,'PATCH','/api/v1/settings/path')=={'path':'library.defaultPlaybackSource','value':'torrentstream'})
        back(page);open_section(page,'torrents')
        page.locator('[data-debrid-field="enabled"]').click();page.locator('[data-torrentstream-field="enabled"]').click();page.wait_for_timeout(700)
        check('Turning them off hides what depends on them',page.locator('[data-debrid-field]').count()==1 and page.locator('[data-torrentstream-field]').count()==1
              and page.locator('[data-settings-debrid-key]').count()==0 and page.evaluate('server.status.debridSettings.enabled') is False
              and page.evaluate('server.status.torrentstreamSettings.enabled') is False)
        page.reload_app();open_section(page,'torrents')
        check('After a reload the torrent values are still there',page.locator('#pst-torrent-provider').input_value()=='animetosho'
              and page.locator('#pst-download-limit').input_value()=='2048' and checked(page,'[data-torrentstream-field="enabled"]')=='false')
        back(page);open_section(page,'seanime')
        check('Both off: the stored default source stays visible as turned off',page.evaluate(TEXT,'#pst-default-source option')[-1]=='Torrent streaming (turned off)'
              and page.locator('#pst-default-source').input_value()=='torrentstream')
        page.close()

        server=copy.deepcopy(SERVER);server['torrentProviders']=[]
        page=open_page(server=server);open_section(page,'torrents')
        check('No providers installed: a note instead of the select, with a way to Extensions',page.locator('[data-settings-no-providers]').count()==1
              and page.locator('#pst-torrent-provider').count()==0 and 'Extensions' in page.locator('[data-settings-no-providers]').inner_text())
        page.locator('[data-settings-open-extensions]').click();page.wait_for_timeout(200)
        check('Open Extensions goes to the Extensions screen',page.evaluate('routes')[-1]==['push','/extensions'])
        page.close()
        for tab in ('torrent','torrent-client','torrentstream','debrid'):
            page=open_page(path=f'/settings?tab={tab}')
            check(f'?tab={tab} opens Torrents & debrid',page.evaluate(SECTION)=='torrents' and page.evaluate('location.pathname+location.search')=='/settings')
            page.close()

        # Every torrent part open (Debrid with a refused key) in German and at 320px with 200 % text
        full=copy.deepcopy(SERVER)
        full['status']['torrentstreamSettings'].update(enabled=True,autoSelect=True)
        full['status']['debridSettings'].update(enabled=True,provider='realdebrid',apiKey='bad-key-999',streamAutoSelect=True)
        de=open_page(language='de',server=copy.deepcopy(full));open_section(de,'torrents');de.locator('[data-settings-debrid-error]').wait_for()
        check('German torrents: title, groups, notices, key field',de.evaluate(H1)=='Torrents & Debrid'
              and de.evaluate(TEXT,'[data-settings-page] .pst-group > h2')==['Torrent-Anbieter','Torrents streamen','Downloads','Debrid']
              and 'Real-Debrid hat den API-Schlüssel nicht angenommen' in de.locator('[data-settings-debrid-error]').inner_text()
              and de.locator('[data-settings-debrid-key-save]').inner_text()=='Schlüssel speichern'
              and de.evaluate(TEXT,'#pst-download-limit option')[0]=='Unbegrenzt' and de.evaluate(TEXT,'#pst-torrentstream-resolution option')[0]=='Höchste'
              and 'Lokale Bibliothek öffnen' in de.locator('[data-settings-no-library-folder]').inner_text())
        check('German torrents: 48px, no overflow',small(de)==[] and de.evaluate(NO_OVERFLOW))
        shot(de,'settings-torrents-de-390.png')
        de.close()
        big=open_page(width=320,height=640,html_style=TEXT_ZOOM,server=copy.deepcopy(full));open_section(big,'torrents');big.locator('[data-settings-debrid-error]').wait_for()
        check('320px, 200% text, every torrent part open: no overflow, 48px',big.evaluate(NO_OVERFLOW) and small(big)==[])
        shot(big,'settings-torrents-320-200.png')
        big.close()

        # Back chain with a sheet: sheet, then page, then the screen
        page=open_page();open_section(page,'nakama')
        page.locator('[data-setting="nakama.username"]').click();page.locator('[data-settings-text-sheet]').wait_for();page.wait_for_timeout(300)
        page.locator('[data-text-input]').fill('Nick')
        check('Back 1 closes the sheet without saving',back(page) and page.evaluate(OPEN_SHEETS)==0 and page.evaluate(SECTION)=='nakama' and count(page,'PATCH','/api/v1/settings/path')==0)
        check('Back 2 returns to the list',back(page) and page.evaluate(SECTION)=='home')
        check('Back 3 leaves the screen',back(page) is False)
        page.close()

        # The open area survives a remount or reload of the same history entry (the preload mode swaps the router, colours off reloads)
        page=open_page()
        page.evaluate("history.replaceState({__TSR_key:'entry-1'},'')")
        open_section(page,'ui');page.reload_app()
        check('A reload of the same history entry comes back on the open area',page.evaluate(SECTION)=='ui')
        check('Back from that area returns to the list',back(page) and page.evaluate(SECTION)=='home')
        open_section(page,'ui');page.evaluate("history.replaceState({__TSR_key:'entry-2'},'')");page.reload_app()
        check('A new visit to /settings (a new history entry) opens the list',page.evaluate(SECTION)=='home')
        page.close()

        # Deep links
        page=open_page(path='/settings?tab=external-player-link')
        check('?tab=external-player-link opens Playback and the address goes back to /settings',page.evaluate(SECTION)=='playback'
              and page.evaluate('location.pathname+location.search')=='/settings')
        page.close()
        page=open_page(path='/settings?tab=discord')
        check('?tab=discord (desktop only) opens the list',page.evaluate(SECTION)=='home')
        page.close()

        # German
        de=open_page(language='de')
        check('German: title and areas',de.evaluate(H1)=='Einstellungen' and de.evaluate(TEXT,'[data-settings-open] .pst-row-text > span')
              ==['App','Darstellung','Wiedergabe','Lokale Bibliothek','Online-Streaming','Torrents & Debrid','Manga','Nakama','Logs & Cache','Über'])
        for id in SECTIONS:
            open_section(de,id)
            check(f'German {id}: 48px, no overflow',small(de)==[] and de.evaluate(NO_OVERFLOW))
            if id in ('seanime','playback','logs'): shot(de,f'settings-{id}-de-390.png')
            back(de)
        open_section(de,'seanime');de.select_option('#pst-default-source','-')
        check('German: the select speaks German',de.evaluate(TEXT,'#pst-default-source option')[:2]==['Automatisch','Lokale Bibliothek'])
        de.close()

        # 320 px with 200 % text
        big=open_page(width=320,height=640,html_style=TEXT_ZOOM)
        check('320px, 200% text: list without overflow, 48px',big.evaluate(NO_OVERFLOW) and small(big)==[])
        for id in ('seanime','ui','library','torrents','logs'):
            open_section(big,id)
            check(f'320px, 200% text {id}: no overflow, 48px',big.evaluate(NO_OVERFLOW) and small(big)==[])
            if id=='seanime': shot(big,'settings-seanime-320-200.png')
            back(big)
        big.close()

        # Tablet: the phone screen, laid out for a tablet by app/tablet.css
        tab=open_page(width=800,height=1280)
        check('Tablet (shorter side 800px): the phone screen, no desktop page',tab.locator('[data-phone-screen="settings"]').count()==1
              and tab.locator('[data-desktop-settings]').count()==0)
        tab.close()
        browser.close()
check('No script errors on any page',errors==[])
check('No React warnings (duplicate keys, update loops) on any page',not [w for w in warnings if 'same key' in w or 'Maximum update depth' in w or 'Cannot update a component' in w])
print(json.dumps(checks,indent=2))
print(f'{sum(c["passed"] for c in checks)}/{len(checks)} passed')
