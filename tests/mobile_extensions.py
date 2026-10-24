"""Extensions tab (Android phones): installed list with updates and problems first, one sheet per extension (update, preferences,
turn off, uninstall, permission grant over the websocket challenge, load errors), check for updates and update all, the add sheet
(link, repository, paste), the marketplace (repository sheet, type chips, language, search, install), first-run tutorial selectors,
Android Back through the native back script, loading / empty / error states, German texts, 48px targets, 320px with 200% text.
Optional arg: screenshot dir."""
from pathlib import Path
from web_build import WEB
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys, copy
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
checks=[];errors=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
def shot(page,name):
    if shots: page.screenshot(path=str(shots/name),full_page=True)
def ext(id,name,type,version='1.0.0',author='dev',lang='en',icon='',desc='',manifest=None,**kw):
    d=dict(id=id,name=name,type=type,version=version,author=author,lang=lang,icon=icon,description=desc,
        manifestURI=f'https://ext.test/{id}.json' if manifest is None else manifest,language='javascript',website='',readme='',payload='')
    d.update(kw);return d
ANIMEKAI=ext('animekai','AnimeKai','onlinestream-provider','1.0.0','Lampe','en','http://ext.test/icons/animekai.png','Anime streams from AnimeKai')
HIANIME=ext('hianime','HiAnime','onlinestream-provider','2.1.0','someone','multi','http://ext.test/icons/hianime.svg','Multi language anime streams')
MANGAFIRE=ext('mangafire','MangaFire','manga-provider','1.1.1','dip-land','multi','http://ext.test/icons/mangafire.png','Multi language manga provider')
LOCAL=ext('local-manga','Local','manga-provider','','','multi','','Reads manga from your device',manifest='builtin')
SYNC=ext('anilist-sync','AniList Sync','plugin','0.3.0','tracker','en','','Syncs your progress',readme='https://ext.test/sync/readme',
    userConfig=dict(version=1,requiresConfig=True,fields=[dict(type='text',name='token',label='Token',default='')]))
DISCORD=ext('discord-rpc','Discord RPC','plugin','1.4.0','rpc-dev','en','','Shows what you watch on Discord',website='https://ext.test/discord')
MANGADEX=ext('mangadex-source','MangaDex Source','custom-source','0.9.0','md','en','','Browse MangaDex')
NYAA=ext('nyaa','Nyaa','anime-torrent-provider','1.0.0','x','en','','Torrents')
OLD=ext('old-streamer','Old Streamer','onlinestream-provider','0.1.0','retired','en','','An old source')
SWITCHER=ext('account-switcher','Account Switcher','plugin','1.0.0','switch','en','','Switch between AniList accounts')
BROKEN=ext('broken-provider','Broken Provider','manga-provider','0.2.0','oops','en','','Does not load')
ALL=dict(extensions=[ANIMEKAI,HIANIME,MANGAFIRE,LOCAL,SYNC,DISCORD,MANGADEX,NYAA],disabledExtensions=[OLD],
    invalidExtensions=[dict(id='account-switcher',path='/data/ext/account-switcher.json',extension=SWITCHER,reason='permissions not granted',code='plugin_permissions_not_granted',
            pluginPermissionDescription='• Storage: Save data on this device\n• Domain: api.anilist.co\n* This plugin can read your AniList token'),
        dict(id='broken-provider',path='/data/ext/broken-provider.js',extension=BROKEN,reason='SyntaxError: Unexpected token (12:4)',code='invalid_payload')],
    invalidUserConfigExtensions=[dict(id='anilist-sync',path='',extension=SYNC,reason='user config is missing',code='user_config_error')],
    hasUpdate=[dict(extensionID='animekai',version='1.2.0',manifestURI='https://ext.test/animekai.json',payload='// new code')],unsafeExtensions={})
UPDATES_ON_CHECK=[dict(extensionID='animekai',version='1.2.0',manifestURI='https://ext.test/animekai.json',payload='// new code'),
    dict(extensionID='mangafire',version='1.2.0',manifestURI='https://ext.test/mangafire.json',payload='// v1.2.0')]
REPO='https://ext.test/index.json'
GITHUB_REPO='https://raw.githubusercontent.com/Bas1874/Seanime-Marketplace/refs/heads/main/Marketplace/Main.json'
NEW=ext('new-source','New Source','onlinestream-provider','1.0.0','newbie','en','','A fresh streaming source')
MARKET={'':[ext('aiostreams','AIOStreams','plugin','0.10.2','Viren070','multi','','Stream content from AIOStreams'),SWITCHER],
    REPO:[ANIMEKAI,ext('animepahe','AnimePahe','onlinestream-provider','1.0.0','pahe','en','http://ext.test/icons/pahe.png','AnimePahe streams'),
        ext('kaido','Kaido','onlinestream-provider','1.0.0','k','de','','Deutsche Streams'),ext('anixl','AniXL','onlinestream-provider','2.0.0','xl','en','','AniXL streams'),
        ext('yugen','Yugen','onlinestream-provider','1.3.0','yg','multi','','Streams in several languages'),ext('weebcentral','WeebCentral','manga-provider','1.0.0','wc','en','','Manga from WeebCentral'),
        MANGAFIRE,ext('mal-source','MAL Source','custom-source','1.0.0','mal','en','','Browse MyAnimeList'),ext('animetosho','AnimeTosho','anime-torrent-provider'),
        ext('aiostreams','AIOStreams','plugin','0.10.2','Viren070','multi','','Stream content from AIOStreams')],
    '__fetch':[NEW]}
MARKET[GITHUB_REPO]=MARKET[REPO]
SERVER=dict(all=ALL,allStatus='ok',checkState=None,checks=0,refetches=0,updatesOnCheck=UPDATES_ON_CHECK,market=MARKET,marketStatus='ok',marketRefetches=[],
    fetchResults={NEW['manifestURI']:NEW,ANIMEKAI['manifestURI']:ANIMEKAI},repository=[ext('repo-a','Repo A','manga-provider'),ext('repo-b','Repo B','onlinestream-provider')])
INIT='''(()=>{Object.assign(window,{server:%s,calls:[],routes:[],toasts:[],clip:""});
window.SeanimeAndroid={getAppVersion:()=>"test",readClipboard:()=>window.clip}})()'''
# AndroidNavigation.backScript: what the app runs when the Android Back button is pressed.
NATIVE_BACK=(root/'app/src/main/java/com/seanime/app/AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()
SVG='<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl({h} 45% 40%)"/></svg>'
NO_OVERFLOW='document.documentElement.scrollWidth<=innerWidth+1'
SMALL='''(sel=>[...document.querySelectorAll(sel)].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<47.9||r.width<47.9)}).map(b=>b.textContent||b.getAttribute("aria-label")))'''
TEXT='(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent.trim()))'
OPEN='document.querySelectorAll(".UI-Modal__content[data-state=open]").length'
HEADS='(sel=>[...document.querySelectorAll(sel)].map(e=>e.firstChild.textContent.trim()))'
def calls(page,kind=None): return [c for c in page.evaluate('calls') if kind is None or c[0]==kind]
with tempfile.TemporaryDirectory(prefix='seanime-extensions-') as tmp:
    bundle=Path(tmp)/'extensions.js'
    subprocess.run(['node',str(root/'tests/mobile_extensions_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width=390,height=844,query='',language=None,server=None,ready='[data-mobile-extensions]',storage=None):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.on('pageerror',lambda e:errors.append(str(e)[:300]))
            page.add_init_script(INIT%json.dumps(server or copy.deepcopy(SERVER)))
            if language: page.add_init_script(f'localStorage.setItem("seanime-mobile-language",JSON.stringify("{language}"))')
            for key,value in (storage or {}).items(): page.add_init_script(f'localStorage.setItem({json.dumps(key)},{json.dumps(json.dumps(value))})')
            page.route('http://ext.test/icons/**',lambda r:r.fulfill(content_type='image/svg+xml',body=SVG.format(h=len(r.request.url)*37%360)))
            page.route('http://ext.test/extensions*',lambda r:r.fulfill(content_type='text/html',body='<html class="dark" lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0c0c0e"><div id="root"></div></body></html>'))
            page.goto('http://ext.test/extensions'+query)
            for css in (WEB/'static/css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator(ready).first.wait_for();page.wait_for_timeout(500)
            return page
        def back(page):
            ok=page.evaluate(NATIVE_BACK);page.wait_for_timeout(350);return ok
        def open_row(page,id):
            page.locator(f'[data-extension-row="{id}"]').click();page.locator(f'[data-extension-sheet="{id}"]').wait_for();page.wait_for_timeout(300)
        page=open_page()

        # Installed list
        check('Phone screen replaces the desktop page',page.locator('h1').inner_text()=='Extensions' and page.locator('[data-desktop-banner]').count()==0
              and page.get_by_text('Manage your plugins and content providers.').count()==0)
        check('Facts: installed, updates, what needs attention',page.locator('[data-extensions-facts]').inner_text()=='11 installed · 1 update · 3 need attention')
        check('Tabs: Installed chosen with its count and an attention dot',page.evaluate(TEXT,'[data-extensions-page-tabs] [role=tab]')==['Installed11','Marketplace']
              and page.locator('[data-tab-name="Installed"][aria-selected=true] .mex-tab-dot').count()==1)
        check('Tutorial: the Marketplace tab keeps its selector',page.locator('[data-extensions-page-tabs] [data-tab-name="Marketplace"]').count()==1)
        check('Updates block names what can be updated',page.locator('[data-extensions-updates] h2').inner_text()=='1 update available'
              and page.locator('[data-extensions-updates] p').first.inner_text()=='AnimeKai')
        check('Sections: attention first, content sources (torrent providers too) before plugins',page.evaluate(HEADS,'.mex-section-head h2')
              ==['Needs attention','Online streaming','Manga','Anime torrents','Plugins','Custom sources','Disabled'] and page.locator('[data-extension-row="nyaa"]').count()==1)
        check('Attention rows say what is wrong',page.evaluate(TEXT,'[data-extensions-attention] .mex-flag')==['Needs your permission','Invalid or incompatible code'])
        check('Rows: update and setup flags, built-in, version · author · language',page.locator('[data-extension-row="animekai"] .mex-flag').inner_text()=='Update to 1.2.0'
              and page.locator('[data-extension-row="anilist-sync"] .mex-flag').inner_text()=='Needs setup'
              and page.locator('[data-extension-row="local-manga"] .mex-row-meta').inner_text()=='Built-in'
              and page.locator('[data-extension-row="mangafire"] .mex-row-meta').inner_text()=='1.1.1 · dip-land'
              and page.locator('[data-extension-row="animekai"] .mex-row-meta').inner_text()=='1.0.0 · Lampe · English')
        check('Icons: image files load, anything else shows the first letter',page.locator('[data-extension-row="animekai"] .mex-icon img').count()==1
              and page.locator('[data-extension-row="hianime"] .mex-icon').inner_text()=='H')
        check('Disabled extensions are listed dimmed',page.locator('[data-extensions-group="disabled"] [data-extension-row="old-streamer"]').count()==1)
        check('Every button and link is at least 48px',page.evaluate(SMALL,'[data-mobile-extensions] button,[data-mobile-extensions] a')==[])
        check('390px: no page overflow',page.evaluate(NO_OVERFLOW))
        shot(page,'extensions-390.png')
        # Marketplace+ (a plugin) hangs a desktop filter bar in front of every input this selector matches
        MPLUS='document.querySelectorAll(\'input[placeholder*="extensions"]:not([data-mplus-ui])\').length'
        check('Marketplace+ plugin finds no search field to hang its desktop bar on',page.locator('[data-extensions-search]').count()==1 and page.evaluate(MPLUS)==0)

        page.locator('[data-extensions-search]').fill('manga');page.wait_for_timeout(200)
        check('Search narrows every group by name, description and ID',page.evaluate(TEXT,'[data-extension-row] .mex-row-name')==['Local','MangaFire','MangaDex Source'])
        page.locator('[data-extensions-search]').fill('zzz');page.wait_for_timeout(200)
        check('A search without hits says so',page.locator('[data-extensions-search-empty]').count()==1)
        page.locator('[data-extensions-search-empty] button').click();page.wait_for_timeout(200)
        check('Clearing the search brings every row back',page.locator('[data-extension-row]').count()==11)
        page.locator('[data-extensions-add-type="onlinestream-provider"]').click();page.locator('[data-marketplace-phone]').wait_for();page.wait_for_timeout(200)
        check('"Add" in a section opens the marketplace on that type',page.locator('[data-marketplace-type="onlinestream-provider"][aria-selected=true]').count()==1)
        check('Marketplace: the plugin finds no search field either',page.evaluate(MPLUS)==0)
        page.locator('[data-marketplace-type="all"]').click();page.locator('[data-tab-name="Installed"]').click();page.locator('[data-extension-row]').first.wait_for()

        # One sheet per extension
        open_row(page,'animekai')
        check('Sheet takes the focus itself, not its first button',page.evaluate('document.activeElement?.getAttribute("role")')=='dialog')
        check('Sheet: type and meta, the update first, then actions and facts',page.locator('[data-extension-sheet="animekai"] .mex-sheet-meta').inner_text()=='Streaming source · 1.0.0 · Lampe · English'
              and page.locator('[data-extension-update] h3').inner_text()=='Version 1.2.0 is available'
              and page.evaluate(TEXT,'[data-extension-sheet="animekai"] .mex-action-text > span:first-child')==['Check for updates','Reload','Code','Turn off','Uninstall']
              and 'animekai' in page.locator('[data-extension-sheet="animekai"] .mex-facts').inner_text()
              and page.locator('[data-extension-sheet="animekai"] .mex-facts dd[data-long]').inner_text()=='https://ext.test/animekai.json')
        check('Sheet buttons are at least 48px',page.evaluate(SMALL,'.mex-sheet button')==[])
        shot(page,'extensions-sheet-390.png')
        page.locator('[data-extension-install-update]').click();page.wait_for_timeout(400)
        check('Update installs the new manifest and the block goes away',calls(page)[-1]==['install',{'manifestUri':'https://ext.test/animekai.json'}]
              and page.locator('[data-extension-update]').count()==0)
        page.locator('[data-extension-action="check"]').click();page.wait_for_timeout(400)
        check('Checking one extension says whether it is current',calls(page)[-1]==['fetch',{'manifestUri':'https://ext.test/animekai.json'}]
              and page.evaluate('toasts')[-1]==['info','This extension is up to date'])
        check('Back closes the sheet',back(page) and page.locator('[data-extension-sheet]').count()==0)
        check('Focus returns to the row',page.evaluate('document.activeElement?.getAttribute("data-extension-row")')=='animekai')

        open_row(page,'anilist-sync')
        check('Preferences row warns that setup is needed',page.locator('[data-extension-action="preferences"] small').inner_text()=='Needs setup before it can be used')
        page.locator('[data-extension-action="preferences"]').click();page.get_by_text('Fill out the required configuration options.').wait_for();page.wait_for_timeout(300)
        check('Preferences open as a second sheet over the first',page.evaluate(OPEN)==2 and page.locator('.mex-sheet .UI-Modal__title',has_text='Preferences').count()==1)
        shot(page,'extensions-preferences-390.png')
        check('Back closes only the preferences',back(page) and page.evaluate(OPEN)==1)
        back(page)

        open_row(page,'discord-rpc')
        check('Website stays one tap away',page.locator('[data-extension-action="website"]').count()==1)
        page.locator('[data-extension-action="toggle"]').click();page.wait_for_timeout(400)
        check('Turning off moves it to Disabled; the sheet stays and offers to turn it on',calls(page)[-1]==['disable',{'id':'discord-rpc','disabled':True}]
              and page.locator('[data-extensions-group="disabled"] [data-extension-row="discord-rpc"]').count()==1
              and page.locator('[data-extension-action="toggle"]').inner_text().strip()=='Turn on' and page.locator('.mex-sheet .mex-note').count()==1)
        back(page)

        open_row(page,'mangadex-source')
        check('Custom source can be browsed from its sheet',page.locator('[data-extension-action="browse"]').count()==1)
        page.locator('[data-extension-action="uninstall"]').click();page.locator('[data-extension-confirm]').wait_for();page.wait_for_timeout(300)
        check('Uninstall asks first',page.locator('.UI-Modal__title',has_text='Uninstall MangaDex Source?').count()==1)
        shot(page,'extensions-confirm-390.png')
        page.locator('[data-extension-confirm-action]').click();page.wait_for_timeout(600)
        check('Uninstall removes it and closes its sheet',calls(page)[-1]==['uninstall',{'id':'mangadex-source'}]
              and page.locator('[data-extension-row="mangadex-source"]').count()==0 and page.evaluate(OPEN)==0)

        open_row(page,'account-switcher')
        check('Permission sheet lists what the plugin asks for',page.evaluate(TEXT,'.mex-permissions li')
              ==['StorageSave data on this device','Domainapi.anilist.co','This plugin can read your AniList token'])
        shot(page,'extensions-permissions-390.png')
        page.locator('[data-extension-grant]').click();page.wait_for_timeout(800)
        check('Grant answers the server challenge and the plugin loads',calls(page,'grant')==[['grant',{'id':'account-switcher','clientId':''}],
              ['grant',{'id':'account-switcher','clientId':'CODE:challenge:4711'}]] and page.locator('[data-extension-permissions]').count()==0
              and page.locator('[data-extensions-group="plugin"] [data-extension-row="account-switcher"]').count()==1)
        back(page)

        open_row(page,'broken-provider')
        check('Load error: reason, message and path; update, reload, code and uninstall',page.locator('[data-extension-error] h3').inner_text()=='Invalid or incompatible code'
              and page.locator('[data-extension-error] .mex-code').inner_text()=='SyntaxError: Unexpected token (12:4)'
              and page.evaluate(TEXT,'[data-extension-sheet="broken-provider"] .mex-action-text > span:first-child')==['Check for updates','Reload','Code','Uninstall'])
        back(page)

        # Check for updates, update all
        page.locator('[data-extensions-check-updates]').click();page.wait_for_timeout(120)
        check('Checking keeps the list on screen and shows progress',page.locator('[data-extensions-check-updates][aria-busy=true]').count()==1
              and page.locator('[data-extension-row]').count()>0)
        page.wait_for_timeout(700)
        check('The check result is announced and counted',['success','2 updates available'] in page.evaluate('toasts')
              and page.locator('[data-extensions-facts]').inner_text()=='10 installed · 2 updates · 2 need attention')
        page.locator('[data-extensions-update-all]').click();page.wait_for_timeout(1000)
        check('Update all installs every safe update one after another',calls(page,'install')[-2:]==[['install',{'manifestUri':'https://ext.test/animekai.json'}],
              ['install',{'manifestUri':'https://ext.test/mangafire.json'}]] and page.evaluate('toasts')[-1]==['success','2 extensions updated']
              and page.locator('[data-extensions-updates]').count()==0)

        # Menu
        page.locator('[data-extensions-menu]').click();page.get_by_role('menuitem',name='Playground').wait_for()
        check('Back closes the menu',back(page) and page.get_by_role('menuitem').count()==0)
        page.locator('[data-extensions-menu]').click();page.get_by_role('menuitem',name='Playground').click()
        check('Playground stays in the menu',page.evaluate('routes').pop()=='/extensions/playground')
        page.evaluate('history.pushState(null,"","/extensions");dispatchEvent(new PopStateEvent("popstate"))')

        # Add sheet
        page.locator('[data-extensions-add]').click();page.locator('[data-extensions-add-sheet]').wait_for();page.wait_for_timeout(300)
        check('Add sheet focuses itself, so no keyboard pops up',page.evaluate('document.activeElement?.getAttribute("role")')=='dialog')
        shot(page,'extensions-add-390.png')
        page.evaluate('clip="https://ext.test/new-source.json"');page.locator('#mex-manifest-url + .mex-paste').click();page.wait_for_timeout(200)
        check('Paste fills the link from the clipboard',page.locator('#mex-manifest-url').input_value()=='https://ext.test/new-source.json')
        page.locator('[data-extensions-add-find]').click();page.locator('[data-extensions-add-found]').wait_for()
        check('The extension is shown before it is installed',page.locator('[data-extensions-add-found] small').inner_text()=='Streaming source · 1.0.0 · newbie · English')
        page.locator('[data-extensions-add-install]').click();page.locator('[data-extensions-add-sheet]').wait_for(state='detached')
        check('Install from a link installs it and closes the sheet',calls(page,'install')[-1]==['install',{'manifestUri':'https://ext.test/new-source.json'}]
              and page.locator('[data-extension-row="new-source"]').count()==1)
        check('Focus returns to the add button',page.evaluate('document.activeElement?.hasAttribute("data-extensions-add")'))
        page.locator('[data-extensions-add]').click();page.locator('[data-extensions-add-sheet]').wait_for()
        check('The add sheet starts empty again',page.locator('#mex-manifest-url').input_value()=='')
        page.locator('#mex-repository-url').fill('https://ext.test/repo.json');page.locator('[data-extensions-add-list]').click();page.locator('.mex-mini-list').wait_for()
        check('A repository lists its extensions first',page.evaluate(TEXT,'.mex-mini-list strong')==['Repo A','Repo B']
              and calls(page)[-1]==['repository',{'repositoryUri':'https://ext.test/repo.json','install':False}])
        page.locator('[data-extensions-add-install-all]').click();page.locator('[data-extensions-add-sheet]').wait_for(state='detached')
        check('Install all installs the repository',calls(page)[-1]==['repository',{'repositoryUri':'https://ext.test/repo.json','install':True}]
              and page.evaluate('toasts')[-1]==['success','Extensions installed'])
        page.locator('[data-extensions-add]').click();page.locator('[data-extensions-add-browse]').click();page.locator('[data-marketplace-phone]').wait_for();page.wait_for_timeout(300)
        check('The add sheet leads to the marketplace',page.locator('[data-tab-name="Marketplace"][aria-selected=true]').count()==1 and page.evaluate(OPEN)==0)

        # Marketplace
        check('Official repository without content sources explains what to do',page.locator('[data-marketplace-source]').inner_text()=='Official repository'
              and page.locator('[data-marketplace-missing] h3').inner_text()=='No streaming or manga sources here')
        check('Tutorial: change repository keeps its selector',page.locator('[data-tour="marketplace-change-repo"]').count()==1)
        check('Marketplace buttons are at least 48px',page.evaluate(SMALL,'[data-mobile-extensions] button,[data-mobile-extensions] a')==[])
        shot(page,'marketplace-official-390.png')
        page.locator('[data-tour="marketplace-change-repo"]').click();page.locator('[data-marketplace-repo-sheet]').wait_for();page.wait_for_timeout(300)
        check('Tutorial: the repository sheet is the open modal and holds the save button',
              page.locator('.UI-Modal__content[data-state="open"] [data-tour="marketplace-repo-save"]').count()==1)
        page.locator('#mex-repository').fill('not a link');page.wait_for_timeout(100)
        check('A wrong link is named and cannot be saved',page.locator('#mex-repository-error').count()==1 and page.locator('[data-tour="marketplace-repo-save"]').is_disabled())
        page.evaluate(f'clip="{REPO}"');page.locator('#mex-repository + .mex-paste').click();page.wait_for_timeout(200)
        check('Paste fills the repository link',page.locator('#mex-repository').input_value()==REPO and page.locator('[data-tour="marketplace-repo-save"]').is_enabled())
        shot(page,'marketplace-repository-390.png')
        page.locator('[data-tour="marketplace-repo-save"]').click();page.locator('[data-marketplace-repo-sheet]').wait_for(state='detached');page.wait_for_timeout(300)
        check('Saving switches the repository',page.evaluate('localStorage.getItem("marketplace-url")')==json.dumps(REPO)
              and page.locator('[data-marketplace-source]').inner_text()=='ext.test · index.json' and page.locator('[data-marketplace-missing]').count()==0)
        check('Focus returns to the change button',page.evaluate('document.activeElement?.getAttribute("data-tour")')=='marketplace-change-repo')
        check('Chips: types with counts, torrent providers included',page.evaluate(TEXT,'[data-marketplace-type-tabs] [role=tab]')==['All10','Streaming5','Manga2','Torrents1','Plugins1','Custom sources1']
              and page.locator('[data-marketplace-row="animetosho"]').count()==1)
        check('Tutorial: type chips keep the desktop tab names',page.locator('[data-marketplace-type-tabs] [data-tab-name="Online Streaming"]').count()==1
              and page.locator('[data-marketplace-type-tabs] [data-tab-name="Manga"]').count()==1)
        check('Installed ones show a check, the others an install button the tutorial finds',page.locator('[data-marketplace-row="animekai"] [data-installed]').count()==1
              and page.locator('[data-tour-install="onlinestream-provider"]').count()==3 and page.locator('[data-tour-install="manga-provider"]').count()==1)
        check('Overview: four per type in the app language first, then several languages, then the rest; the rest one tap away',
              page.evaluate(TEXT,'[data-marketplace-group="onlinestream-provider"] .mex-row-name')==['AnimeKai','AnimePahe','AniXL','Yugen']
              and page.locator('[data-marketplace-show-all="onlinestream-provider"]').inner_text().strip()=='Show all 5'
              and page.locator('[data-marketplace-show-all="manga-provider"]').count()==0)
        check('Marketplace rows are at least 48px',page.evaluate(SMALL,'[data-mobile-extensions] button,[data-mobile-extensions] a')==[])
        shot(page,'marketplace-390.png')
        page.locator('[data-marketplace-show-all="onlinestream-provider"]').click();page.wait_for_timeout(200)
        check('A type chip narrows to its group',page.evaluate(HEADS,'.mex-market-list .mex-section-head h2')==['Online streaming'] and page.locator('[data-marketplace-row]').count()==5
              and page.locator('[data-marketplace-type="onlinestream-provider"][aria-selected=true]').count()==1)
        page.locator('[data-marketplace-row="animepahe"] [data-tour-install]').click();page.wait_for_timeout(400)
        check('Install from the list',calls(page,'install')[-1]==['install',{'manifestUri':'https://ext.test/animepahe.json'}]
              and page.locator('[data-marketplace-row="animepahe"] [data-installed]').count()==1)
        page.locator('[data-marketplace-type="all"]').click();page.locator('[data-marketplace-language]').select_option('de');page.wait_for_timeout(200)
        check('Language narrows the list and the chip counts follow',page.evaluate(TEXT,'[data-marketplace-row] .mex-row-name')==['Kaido']
              and page.evaluate(TEXT,'[data-marketplace-type-tabs] [role=tab]')==['All1','Streaming1','Manga0','Torrents0','Plugins0','Custom sources0'])
        page.locator('[data-marketplace-search]').fill('zzz');page.wait_for_timeout(200)
        check('No match offers to reset the filters',page.locator('[data-marketplace-filter-empty]').count()==1)
        page.locator('[data-marketplace-filter-empty] button').click();page.wait_for_timeout(200)
        check('Reset brings back the overview',page.locator('[data-marketplace-row]').count()==9 and page.locator('[data-marketplace-search]').input_value()=='')
        page.locator('[data-marketplace-row="weebcentral"] .mex-row-main').click();page.locator('[data-marketplace-sheet="weebcentral"]').wait_for();page.wait_for_timeout(300)
        check('Row opens its sheet with the description and the install action',page.locator('[data-marketplace-sheet] .mex-description').inner_text()=='Manga from WeebCentral'
              and page.locator('[data-marketplace-sheet-install]').count()==1)
        page.locator('[data-marketplace-sheet-install]').click();page.wait_for_timeout(400)
        check('Installing from the sheet marks it installed',calls(page,'install')[-1]==['install',{'manifestUri':'https://ext.test/weebcentral.json'}]
              and page.locator('[data-marketplace-sheet] .mex-installed').count()==1)
        check('Back closes the marketplace sheet and focus returns to the row',back(page) and page.evaluate(OPEN)==0
              and page.evaluate('document.activeElement?.closest("[data-marketplace-row]")?.getAttribute("data-marketplace-row")')=='weebcentral')
        page.locator('[data-marketplace-reload]').click()
        check('Reload asks for the repository again',page.evaluate('server.marketRefetches')==[REPO])

        # Large text and narrow screens
        page.set_viewport_size(dict(width=320,height=720));page.evaluate('document.documentElement.style.fontSize="200%"');page.wait_for_timeout(300)
        check('Marketplace at 320px with 200% text: no page overflow',page.evaluate(NO_OVERFLOW))
        shot(page,'marketplace-320-200.png')
        page.locator('[data-tab-name="Installed"]').click();page.wait_for_timeout(300)
        check('Installed at 320px with 200% text: no page overflow, names wrap instead of being cut',page.evaluate(NO_OVERFLOW)
              and page.evaluate('[...document.querySelectorAll(".mex-row-name")].every(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth)'))
        shot(page,'extensions-320-200.png')
        open_row(page,'animekai')
        check('Sheet at 320px with 200% text: no overflow',page.evaluate('(e=>e.scrollWidth<=e.clientWidth+1)(document.querySelector(".mex-sheet"))') and page.evaluate(NO_OVERFLOW))
        shot(page,'extensions-sheet-320-200.png')
        page.close()

        # The setup tour walked on the new screen, started from the menu
        tp=open_page()
        def tour_at(title):
            tp.locator('[data-tour-title]',has_text=title).wait_for(timeout=15000);tp.wait_for_timeout(400)
            return tp.locator('[data-tour-card]').inner_text()
        tp.locator('[data-extensions-menu]').click();tp.locator('[data-extensions-tutorial]').click()
        tour_at('Welcome to Seanime Mobile')
        check('Tour: started on the Extensions tab, the way there is skipped; its buttons are at least 48px',
              tp.locator('[data-tour-card] [data-tour-next]').inner_text()=='Show me' and tp.evaluate(SMALL,'[data-tour-card] button')==[])
        shot(tp,'tour-welcome-390.png')
        tp.locator('[data-tour-next]').click()
        tour_at('Marketplace');tp.locator('[data-extensions-page-tabs] [data-tab-name="Marketplace"]').click()
        text=tour_at('Add a repository')
        check('Tour: the repository step points at "Add repository" while the official repository has no sources',
              'Tap Add repository' in text and tp.locator('[data-marketplace-missing] [data-tour="marketplace-change-repo"]').count()==1)
        shot(tp,'tour-repository-390.png')
        tp.locator('[data-tour="marketplace-change-repo"]').click()
        text=tour_at('Paste the repository link')
        check('Tour: the link step names the paste button and leaves the sheet title visible',' paste button ' in text
              and tp.evaluate('document.querySelector("[data-tour-card]").getBoundingClientRect().bottom<=document.querySelector(".UI-Modal__content[data-state=open]").getBoundingClientRect().top+1'))
        shot(tp,'tour-paste-390.png')
        tp.evaluate(f'clip="{REPO}"');tp.locator('#mex-repository + .mex-paste').click();tp.locator('[data-tour="marketplace-repo-save"]').click()
        text=tour_at('Streaming sources')
        check('Tour: the streaming step names the chip as shown','Tap Streaming to see' in text)
        tp.locator('[data-marketplace-type-tabs] [data-tab-name="Online Streaming"]').click()
        text=tour_at('Install a source')
        check('Tour: the install step points at a download button',' download button ' in text)
        shot(tp,'tour-install-390.png')
        tp.locator('[data-tour-install="onlinestream-provider"]').first.click()
        tour_at('Manga works the same way');tp.locator('[data-marketplace-type-tabs] [data-tab-name="Manga"]').click()
        tour_at('Install a manga source');tp.locator('[data-tour-install="manga-provider"]').first.click()
        text=tour_at("You're all set")
        check('Tour: walked to the end, installing one streaming and one manga source',[c[1]['manifestUri'] for c in calls(tp,'install')]
              ==['https://ext.test/animepahe.json','https://ext.test/weebcentral.json'] and 'from the ⋮ menu there' in text)
        tp.locator('[data-tour-next]').click();tp.locator('[data-tour-card]').wait_for(state='detached')
        check('Tour: Done closes it',tp.locator('[data-tour-card]').count()==0)
        tp.close()

        # Deep link, states, German
        p=open_page(query='?tab=marketplace&type=manga-provider',ready='[data-marketplace-row]',storage={'marketplace-url':GITHUB_REPO})
        check('A GitHub repository is named by owner/repository',p.locator('[data-marketplace-source]').inner_text()=='Bas1874/Seanime-Marketplace')
        check('?tab=marketplace&type= opens the marketplace on that type',p.locator('[data-tab-name="Marketplace"][aria-selected=true]').count()==1
              and p.locator('[data-marketplace-type="manga-provider"][aria-selected=true]').count()==1 and p.locator('[data-marketplace-row]').count()==2)
        p.close()
        for name,patch,selector in (('loading',dict(allStatus='loading'),'.mex-loading[aria-busy=true]'),('empty',dict(all=dict(extensions=[],disabledExtensions=[],invalidExtensions=[])),'[data-extensions-missing]'),
                                    ('error',dict(allStatus='error'),'[data-extensions-error]'),('market-error',dict(marketStatus='error'),'[data-marketplace-error]')):
            p=open_page(server={**copy.deepcopy(SERVER),**patch},query='?tab=marketplace' if name=='market-error' else '',ready=selector)
            check(f'{name.capitalize()} state keeps the title and the actions',p.locator('h1').inner_text()=='Extensions' and p.locator('[data-extensions-add]').count()==1)
            if name=='empty':
                check('Empty: streaming and manga keep their sections and say what is missing',p.evaluate(HEADS,'.mex-section-head h2')==['Online streaming','Manga']
                      and p.locator('[data-extensions-missing]').count()==2)
                p.locator('[data-extensions-missing="onlinestream-provider"] .mex-primary').click();p.locator('[data-marketplace-phone]').wait_for()
                check('Empty: "Find a streaming source" opens the marketplace on streaming',p.locator('[data-tab-name="Marketplace"][aria-selected=true]').count()==1
                      and p.locator('[data-marketplace-type="onlinestream-provider"][aria-selected=true]').count()==1)
                check('A repository without streaming sources says so and offers another repository',
                      p.locator('[data-marketplace-type-empty] p').first.inner_text()=='No streaming sources in this repository')
            if name=='error':
                p.get_by_role('button',name='Try again').click()
                check('Error: try again reloads the list',p.evaluate('server.refetches')==1)
            if name=='market-error':
                check('Marketplace error offers to retry or change the repository',p.locator('[data-marketplace-error] button').count()==2)
            shot(p,f'extensions-{name}-390.png');p.close()
        de=open_page(language='de')
        check('German: facts, tabs, sections, flags',de.locator('[data-extensions-facts]').inner_text()=='11 installiert · 1 Update · 3 brauchen Aufmerksamkeit'
              and de.evaluate(TEXT,'[data-extensions-page-tabs] [role=tab]')==['Installiert11','Marktplatz']
              and de.evaluate(HEADS,'.mex-section-head h2')==['Braucht Aufmerksamkeit','Online-Streaming','Manga','Anime-Torrents','Plugins','Eigene Quellen','Deaktiviert']
              and de.locator('[data-extension-row="animekai"] .mex-flag').inner_text()=='Update auf 1.2.0'
              and de.locator('[data-extension-row="local-manga"] .mex-row-meta').inner_text()=='Integriert')
        de.locator('[data-extension-row="animekai"]').click();de.locator('[data-extension-sheet]').wait_for();de.wait_for_timeout(300)
        check('German: sheet',de.evaluate(TEXT,'[data-extension-sheet] .mex-action-text > span:first-child')==['Nach Updates suchen','Neu laden','Code','Ausschalten','Deinstallieren']
              and de.locator('[data-extension-update] h3').inner_text()=='Version 1.2.0 ist verfügbar')
        shot(de,'extensions-sheet-de-390.png')
        back(de);de.locator('[data-tab-name="Marketplace"]').click();de.locator('[data-marketplace-phone]').wait_for();de.wait_for_timeout(300)
        check('German: marketplace',de.locator('[data-marketplace-source]').inner_text()=='Offizielles Repository'
              and de.locator('[data-marketplace-change]').inner_text()=='Ändern'
              and de.locator('[data-tour="marketplace-change-repo"]').inner_text()=='Repository hinzufügen')
        shot(de,'marketplace-de-390.png')
        de.close()
        dm=open_page(language='de',query='?tab=marketplace',ready='[data-marketplace-row]',storage={'marketplace-url':REPO})
        check('German: sources in German come first',dm.evaluate(TEXT,'[data-marketplace-group="onlinestream-provider"] .mex-row-name')[0]=='Kaido'
              and dm.locator('[data-marketplace-show-all="onlinestream-provider"]').inner_text().strip()=='Alle 5 zeigen')
        dm.locator('[data-extensions-menu]').click();dm.locator('[data-extensions-tutorial]').click()
        dm.locator('[data-tour-title]',has_text='Willkommen bei Seanime Mobile').wait_for();dm.wait_for_timeout(300)
        check('German: tour texts and buttons',dm.locator('[data-tour-next]').inner_text()=='Zeig es mir' and dm.locator('[data-tour-skip]').inner_text()=='Überspringen')
        shot(dm,'tour-de-390.png')
        dm.close()
        browser.close()
check('No script errors on any page',errors==[])
print(json.dumps(checks,indent=2))
