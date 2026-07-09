/* global $$, Utils, Server, AGGrid, DateUtils, DateTimeUtils, marked, hljs, SvnHubUI */
'use strict';

(async function () {

    const WS_REPO = 'services/RepositoryService';
    const WS_ACC = 'services/RepositoryAccessService';
    const WS_BROWSE = 'services/BrowseService';
    const WS_HIST = 'services/HistoryService';
    const WS_STATS = 'services/StatsService';
    const FILE_LINES_PARAM = 'lines';

    const guest = Utils.getData('guest') === true;
    const repoId = Utils.getData('repoId');
    let repoKey = Utils.getData('repoKey');
    let repoName = Utils.getData('repoName');
    const repoReturnTo = Utils.getData('repoReturnTo');
    const pendingSection = Utils.getAndEraseData('repoSection');
    const pendingRevision = Number(Utils.getAndEraseData('repoRevision')) || 0;
    const pendingRepoPath = Utils.getAndEraseData('repoPath') || '';
    const pendingRepoFile = Utils.getAndEraseData('repoFile') === true;
    Utils.getAndEraseData('repoIssue');
    Utils.getAndEraseData('repoMergeRequest');

    function fallbackReturnTo() {
        return guest
            ? {page: 'screens/Discover/Discover', nav: 'discover', data: {}}
            : {page: 'screens/Dashboard/Dashboard', nav: 'repositories', data: {}};
    }

    function repoNav() {
        if (repoReturnTo && Object.prototype.hasOwnProperty.call(repoReturnTo, 'nav'))
            return repoReturnTo.nav;
        return guest ? 'discover' : 'repositories';
    }

    function backTarget() {
        return (repoReturnTo && repoReturnTo.page) ? repoReturnTo : fallbackReturnTo();
    }
    function personReturnTarget() {
        return {
            page: 'screens/Repository/Repository',
            nav: repoNav(),
            data: {
                repoId: Number(repoId),
                repoKey: repoKey || '',
                repoName: repoName || ''
            }
        };
    }

    if (!repoId) {
        SvnHubUI.routeTarget(fallbackReturnTo());
        return;
    }

    const initialFilesRoute = filesRouteFromUrl();
    let currentPath = initialFilesRoute.path;
    let currentFilePath = initialFilesRoute.filePath;
    const repoWorkspace = document.querySelector('.repo-workspace');
    const repoMainSlide = document.getElementById('repo-main-slide');
    const filesSlide = document.getElementById('files-slide');
    const historySlide = document.getElementById('history-slide');
    const repoRailToggle = document.getElementById('repo-rail-toggle');
    const repoSectionButtons = Array.from(document.querySelectorAll('.repo-section-nav .side-nav-btn'));
    const repoRailMobileMq = window.matchMedia('(max-width: 960px)');

    function setTooltip(el, text) {
        if (!el)
            return;
        el.removeAttribute('title');
        el.removeAttribute('data-tooltip-original-title');
        if (text)
            el.setAttribute('data-tooltip', text);
        else
            el.removeAttribute('data-tooltip');
    }

    function syncRepoRailTooltips(collapsed) {
        const showSectionTooltips = !!collapsed && !repoRailMobileMq.matches;
        repoSectionButtons.forEach((btn) => {
            setTooltip(btn, showSectionTooltips ? btn.getAttribute('aria-label') : '');
        });
        setTooltip(repoRailToggle, collapsed ? 'Show sidebar' : 'Collapse sidebar');
    }

    function setRepoRailCollapsed(collapsed, persist = false) {
        const on = !!collapsed;
        if (repoWorkspace)
            repoWorkspace.classList.toggle('repo-rail-collapsed', on);
        if (repoRailToggle) {
            repoRailToggle.setAttribute('aria-expanded', on ? 'false' : 'true');
            repoRailToggle.setAttribute('aria-label', on ? 'Show repository sidebar' : 'Hide repository sidebar');
        }
        syncRepoRailTooltips(on);
        if (persist)
            Utils.saveData('repoRailCollapsed', on);
    }

    setRepoRailCollapsed(Utils.getData('repoRailCollapsed') === true);
    if (repoRailToggle) {
        repoRailToggle.addEventListener('click', () => {
            setRepoRailCollapsed(!(repoWorkspace && repoWorkspace.classList.contains('repo-rail-collapsed')), true);
        });
    }
    if (repoRailMobileMq.addEventListener)
        repoRailMobileMq.addEventListener('change', () =>
            syncRepoRailTooltips(repoWorkspace && repoWorkspace.classList.contains('repo-rail-collapsed')));

    function ownerFromKey(key = repoKey) {
        return key && key.indexOf('/') > -1 ? key.substring(0, key.indexOf('/')) : '';
    }

    $$('repo-owner').setValue(ownerFromKey());
    $$('repo-title').setValue(repoName || repoKey);
    $$('repo-visibility').clear();
    document.getElementById('repo-checkout-display').textContent = '';
    $$('back').onclick(() => {
        SvnHubUI.goBack(repoReturnTo, fallbackReturnTo());
    });
    document.getElementById('repo-owner-link').addEventListener('click', () => {
        const owner = ownerFromKey();
        if (!owner)
            return;
        SvnHubUI.openPerson(owner, personReturnTarget());
    });
    // ---- section views: the left menu switches the content panel IN PLACE ----
    // Local panels live in this screen; the embed pages (Issues / Merge Requests /
    // Insights) are loaded inline into #repo-embed-host so clicking a section never
    // leaves the repository page. The selection is kept in a ?section= query param
    // and pushed to browser history, so Back/Forward step through section choices
    // (and eventually leave the page). Section history entries deliberately are NOT
    // framework __kissRoute states, so the Kiss router ignores them and our own
    // popstate handler below restores them.
    const LOCAL_VIEWS = {'go-files': 'view-files', 'go-readme': 'view-readme', 'go-history': 'view-history'};
    const EMBED_PAGES = {'go-issues': 'screens/Issues/Issues', 'go-mrs': 'screens/MergeRequests/MergeRequests', 'go-insights': 'screens/Insights/Insights'};
    const MENU = ['go-files', 'go-readme', 'go-history', 'go-issues', 'go-mrs', 'go-insights'];
    // The section rail uses plain buttons (not Kiss push-buttons) so items can carry
    // count badges. Helpers below address them directly.
    function menuEl(id) {
        return document.getElementById(id);
    }
    function markActiveMenu(menuId) {
        MENU.forEach((x) => {
            const el = menuEl(x);
            if (el)
                el.classList.toggle('active', x === menuId);
        });
    }
    const SECTION_OF = {'go-history': 'history', 'go-files': 'files', 'go-issues': 'issues', 'go-mrs': 'mrs', 'go-insights': 'insights', 'go-readme': 'readme'};
    const MENU_OF_SECTION = {history: 'go-history', files: 'go-files', issues: 'go-issues', mrs: 'go-mrs', insights: 'go-insights', readme: 'go-readme'};
    let embedLoaded = null;
    let activeMenu = null;
    // Deep-link support: a referring screen (e.g. the dashboard activity feed)
    // may ask for a specific section — and optionally a revision to focus in
    // History — via saved data. These win over any stale ?section= in the URL.
    let startMenu = MENU_OF_SECTION[new URLSearchParams(location.search).get('section')] || 'go-files';
    if (pendingSection && MENU_OF_SECTION[pendingSection])
        startMenu = MENU_OF_SECTION[pendingSection];
    if (startMenu === 'go-insights' && guest)
        startMenu = 'go-files';

    function mainPageForMenu(menuId) {
        const panelId = LOCAL_VIEWS[menuId] || (EMBED_PAGES[menuId] ? 'view-embed' : LOCAL_VIEWS['go-files']);
        return panelId.replace(/^view-/, '');
    }
    function menuDirection(menuId) {
        if (!activeMenu)
            return 1;
        const oldIndex = MENU.indexOf(activeMenu);
        const newIndex = MENU.indexOf(menuId);
        return newIndex >= oldIndex ? 1 : -1;
    }
    function showInitialPanel(menuId) {
        markActiveMenu(menuId);
        SvnHubUI.initPageSlide(repoMainSlide, mainPageForMenu(menuId));
        SvnHubUI.initPageSlide(filesSlide, currentFilePath ? 'file' : 'browse');
        SvnHubUI.initPageSlide(historySlide, revFromUrl() ? 'detail' : 'feed');
        activeMenu = menuId;
    }
    showInitialPanel(startMenu);

    // Switch the visible panel. Pure DOM/content work — never touches history.
    async function applyView(menuId, filesRoute = null) {
        const direction = menuDirection(menuId);
        activeMenu = menuId;
        markActiveMenu(menuId);
        SvnHubUI.setPageSlidePage(repoMainSlide, mainPageForMenu(menuId), {direction: direction});
        if (LOCAL_VIEWS[menuId]) {
            if (menuId === 'go-files')
                await showFilesView(filesRoute);   // create/populate the grid now that it's visible
            if (menuId === 'go-history') {
                // Sync the sub-view (feed vs. in-place revision viewer) with ?rev=.
                const rev = revFromUrl();
                if (rev)
                    await openRevision(rev, {writeHistory: false});
                else
                    showRevisionFeed();
            }
        } else if (EMBED_PAGES[menuId]) {
            const page = EMBED_PAGES[menuId];
            if (embedLoaded !== page) {
                if (menuId === 'go-insights')
                    Utils.saveData('insightsRepoId', repoId);
                try {
                    await Utils.loadPageFragment(page, 'repo-embed-host');
                    embedLoaded = page;
                    SvnHubUI.animateContentIn(document.getElementById('repo-embed-host'), {direction: direction});
                } catch (e) {
                    embedLoaded = null;
                    throw e;
                }
                if (Utils.setAppNavActive)
                    Utils.setAppNavActive(repoNav());   // undo the embedded screen's own nav highlight
            } else {
                // Already-loaded embed (Issues / Merge Requests) may be showing a
                // detail view; tell it to re-sync with the current URL params.
                window.dispatchEvent(new CustomEvent('repo-embed-sync'));
            }
        }
    }

    function routeState(menuId, filesRoute = null) {
        const section = SECTION_OF[menuId] || 'files';
        const state = {__repoSection: section, repoId: repoId, repoKey: repoKey, repoName: repoName};
        if (section === 'files') {
            const route = filesRoute || {path: currentPath, filePath: currentFilePath};
            state.path = normalizeRepoPath(route.path || '');
            state.filePath = normalizeRepoPath(route.filePath || '');
        }
        return state;
    }

    function sectionUrl(menuId, filesRoute = null, keepTicket = false) {
        const url = new URL(location.href);
        const section = SECTION_OF[menuId] || 'files';
        url.searchParams.set('section', section);
        // Picking a section resets any detail deep link (?issue=, ?mr=, ?rev=) —
        // except at page init (keepTicket), where they must survive so the
        // corresponding view can restore the detail the URL names.
        if (!keepTicket) {
            url.searchParams.delete('issue');
            url.searchParams.delete('mr');
            url.searchParams.delete('rev');
            url.searchParams.delete('diffFile');
            url.searchParams.delete('diffRows');
        }
        if (section === 'files') {
            const route = filesRoute || {path: currentPath, filePath: currentFilePath};
            const filePath = normalizeRepoPath(route.filePath || '');
            const path = filePath || normalizeRepoPath(route.path || '');
            if (path)
                url.searchParams.set('path', path);
            else
                url.searchParams.delete('path');
            if (filePath)
                url.searchParams.set('file', '1');
            else
                url.searchParams.delete('file');
            if (!(filePath && keepTicket))
                url.searchParams.delete(FILE_LINES_PARAM);
            url.searchParams.delete('view');
        } else {
            url.searchParams.delete('path');
            url.searchParams.delete('file');
            url.searchParams.delete(FILE_LINES_PARAM);
            url.searchParams.delete('view');
        }
        return url.pathname + url.search + url.hash;
    }

    function writeRepoHistory(menuId, filesRoute = null, mode = 'push', keepTicket = false) {
        try {
            const url = sectionUrl(menuId, filesRoute, keepTicket);
            const currentUrl = location.pathname + location.search + location.hash;
            if (mode !== 'replace' && url === currentUrl)
                return;
            const method = mode === 'replace' ? 'replaceState' : 'pushState';
            history[method](routeState(menuId, filesRoute), '', url);
        } catch (e) { /* history not available */ }
    }

    // A user picking a section: add a history entry (so Back returns to the prior
    // section) then render it.
    async function selectView(menuId) {
        writeRepoHistory(menuId);
        await applyView(menuId);
    }

    // Restore the section on Back/Forward. Only one such handler is ever registered
    // (each repo-page load removes the previous one first).
    function repoSectionPopstate(e) {
        const st = e.state;
        let section = st && st.__repoSection;
        if (!section) {
            const params = new URLSearchParams(location.search || '');
            const urlRepoId = Number(params.get('repoId'));
            if (urlRepoId !== repoId || !params.get('section'))
                return;                   // not one of ours — the Kiss router handles it
            section = params.get('section');
        }
        const menuId = MENU_OF_SECTION[section] || 'go-files';
        const filesRoute = menuId === 'go-files' ? filesRouteFromState(st) : null;
        if (document.getElementById('repo-embed-host')) {
            applyView(menuId, filesRoute); // repo page is loaded — switch in place
        } else {
            // We had navigated away; bring the repo page back at this section.
            Utils.saveData('repoId', (st && st.repoId) || repoId);
            Utils.saveData('repoKey', (st && st.repoKey) || repoKey);
            Utils.saveData('repoName', (st && st.repoName) || repoName);
            Utils.loadPage('screens/Repository/Repository', 'app-screen-area');
        }
    }
    if (window.__repoSectionPopstate)
        window.removeEventListener('popstate', window.__repoSectionPopstate);
    window.__repoSectionPopstate = repoSectionPopstate;
    window.addEventListener('popstate', repoSectionPopstate);

    menuEl('go-history').addEventListener('click', () => selectView('go-history'));
    menuEl('go-files').addEventListener('click', () => selectView('go-files'));
    menuEl('go-issues').addEventListener('click', () => selectView('go-issues'));
    menuEl('go-mrs').addEventListener('click', () => selectView('go-mrs'));
    menuEl('go-insights').addEventListener('click', () => {
        if (guest)
            return;
        selectView('go-insights');
    });
    menuEl('go-readme').addEventListener('click', () => selectView('go-readme'));

    // ---- helpers ----
    function join(base, name) {
        return base ? base + '/' + name : name;
    }
    function normalizeRepoPath(path) {
        return String(path || '').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
    }
    function parentPath(path) {
        const p = normalizeRepoPath(path);
        const i = p.lastIndexOf('/');
        return i >= 0 ? p.substring(0, i) : '';
    }
    function filesRouteFromUrl() {
        const params = new URLSearchParams(location.search || '');
        const routePath = normalizeRepoPath(params.get('path') || pendingRepoPath || '');
        const isFile = params.get('file') === '1' || params.get('view') === 'file' || pendingRepoFile;
        return isFile && routePath
            ? {path: parentPath(routePath), filePath: routePath}
            : {path: routePath, filePath: ''};
    }
    function filesRouteFromState(st) {
        const fromUrl = filesRouteFromUrl();
        const filePath = normalizeRepoPath(st && st.filePath != null ? st.filePath : fromUrl.filePath);
        const path = normalizeRepoPath(st && st.path != null ? st.path : fromUrl.path);
        return filePath ? {path: parentPath(filePath), filePath: filePath} : {path: path, filePath: ''};
    }
    function escapeHtml(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtDate(ms) {
        if (!ms)
            return '';
        try {
            return DateTimeUtils.formatDate(ms);
        } catch (e) {
            return '' + ms;
        }
    }
    function fmtSize(b) {
        if (b == null)
            return '–';
        const u = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0, n = b;
        while (n >= 1024 && i < u.length - 1) {
            n /= 1024;
            i++;
        }
        return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
    }
    function basename(path) {
        const p = (path || '').replace(/\/$/, '');
        const i = p.lastIndexOf('/');
        return i >= 0 ? p.substring(i + 1) : p;
    }
    function setFact(id, val) {
        const el = document.getElementById(id);
        if (el)
            el.textContent = (val == null || val === '') ? '–' : val;
    }
    // Count badge on a section rail item; hidden while zero to keep the rail quiet.
    function setNavCount(id, n) {
        const el = document.getElementById(id);
        if (!el)
            return;
        const count = Number(n) || 0;
        el.textContent = count;
        el.hidden = count <= 0;
    }
    function backgroundLoad(label, load) {
        return Promise.resolve()
            .then(load)
            .catch((e) => {
                console.error('Repository ' + label + ' load failed', e);
            });
    }

    // ---- browse grid ----
    // Map file extensions to Devicon font classes (https://devicon.dev).
    // Directories and unmapped types fall back to inline SVGs so every row gets
    // a recognizable glyph instead of the raw "dir"/"file" text.
    const FILE_ICON_BY_EXT = {
        js: 'devicon-javascript-plain', mjs: 'devicon-javascript-plain', cjs: 'devicon-javascript-plain',
        ts: 'devicon-typescript-plain',
        jsx: 'devicon-react-plain', tsx: 'devicon-react-plain',
        json: 'devicon-json-plain',
        md: 'devicon-markdown-original', markdown: 'devicon-markdown-original',
        html: 'devicon-html5-plain', htm: 'devicon-html5-plain',
        css: 'devicon-css3-plain', scss: 'devicon-sass-plain', sass: 'devicon-sass-plain', less: 'devicon-less-plain',
        xml: 'devicon-xml-plain',
        py: 'devicon-python-plain', pyw: 'devicon-python-plain',
        java: 'devicon-java-plain',
        c: 'devicon-c-plain', h: 'devicon-c-plain',
        cpp: 'devicon-cplusplus-plain', cc: 'devicon-cplusplus-plain', cxx: 'devicon-cplusplus-plain', hpp: 'devicon-cplusplus-plain',
        cs: 'devicon-csharp-plain',
        go: 'devicon-go-plain',
        rs: 'devicon-rust-plain',
        rb: 'devicon-ruby-plain',
        php: 'devicon-php-plain',
        swift: 'devicon-swift-plain',
        sh: 'devicon-bash-plain', bash: 'devicon-bash-plain', zsh: 'devicon-bash-plain',
        ps1: 'devicon-powershell-plain',
        kt: 'devicon-kotlin-plain', kts: 'devicon-kotlin-plain',
        scala: 'devicon-scala-plain', sc: 'devicon-scala-plain',
        sql: 'devicon-sqlite-plain',
        yml: 'devicon-yaml-plain', yaml: 'devicon-yaml-plain',
        vue: 'devicon-vuejs-plain',
        svelte: 'devicon-svelte-plain',
        lua: 'devicon-lua-plain',
        dart: 'devicon-dart-plain',
        elixir: 'devicon-elixir-plain', ex: 'devicon-elixir-plain', exs: 'devicon-elixir-plain',
        clj: 'devicon-clojure-plain', cljs: 'devicon-clojurescript-plain',
        hs: 'devicon-haskell-plain',
        pl: 'devicon-perl-plain',
        r: 'devicon-r-plain',
        zig: 'devicon-zig-plain',
        nim: 'devicon-nim-plain',
        jl: 'devicon-julia-plain',
        tf: 'devicon-terraform-plain',
        gradle: 'devicon-gradle-plain'
    };
    const FOLDER_ICON = '<span class="file-kind-icon svnhub-icon icon-folder" aria-hidden="true"></span>';
    const GENERIC_FILE_ICON = '<span class="file-kind-icon svnhub-icon icon-file-text" aria-hidden="true"></span>';
    function fileKindCellRenderer(params) {
        if (!params || !params.data)
            return '';
        const data = params.data;
        if (data.kind === 'dir')
            return FOLDER_ICON;
        const dot = data.name.lastIndexOf('.');
        if (dot >= 0) {
            const ext = data.name.substring(dot + 1).toLowerCase();
            const cls = FILE_ICON_BY_EXT[ext];
            if (cls)
                return '<i class="' + cls + ' file-kind-icon" aria-hidden="true"></i>';
        }
        // Special filename overrides
        const lower = data.name.toLowerCase();
        if (lower === 'dockerfile')
            return '<i class="devicon-docker-plain file-kind-icon" aria-hidden="true"></i>';
        if (lower === 'license' || lower === 'license.txt' || lower === 'license.md')
            return GENERIC_FILE_ICON;
        return GENERIC_FILE_ICON;
    }
    const browseCols = [
        {headerName: 'Kind', field: 'icon', width: 72, cellRenderer: fileKindCellRenderer},
        {headerName: 'Name', field: 'name', flex: 2},
        {headerName: 'Rev', field: 'revision', width: 80},
        {headerName: 'Author', field: 'author', width: 120},
        {headerName: 'Date', field: 'dateStr', width: 170},
        {headerName: 'Last message', field: 'message', flex: 3}
    ];
    const browseGrid = new AGGrid('browse-grid', browseCols, 'name');
    // AG-Grid must be created while its container is VISIBLE. Creating it inside a
    // display:none panel (as the old code did at screen init) leaves AG-Grid unable
    // to measure its viewport, so rows intermittently fail to render (a resize only
    // re-fits columns, it does not re-lay-out the body). We therefore create the grid
    // lazily the first time the Files section is actually shown.
    let gridShown = false;
    let filesLoaded = false;
    let browseContentPainted = false;
    const STANDARD_ROOTS = ['trunk', 'branches', 'tags'];
    const STANDARD_ROOT_SET = new Set(STANDARD_ROOTS);
    let standardRootsKnown = false;
    let availableStandardRoots = new Set();
    function ensureGrid() {
        if (!gridShown) {
            browseGrid.show();
            gridShown = true;
        }
    }
    function setBrowseGridHeight(rowCount) {
        const gridEl = document.getElementById('browse-grid');
        if (!gridEl)
            return;
        const rows = Math.max(1, Number(rowCount) || 0);
        const maxRows = window.innerHeight < 760 ? 9 : 13;
        const visibleRows = Math.min(rows, maxRows);
        const styles = window.getComputedStyle(gridEl);
        const headerHeight = parseFloat(styles.getPropertyValue('--ag-header-height')) || 38;
        const rowHeight = parseFloat(styles.getPropertyValue('--ag-row-height')) || 38;
        const borderAllowance = 8;
        gridEl.classList.toggle('is-fit-height', rows <= maxRows);
        gridEl.style.height = (headerHeight + visibleRows * rowHeight + borderAllowance) + 'px';
    }
    function hideBrowseEmpty() {
        const empty = document.getElementById('browse-empty');
        if (!empty)
            return;
        empty.hidden = true;
        empty.innerHTML = '';
    }
    function setBrowseGridVisible(visible, reserveSpace = false) {
        const gridEl = document.getElementById('browse-grid');
        if (!gridEl)
            return;
        gridEl.hidden = !visible && !reserveSpace;
        gridEl.style.visibility = reserveSpace ? 'hidden' : '';
    }
    function hideBrowseResults() {
        setBrowseGridVisible(false, true);
        hideBrowseEmpty();
    }
    function animateBrowseContent(direction) {
        const page = document.getElementById('files-browse-page');
        if (browseContentPainted)
            SvnHubUI.animateContentIn(page, {direction: direction || 1});
        browseContentPainted = true;
    }
    function showDirectoryList(resize = true, direction = 1) {
        currentFilePath = '';
        hideBrowseEmpty();
        setBrowseGridVisible(true);
        SvnHubUI.setPageSlidePage(filesSlide, 'browse', {direction: direction});
        animateBrowseContent(direction);
        if (resize && gridShown)
            window.dispatchEvent(new Event('resize'));
    }
    function setBrowseEmpty(message, direction = 1) {
        const empty = document.getElementById('browse-empty');
        if (!message) {
            hideBrowseEmpty();
            return;
        }
        setBrowseGridVisible(false);
        if (!empty)
            return;
        empty.hidden = false;
        empty.innerHTML = '<p class="muted">' + escapeHtml(message) + '</p>';
        SvnHubUI.setPageSlidePage(filesSlide, 'browse', {direction: direction});
        animateBrowseContent(direction);
    }
    function showInlineFile() {
        hideBrowseEmpty();
        setBrowseGridVisible(false);
        SvnHubUI.setPageSlidePage(filesSlide, 'file', {direction: 1});
    }
    async function restoreFilesRoute(filesRoute) {
        const filePath = normalizeRepoPath(filesRoute && filesRoute.filePath);
        const direction = filesRoute && filesRoute.direction ? filesRoute.direction : 1;
        currentFilePath = filePath;
        currentPath = filePath ? parentPath(filePath) : normalizeRepoPath(filesRoute && filesRoute.path);
        filesLoaded = true;
        if (filePath) {
            await loadDir({showList: false});
            const ok = await openFile(filePath, basename(filePath), {writeHistory: false});
            if (!ok)
                showDirectoryList();
        } else {
            await loadDir({direction: direction});
        }
    }
    async function showFilesView(filesRoute = null) {
        ensureGrid();
        if (filesRoute) {
            await restoreFilesRoute(filesRoute);
            return;
        }
        if (!filesLoaded) {
            filesLoaded = true;
            if (currentFilePath)
                await restoreFilesRoute({path: currentPath, filePath: currentFilePath});
            else
                await loadDir();
        } else if (currentFilePath) {
            showInlineFile();
        } else {
            showDirectoryList();   // re-fit columns now that it's visible
        }
    }
    // Single click opens directories and files (a browser, not a data-entry grid).
    // The selection is cleared immediately afterwards so re-clicking the same row
    // (e.g. after backing out of the file viewer) fires again.
    let suppressBrowseSelect = false;
    browseGrid.setOnSelectionChanged((rows) => {
        if (suppressBrowseSelect || !rows || rows.length !== 1)
            return;
        const row = rows[0];
        suppressBrowseSelect = true;
        try {
            browseGrid.deselectAll();
        } finally {
            suppressBrowseSelect = false;
        }
        if (row.kind === 'dir') {
            navigateDir(join(currentPath, row.name));
        } else {
            openFile(join(currentPath, row.name), row.name);
        }
    });

    // Clickable path breadcrumb (repo root / trunk / sub / …). Each segment except
    // the last navigates to that prefix — this replaces the old "Up" button.
    function renderCrumb() {
        const host = document.getElementById('browse-crumb');
        if (!host)
            return;
        const rootLabel = repoName || repoKey || 'root';
        const parts = currentPath ? currentPath.split('/') : [];
        let html = '<button type="button" class="crumb-seg' + (parts.length ? '' : ' current') +
            '" data-path="">' + escapeHtml(rootLabel) + '</button>';
        let acc = '';
        parts.forEach((seg, i) => {
            acc = acc ? acc + '/' + seg : seg;
            const current = (i === parts.length - 1) ? ' current' : '';
            html += '<span class="crumb-sep">/</span>' +
                '<button type="button" class="crumb-seg' + current + '" data-path="' + escapeHtml(acc) + '">' +
                escapeHtml(seg) + '</button>';
        });
        host.innerHTML = html;
    }

    function updateRootsActive() {
        const root = currentPath ? currentPath.split('/')[0] : '';
        [['root-trunk', 'trunk'], ['root-branches', 'branches'], ['root-tags', 'tags']].forEach(([id, name]) => {
            const el = document.getElementById(id);
            if (el)
                el.classList.toggle('active', root === name);
        });
    }
    function syncRootChips(entries) {
        if (!Array.isArray(entries))
            return;
        availableStandardRoots = new Set(entries
            .filter((e) => e && e.kind === 'dir' && STANDARD_ROOT_SET.has(e.name))
            .map((e) => e.name));
        standardRootsKnown = true;
        const host = document.getElementById('root-chips');
        if (host)
            host.hidden = availableStandardRoots.size === 0;
        STANDARD_ROOTS.forEach((name) => {
            const el = document.getElementById('root-' + name);
            if (el)
                el.hidden = availableStandardRoots.size > 0 && !availableStandardRoots.has(name);
        });
        updateRootsActive();
    }
    async function ensureStandardRoots(rootRes = null) {
        if (standardRootsKnown)
            return rootRes;
        const res = rootRes || await Server.callQuiet(WS_BROWSE, 'listDir', {repoId: repoId, path: ''});
        if (res._Success)
            syncRootChips(res.entries || []);
        return res;
    }

    const crumbHost = document.getElementById('browse-crumb');
    if (crumbHost)
        crumbHost.addEventListener('click', (e) => {
            const btn = e.target.closest('.crumb-seg');
            if (!btn)
                return;
            const p = btn.getAttribute('data-path') || '';
            if (p === currentPath)
                return;
            navigateDir(p);
        });

    async function loadDir(options = {}) {
        const shouldShowList = options.showList !== false;
        const direction = options.direction || 1;
        if (shouldShowList && !browseContentPainted)
            hideBrowseResults();
        renderCrumb();
        updateRootsActive();
        let res = null;
        if (currentPath === '')
            res = await Server.callQuiet(WS_BROWSE, 'listDir', {repoId: repoId, path: ''});
        await ensureStandardRoots(currentPath === '' ? res : null);

        const currentRoot = currentPath ? currentPath.split('/')[0] : '';
        if (STANDARD_ROOT_SET.has(currentRoot) && standardRootsKnown && !availableStandardRoots.has(currentRoot)) {
            currentPath = '';
            currentFilePath = '';
            renderCrumb();
            updateRootsActive();
            writeRepoHistory('go-files', {path: '', filePath: ''}, 'replace');
            res = await Server.callQuiet(WS_BROWSE, 'listDir', {repoId: repoId, path: ''});
        } else if (!res) {
            res = await Server.callQuiet(WS_BROWSE, 'listDir', {repoId: repoId, path: currentPath});
        }

        if (res._Success) {
            $$('repo-head').setValue('HEAD r' + res.revision);
            const rows = res.entries.map((e) => ({
                name: e.name,
                kind: e.kind,
                icon: e.kind === 'dir' ? 'dir' : 'file',
                revision: e.revision,
                author: e.author,
                dateStr: fmtDate(e.date),
                message: e.message
            }));
            rows.sort((a, b) => {
                if (a.kind !== b.kind)
                    return a.kind === 'dir' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            browseGrid.clear();
            browseGrid.addRecords(rows);
            setBrowseGridHeight(rows.length);
            if (shouldShowList && rows.length)
                showDirectoryList(false, direction);
            else if (shouldShowList)
                setBrowseEmpty(currentPath ? 'No files in /' + currentPath + ' yet.' : 'No files in this repository yet.', direction);
        } else if (shouldShowList) {
            browseGrid.clear();
            setBrowseEmpty(currentPath ? '/' + currentPath + ' does not exist yet.' : 'No files in this repository yet.', direction);
        }
    }

    // Jump to a root from the chips beside the breadcrumb: switch to the Files
    // section (creating the grid on first use), then list the path.
    async function navigateDir(path, mode = 'push') {
        const previousPath = currentPath;
        const route = {path: normalizeRepoPath(path), filePath: ''};
        route.direction = route.path && route.path.indexOf(previousPath) === 0 && route.path !== previousPath ? 1 : -1;
        currentPath = route.path;
        currentFilePath = '';
        writeRepoHistory('go-files', route, mode);
        await applyView('go-files', route);
    }
    function navigateStandardRoot(root) {
        if (standardRootsKnown && !availableStandardRoots.has(root))
            return;
        navigateDir(root);
    }
    document.getElementById('root-trunk').addEventListener('click', () => navigateStandardRoot('trunk'));
    document.getElementById('root-branches').addEventListener('click', () => navigateStandardRoot('branches'));
    document.getElementById('root-tags').addEventListener('click', () => navigateStandardRoot('tags'));

    // ---- README (checks trunk then root; the menu item only appears when one exists) ----
    async function loadReadme() {
        let res = await Server.callQuiet(WS_BROWSE, 'readme', {repoId: repoId, path: 'trunk'});
        if (!(res._Success && res.found))
            res = await Server.callQuiet(WS_BROWSE, 'readme', {repoId: repoId, path: ''});
        if (res._Success && res.found) {
            let html;
            if (res.isMarkdown && typeof marked !== 'undefined')
                html = marked.parse(res.content);
            else
                html = '<pre>' + escapeHtml(res.content) + '</pre>';
            $$('readme').setHTMLValue(html);
        } else {
            $$('readme').setValue('No README in this repository.');
        }
    }

    // ---- inline file viewer ----
    const HIGHLIGHT_MAX_BYTES = 200000;   // hljs on very large files janks the page
    let rawFile = null;                   // {name, content} for the View-raw button
    let fileLineAnchor = 0;

    function parseLineSelection(value) {
        const rows = new Set();
        String(value || '').split(',').forEach((part) => {
            const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
            if (!m)
                return;
            const a = Number(m[1]);
            const b = Number(m[2] || m[1]);
            const lo = Math.max(1, Math.min(a, b));
            const hi = Math.max(1, Math.max(a, b));
            for (let i = lo; i <= hi && rows.size < 1000; i++)
                rows.add(i);
        });
        return rows;
    }

    function formatLineSelection(rows) {
        const vals = Array.from(rows || []).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
        if (!vals.length)
            return '';
        const parts = [];
        let start = vals[0];
        let prev = vals[0];
        for (let i = 1; i <= vals.length; i++) {
            const n = vals[i];
            if (n === prev + 1) {
                prev = n;
                continue;
            }
            parts.push(start === prev ? String(start) : start + '-' + prev);
            start = n;
            prev = n;
        }
        return parts.join(',');
    }

    function readFileLineSelection() {
        return parseLineSelection(new URLSearchParams(location.search || '').get(FILE_LINES_PARAM) || '');
    }

    function writeFileLineSelection(rows) {
        try {
            const url = new URL(location.href);
            const value = formatLineSelection(rows);
            if (value)
                url.searchParams.set(FILE_LINES_PARAM, value);
            else
                url.searchParams.delete(FILE_LINES_PARAM);
            const target = url.pathname + url.search + url.hash;
            const currentUrl = location.pathname + location.search + location.hash;
            if (target === currentUrl)
                return;
            const state = Object.assign({}, history.state || {}, {fileLines: value});
            history.replaceState(state, '', target);
        } catch (e) { /* history may be unavailable */ }
    }

    function lineSelectionRows(host) {
        return Array.from((host || document).querySelectorAll('.file-line[data-line]'));
    }

    function syncFileLineSelection(host, rows) {
        lineSelectionRows(host).forEach((row) => {
            const selected = rows.has(Number(row.getAttribute('data-line')));
            row.classList.toggle('is-selected', selected);
            const btn = row.querySelector('.file-line-no');
            if (btn)
                btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    function scrollFileSelectionIntoView(host, rows) {
        if (!rows.size)
            return;
        const first = Math.min(...rows);
        const row = host.querySelector('.file-line[data-line="' + first + '"]');
        if (!row)
            return;
        setTimeout(() => {
            if (document.body.contains(row))
                row.scrollIntoView({block: 'center', behavior: 'smooth'});
        }, 30);
    }

    function highlightFileLine(line, language) {
        if (!language || typeof hljs === 'undefined')
            return escapeHtml(line);
        try {
            return hljs.highlight(line, {language: language, ignoreIllegals: true}).value;
        } catch (e) {
            return escapeHtml(line);
        }
    }

    function renderFileLines(text) {
        const host = document.getElementById('file-lines');
        if (!host)
            return;
        const source = String(text || '');
        const lines = source.split('\n');
        let language = '';
        if (typeof hljs !== 'undefined' && source.length <= HIGHLIGHT_MAX_BYTES) {
            try {
                language = hljs.highlightAuto(source).language || '';
            } catch (e) {
                language = '';
            }
        }
        host.className = 'file-viewer-code' + (language ? ' hljs language-' + language : '');
        host.innerHTML = lines.map((line, i) => {
            const n = i + 1;
            return '<div class="file-line" data-line="' + n + '">' +
                '<button type="button" class="file-line-no mono" aria-label="Select line ' + n + '" aria-pressed="false">' + n + '</button>' +
                '<code class="file-line-code">' + highlightFileLine(line, language) + '</code>' +
            '</div>';
        }).join('');

        const selected = readFileLineSelection();
        fileLineAnchor = selected.size ? Math.min(...selected) : 0;
        syncFileLineSelection(host, selected);
        scrollFileSelectionIntoView(host, selected);
    }

    function renderBinaryFileNotice(size) {
        const host = document.getElementById('file-lines');
        if (!host)
            return;
        host.className = 'file-viewer-code file-binary-note';
        host.textContent = 'Binary file (' + fmtSize(size) + ') cannot be displayed inline.';
    }

    function selectFileLine(btn, event) {
        const host = document.getElementById('file-lines');
        const row = btn && btn.closest('.file-line[data-line]');
        if (!host || !row)
            return;
        const lineNo = Number(row.getAttribute('data-line'));
        if (!lineNo)
            return;
        const current = readFileLineSelection();
        let rows = new Set();
        if (event.shiftKey && fileLineAnchor) {
            const lo = Math.min(fileLineAnchor, lineNo);
            const hi = Math.max(fileLineAnchor, lineNo);
            rows = (event.metaKey || event.ctrlKey) ? new Set(current) : new Set();
            for (let i = lo; i <= hi; i++)
                rows.add(i);
        } else if (event.metaKey || event.ctrlKey) {
            rows = new Set(current);
            if (rows.has(lineNo))
                rows.delete(lineNo);
            else
                rows.add(lineNo);
            fileLineAnchor = lineNo;
        } else {
            rows.add(lineNo);
            fileLineAnchor = lineNo;
        }
        syncFileLineSelection(host, rows);
        writeFileLineSelection(rows);
    }

    async function openFile(path, name, options = {}) {
        path = normalizeRepoPath(path);
        const res = await Server.call(WS_BROWSE, 'cat', {repoId: repoId, path: path});
        if (!res._Success)
            return false;
        currentPath = parentPath(path);
        currentFilePath = path;
        renderCrumb();
        updateRootsActive();
        if (options.writeHistory !== false)
            writeRepoHistory('go-files', {path: currentPath, filePath: currentFilePath});
        const title = document.getElementById('file-title');
        const meta = document.getElementById('file-meta');
        const body = document.getElementById('file-viewer-body');
        if (title)
            title.textContent = name || basename(path);
        if (meta)
            meta.textContent = path + ' · ' + fmtSize(res.size);
        if (body)
            body.classList.toggle('is-binary', res.binary === true);
        if (res.binary) {
            rawFile = null;
            $$('file-raw').disable();
            renderBinaryFileNotice(res.size);
        } else {
            rawFile = {name: name || basename(path), content: res.content || ''};
            $$('file-raw').enable();
            renderFileLines(res.content || '');
        }
        showInlineFile();
        return true;
    }
    $$('file-back').onclick(() => navigateDir(currentPath));
    document.getElementById('file-lines').addEventListener('click', (e) => {
        const btn = e.target.closest('.file-line-no');
        if (!btn)
            return;
        selectFileLine(btn, e);
    });
    document.getElementById('file-lines').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ')
            return;
        const btn = e.target.closest('.file-line-no');
        if (!btn)
            return;
        e.preventDefault();
        selectFileLine(btn, e);
    });
    // Open the raw file text in a new tab via a blob URL (no server round trip).
    $$('file-raw').onclick(() => {
        if (!rawFile)
            return;
        const blob = new Blob([rawFile.content], {type: 'text/plain;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    });

    // ---- revision feed (the central line) ----
    const AMD = {A: 'add', M: 'mod', D: 'del', R: 'rep'};

    function pathBadges(paths) {
        if (!paths || !paths.length)
            return '';
        let h = paths.slice(0, 4).map((p) => {
            const t = (p.type || 'M').toUpperCase();
            const cls = AMD[t] || 'mod';
            const name = (p.path || '').replace(/^\/(trunk|branches|tags)\//, '');
            return '<span class="rev-path"><span class="amd amd-' + cls + '">' + escapeHtml(t) + '</span>' +
                '<span class="mono">' + escapeHtml(name || p.path) + '</span></span>';
        }).join('');
        if (paths.length > 4)
            h += '<span class="rev-more">+' + (paths.length - 4) + ' more</span>';
        return h;
    }

    async function loadCommits() {
        const feed = document.getElementById('revision-feed');
        const res = await Server.call(WS_HIST, 'log', {repoId: repoId, path: '', limit: 40, withPaths: true});
        if (!res._Success) {
            feed.innerHTML = '<p class="muted">No history available.</p>';
            return;
        }
        const commits = res.commits.filter((c) => c.revision > 0);
        $$('rev-count').setValue(commits.length + (commits.length === 1 ? ' revision' : ' revisions'));
        if (!commits.length) {
            feed.innerHTML = '<p class="muted">No revisions yet.</p>';
            return;
        }
        feed.innerHTML = commits.map((c) => {
            const badges = pathBadges(c.paths);
            return '<div class="rev-node" data-rev="' + c.revision + '" tabindex="0">' +
                '<div class="rev-dot">' + c.revision + '</div>' +
                '<div class="rev-body">' +
                    '<div class="rev-msg">' + escapeHtml(c.message || '(no message)') + '</div>' +
                    '<div class="rev-meta">' +
                        '<span class="rev-author">' + escapeHtml(c.author || 'unknown') + '</span>' +
                        '<span class="rev-dotsep">·</span><span>' + escapeHtml(fmtDate(c.date)) + '</span>' +
                        '<span class="rev-dotsep">·</span><span class="mono">r' + c.revision + '</span>' +
                    '</div>' +
                    (badges ? '<div class="rev-paths">' + badges + '</div>' : '') +
                '</div>' +
            '</div>';
        }).join('');
    }

    const feedEl = document.getElementById('revision-feed');
    feedEl.addEventListener('click', (e) => {
        const node = e.target.closest('.rev-node');
        if (node)
            openRevision(Number(node.getAttribute('data-rev')));
    });
    feedEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const node = e.target.closest('.rev-node');
        if (node)
            openRevision(Number(node.getAttribute('data-rev')));
    });

    // ---- in-place revision viewer (full-width diffs, ?rev=N deep link) ----
    let currentRev = 0;

    function revFromUrl() {
        const v = new URLSearchParams(location.search || '').get('rev') || '';
        return /^\d+$/.test(v) ? Number(v) : 0;
    }
    function writeRevHistory(rev, mode = 'push') {
        try {
            const url = new URL(location.href);
            if (rev)
                url.searchParams.set('rev', rev);
            else
                url.searchParams.delete('rev');
            url.searchParams.delete('diffFile');
            url.searchParams.delete('diffRows');
            url.searchParams.delete(FILE_LINES_PARAM);
            const target = url.pathname + url.search + url.hash;
            const currentUrl = location.pathname + location.search + location.hash;
            if (mode !== 'replace' && target === currentUrl)
                return;
            const state = Object.assign({}, history.state || {},
                {__repoSection: 'history', repoId: repoId, repoKey: repoKey, repoName: repoName, rev: rev || 0});
            history[mode === 'replace' ? 'replaceState' : 'pushState'](state, '', target);
        } catch (e) { /* history not available */ }
    }
    function showRevisionFeed() {
        currentRev = 0;
        SvnHubUI.setPageSlidePage(historySlide, 'feed', {direction: -1});
    }
    async function openRevision(rev, options = {}) {
        currentRev = rev;
        if (options.writeHistory !== false)
            writeRevHistory(rev);
        SvnHubUI.setPageSlidePage(historySlide, 'detail', {direction: 1});
        document.getElementById('rev-title').textContent = 'Revision ' + rev;
        document.getElementById('rev-meta').textContent = '';
        document.getElementById('rev-message').innerHTML = '';
        const host = document.getElementById('rev-diff-host');
        host.innerHTML = SvnHubUI.spinner('Loading diff…');
        const res = await Server.call(WS_HIST, 'revisionDetail', {repoId: repoId, revision: rev});
        if (currentRev !== rev || !document.getElementById('rev-diff-host'))
            return;                       // user moved on while we were fetching
        if (!res._Success) {
            host.innerHTML = '<p class="muted" style="margin:0;">Unable to load this revision.</p>';
            return;
        }
        document.getElementById('rev-meta').textContent =
            (res.author || 'unknown') + ' · ' + fmtDate(res.date) + ' · r' + rev;
        document.getElementById('rev-message').innerHTML = SvnHubUI.commitMessage(res.message);
        host.innerHTML = SvnHubUI.spinner('Rendering diff…');
        await Utils.nextPaint();
        if (currentRev !== rev || !document.getElementById('rev-diff-host'))
            return;
        SvnHubUI.renderUnifiedDiff(host, res.diff);
        SvnHubUI.refreshPageSlide(historySlide);
        SvnHubUI.refreshPageSlide(repoMainSlide);
    }
    $$('rev-back').onclick(() => {
        showRevisionFeed();
        writeRevHistory(0, 'replace');
    });

    // ---- init ----
    if (Utils.setAppNavActive)
        Utils.setAppNavActive(repoNav());
    if (guest)
        menuEl('go-insights').style.display = 'none';
    let checkoutUrl = '';
    let checkoutFeedbackTimer = null;
    function showCheckoutFeedback(message) {
        const btn = document.getElementById('checkout-btn');
        const text = document.getElementById('checkout-feedback-text');
        if (!btn || !text)
            return;
        text.textContent = message;
        btn.classList.add('copied');
        clearTimeout(checkoutFeedbackTimer);
        checkoutFeedbackTimer = setTimeout(() => btn.classList.remove('copied'), 1500);
    }
    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        document.body.removeChild(ta);
        return ok;
    }
    document.getElementById('checkout-btn').addEventListener('click', () => {
        const cmd = 'svn checkout ' + (checkoutUrl || '');
        if (!checkoutUrl)
            return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(cmd).then(
                () => showCheckoutFeedback('Copied to clipboard'),
                () => showCheckoutFeedback(fallbackCopy(cmd) ? 'Copied to clipboard' : 'Copy failed'));
        } else {
            showCheckoutFeedback(fallbackCopy(cmd) ? 'Copied to clipboard' : 'Copy failed');
        }
    });

    // Open the requested section immediately. The surrounding overview cards and
    // secondary panels load in the background, so a slow README/history/stats call
    // cannot leave the visible Files section as an empty shell.
    const startFilesRoute = startMenu === 'go-files' ? {path: currentPath, filePath: currentFilePath} : null;
    const shouldOpenPendingRevision = pendingRevision && startMenu === 'go-history';
    writeRepoHistory(startMenu, startFilesRoute, 'replace', true);
    if (shouldOpenPendingRevision)
        writeRevHistory(pendingRevision, 'replace');
    backgroundLoad('initial view', () => applyView(startMenu, startFilesRoute));

    const commitsLoad = backgroundLoad('history', loadCommits);
    backgroundLoad('README', loadReadme);
    backgroundLoad('overview', loadAbout);
    if (shouldOpenPendingRevision && !revFromUrl())
        commitsLoad.then(() => focusRevision(pendingRevision));

    let repoRes = {_Success: false};
    try {
        repoRes = await Server.call(WS_REPO, 'getRepository', {repoId: repoId});
    } catch (e) {
        console.error('Repository metadata load failed', e);
    }
    if (repoRes._Success && repoRes.repo) {
        const repo = repoRes.repo;
        repoKey = repo.repoKey || repoKey;
        repoName = repo.name || repoName || repo.repoKey;
        Utils.saveData('repoKey', repoKey);
        Utils.saveData('repoName', repoName);
        $$('repo-owner').setValue(ownerFromKey(repoKey));
        $$('repo-title').setValue(repoName || repoKey);
        checkoutUrl = repo.checkoutUrl || '';
        $$('repo-head').setValue('HEAD r' + (repo.headRevision || 0));   // set now; loadDir is lazy
        $$('repo-visibility').setValue(repo.visibility || 'repository');
        document.getElementById('repo-checkout-display').textContent = repo.checkoutUrl || document.getElementById('repo-checkout-display').textContent;
        setNavCount('count-issues', repo.openIssueCount || 0);
        setNavCount('count-mrs', repo.openMergeRequestCount || 0);
        document.getElementById('repo-subhead').textContent = repo.description || '';
        setFact('fact-head', 'r' + (repo.headRevision || 0));
        setFact('fact-created', fmtDate(repo.createdTs));
        renderCrumb();
    }

    // ---- manage repository (edit metadata / access) — repo admins only ----
    const currentRepo = (repoRes._Success && repoRes.repo) ? repoRes.repo : null;
    const canAdminRepo = !!(repoRes._Success && repoRes.access && repoRes.access.admin);
    const repoSettingsMenu = document.getElementById('repo-settings-menu');
    if (repoSettingsMenu)
        repoSettingsMenu.hidden = !(canAdminRepo && currentRepo);

    const reErr = document.getElementById('re-name-err');
    function showEditRepoError(msg) {
        reErr.textContent = msg || '';
        reErr.classList.toggle('show', !!msg);
        $$('re-name').element.classList.toggle('input-bad', !!msg);
    }
    function editRepoNameProblem(name) {
        if (!name)
            return 'A display name is required.';
        if (name.length > 100)
            return 'Use 100 characters or fewer.';
        if (name.indexOf('/') >= 0)
            return 'The display name cannot contain a slash.';
        return '';
    }
    function setEditRepoVisibility(visibility) {
        const radio = document.getElementById(visibility === 'public' ? 're-vis-public' : 're-vis-private');
        if (radio)
            radio.checked = true;
    }
    function getEditRepoVisibility() {
        const radio = document.querySelector('input[type=radio][name="re-vis"]:checked');
        return radio ? radio.value : 'private';
    }
    function openEditRepo() {
        if (!currentRepo)
            return;
        $$('re-name').setValue(currentRepo.name || '');
        $$('re-desc').setValue(currentRepo.description || '');
        $$('re-default-branch').setValue(currentRepo.defaultBranch || '');
        setEditRepoVisibility(currentRepo.visibility);
        document.getElementById('re-svn-url').textContent = currentRepo.checkoutUrl || repoKey || '';
        showEditRepoError('');
        Utils.popup_open('repo-edit-popup', 're-name');
    }
    async function submitEditRepo() {
        const name = $$('re-name').getValue().trim();
        const problem = editRepoNameProblem(name);
        if (problem) {
            showEditRepoError(problem);
            $$('re-name').focus();
            return;
        }
        showEditRepoError('');
        const description = $$('re-desc').getValue().trim();
        const defaultBranch = $$('re-default-branch').getValue().trim();
        const visibility = getEditRepoVisibility();
        const res = await Server.call(WS_REPO, 'updateRepository', {
            repoId: repoId,
            name: name,
            description: description,
            defaultBranch: defaultBranch,
            visibility: visibility
        });
        if (!res._Success)
            return;
        Utils.popup_close();
        Utils.toast.success('Repository saved');
        // Reflect the changes in place — no full reload needed.
        currentRepo.name = name;
        currentRepo.description = description;
        currentRepo.defaultBranch = defaultBranch;
        currentRepo.visibility = visibility;
        repoName = name;
        Utils.saveData('repoName', repoName);
        $$('repo-title').setValue(repoName);
        $$('repo-visibility').setValue(visibility);
        document.getElementById('repo-subhead').textContent = description || '';
    }
    $$('re-cancel').onclick(() => Utils.popup_close());
    $$('re-submit').onclick(submitEditRepo);
    $$('re-name').onEnter(submitEditRepo);
    $$('re-desc').onEnter(submitEditRepo);
    $$('re-default-branch').onEnter(submitEditRepo);

    // ---- delete repository -------------------------------------------------
    let deleteConfirmName = '';
    let deletePending = false;
    const rdErr = document.getElementById('rd-err');
    const rdLoading = document.getElementById('rd-loading');
    const rdModal = document.getElementById('repo-delete-modal');

    const dashboardTarget = {
        page: 'screens/Dashboard/Dashboard',
        nav: 'repositories',
        data: {}
    };

    function repoDeleteName() {
        return (currentRepo && currentRepo.name) || repoName || repoKey || 'this repository';
    }

    function showDeleteRepoError(msg) {
        rdErr.textContent = msg || '';
        rdErr.classList.toggle('show', !!msg);
        $$('rd-confirm').element.classList.toggle('input-bad', !!msg);
    }

    function syncDeleteRepoConfirm() {
        if (deletePending)
            return;
        const typed = $$('rd-confirm').getValue().trim();
        $$('rd-submit').enable(typed === deleteConfirmName);
        if (rdErr.textContent)
            showDeleteRepoError('');
    }

    function setDeleteRepoPending(on) {
        deletePending = !!on;
        if (rdModal) {
            rdModal.classList.toggle('is-deleting', deletePending);
            rdModal.setAttribute('aria-busy', deletePending ? 'true' : 'false');
        }
        if (rdLoading)
            rdLoading.hidden = !deletePending;
        $$('rd-confirm').enable(!deletePending);
        $$('rd-cancel').enable(!deletePending);
        const rdClose = document.querySelector('#repo-delete-popup [data-popup-close]');
        if (rdClose)
            rdClose.disabled = deletePending;
        if (deletePending) {
            showDeleteRepoError('');
            $$('rd-submit').setValue('Deleting...').disable();
        } else {
            $$('rd-submit').setValue('Delete repo');
            syncDeleteRepoConfirm();
        }
    }

    function clearSavedRepoState() {
        Utils.getAndEraseData('repoId');
        Utils.getAndEraseData('repoKey');
        Utils.getAndEraseData('repoName');
        Utils.getAndEraseData('repoSection');
        Utils.getAndEraseData('repoRevision');
        Utils.getAndEraseData('repoPath');
        Utils.getAndEraseData('repoFile');
        Utils.getAndEraseData('repoIssue');
        Utils.getAndEraseData('repoMergeRequest');
    }

    function openDeleteRepo() {
        if (!currentRepo)
            return;
        deleteConfirmName = repoDeleteName();
        document.getElementById('rd-name').textContent = deleteConfirmName;
        document.getElementById('rd-confirm-name').textContent = deleteConfirmName;
        $$('rd-confirm').setValue('');
        setDeleteRepoPending(false);
        showDeleteRepoError('');
        Utils.popup_open('repo-delete-popup', 'rd-confirm');
    }

    async function submitDeleteRepo() {
        if (deletePending)
            return;
        const confirm = $$('rd-confirm').getValue().trim();
        if (confirm !== deleteConfirmName) {
            showDeleteRepoError('Type the repository name exactly to confirm.');
            $$('rd-confirm').focus();
            return;
        }
        setDeleteRepoPending(true);
        const res = await Server.call(WS_REPO, 'deleteRepository', {
            repoId: repoId,
            confirm: confirm
        });
        if (!res._Success) {
            setDeleteRepoPending(false);
            return;
        }
        Utils.popup_close();
        if (res.fileCleanupWarning)
            Utils.toast.warning('Repository removed; file cleanup needs attention');
        else
            Utils.toast.success('Repository deleted');
        clearSavedRepoState();
        SvnHubUI.routeTarget(dashboardTarget);
    }

    $$('rd-cancel').onclick(() => Utils.popup_close());
    $$('rd-submit').onclick(submitDeleteRepo);
    $$('rd-confirm').onEnter(submitDeleteRepo);
    $$('rd-confirm').element.addEventListener('input', syncDeleteRepoConfirm);

    // ---- access management -------------------------------------------------
    // A two-pane popup: the list of people with access, and an add/edit pane
    // that slides in (login-page style). The user picker searches active users
    // on the server in pages, so it stays usable with thousands of accounts.
    const ACC_AVATARS = ['#1f5d57', '#809cc9', '#5768a4', '#6b2c4e', '#3a4f86', '#c08a1a', '#2c7a72'];
    const ACC_SEARCH_PAGE_SIZE = 20;
    let accRows = [];           // current grants (rows from getAccess)
    let accGrantByUser = {};    // userId -> grant row
    let accChosen = null;       // user selected in the add/edit pane
    let accEditing = false;     // true when opened from an existing grant
    let accSearchRows = [];
    let accSearchTotal = 0;
    let accSearchPage = 0;
    let accSearchQuery = '';
    let accSearchRunner = null;

    function accAvatar(userId, name) {
        const color = ACC_AVATARS[Math.abs(Number(userId) || 0) % ACC_AVATARS.length];
        return '<span class="acc-av" style="background:' + color + '">' +
            escapeHtml(SvnHubUI.personInitials(name)) + '</span>';
    }
    function accPermChips(r) {
        let h = '';
        if (r.canRead === 'Y')
            h += '<span class="acc-chip read">Read</span>';
        if (r.canWrite === 'Y')
            h += '<span class="acc-chip write">Write</span>';
        if (r.canAdmin === 'Y')
            h += '<span class="acc-chip admin">Admin</span>';
        if (!h)
            h = '<span class="acc-chip none">No access</span>';
        if (r.hasSvnPassword !== 'Y')
            h += '<span class="acc-chip nopw" title="This user has not set an SVN password yet and cannot authenticate to svnserve.">no SVN pw</span>';
        return h;
    }

    function renderAccessPeople() {
        const host = document.getElementById('acc-people');
        const count = document.getElementById('acc-count');
        count.textContent = accRows.length + (accRows.length === 1 ? ' person' : ' people');
        if (!accRows.length) {
            host.innerHTML = '<p class="muted acc-empty">Nobody has been granted access yet. Use “+ Add user” to invite someone.</p>';
            return;
        }
        host.innerHTML = accRows.map((r) => {
            return '<div class="acc-person" data-user-id="' + r.userId + '" tabindex="0" role="button" ' +
                    'aria-label="Edit access for ' + escapeHtml(r.userName) + '">' +
                accAvatar(r.userId, r.fullName || r.userName) +
                '<div class="acc-person-names">' +
                    '<div class="acc-person-name">' + escapeHtml(r.userName) + '</div>' +
                    (r.fullName ? '<div class="acc-person-full muted">' + escapeHtml(r.fullName) + '</div>' : '') +
                '</div>' +
                '<div class="acc-person-chips">' + accPermChips(r) + '</div>' +
                '<button type="button" class="acc-person-remove" data-remove="' + r.userId + '" ' +
                    'title="Remove access" aria-label="Remove access for ' + escapeHtml(r.userName) + '">&times;</button>' +
            '</div>';
        }).join('');
    }

    async function loadAccess() {
        const res = await Server.call(WS_ACC, 'getAccess', {repoId: repoId});
        if (!res._Success)
            return false;
        accRows = res.rows || [];
        accGrantByUser = {};
        accRows.forEach((r) => {
            accGrantByUser[r.userId] = r;
        });
        renderAccessPeople();
        return true;
    }

    function showAccPane(which) {
        document.getElementById('acc-stage').classList.toggle('show-edit', which === 'edit');
    }

    // ---- add / edit pane ----
    function setChosenUser(u, grant) {
        accChosen = u;
        const searchField = document.getElementById('acc-search-field');
        const chosen = document.getElementById('acc-chosen');
        const editPane = document.getElementById('acc-pane-edit');
        const perms = document.getElementById('acc-perms');
        const actions = document.querySelector('#acc-pane-edit .acc-edit-actions');
        if (!u) {
            accEditing = false;
            editPane.classList.add('is-searching');
            searchField.hidden = false;
            chosen.hidden = true;
            perms.hidden = true;
            actions.hidden = true;
            document.getElementById('acc-search').value = '';
            clearAccSearch();
            document.getElementById('acc-edit-title').textContent = 'Add a user';
            $$('acc-remove').hide(true);
            $$('acc-read').setValue(true);
            $$('acc-write').setValue(false);
            $$('acc-admin').setValue(false);
            $$('acc-grant').setValue('Grant access');
            return;
        }
        editPane.classList.remove('is-searching');
        document.getElementById('acc-edit-title').textContent = 'Edit access';
        searchField.hidden = true;
        chosen.hidden = false;
        perms.hidden = false;
        actions.hidden = false;
        const av = document.getElementById('acc-chosen-av');
        av.style.background = ACC_AVATARS[Math.abs(Number(u.userId) || 0) % ACC_AVATARS.length];
        av.textContent = SvnHubUI.personInitials(u.fullName || u.userName);
        document.getElementById('acc-chosen-name').textContent = u.userName;
        document.getElementById('acc-chosen-handle').textContent = u.fullName || '';
        const g = grant || accGrantByUser[u.userId];
        accEditing = !!g;
        $$('acc-remove').hide(!accEditing);
        $$('acc-read').setValue(g ? g.canRead === 'Y' : true);
        $$('acc-write').setValue(g ? g.canWrite === 'Y' : false);
        $$('acc-admin').setValue(g ? g.canAdmin === 'Y' : false);
        $$('acc-grant').setValue(g ? 'Save changes' : 'Grant access');
    }

    function clearAccSearch(cancel = true) {
        if (cancel && accSearchRunner)
            accSearchRunner.cancel();
        accSearchRows = [];
        accSearchTotal = 0;
        accSearchPage = 0;
        accSearchQuery = '';
        const host = document.getElementById('acc-results');
        host.innerHTML = '';
        host.hidden = true;
    }

    function renderAccSearchResults(q, loading = false, errorText = '') {
        const host = document.getElementById('acc-results');
        const query = (q || '').trim();
        if (!query) {
            host.innerHTML = '';
            host.hidden = true;
            return;
        }
        host.hidden = false;
        if (loading && !accSearchRows.length) {
            host.innerHTML = '<p class="muted acc-results-hint">Searching...</p>';
            return;
        }
        if (errorText) {
            host.innerHTML = '<p class="muted acc-results-hint">' + escapeHtml(errorText) + '</p>';
            return;
        }
        if (!accSearchRows.length) {
            host.innerHTML = '<p class="muted acc-results-hint">No users match "' + escapeHtml(q) + '".</p>';
            return;
        }
        let html = accSearchRows.map((u) => {
            const has = !!accGrantByUser[u.userId];
            return '<button type="button" class="acc-result" data-user-id="' + u.userId + '">' +
                accAvatar(u.userId, u.fullName || u.userName) +
                '<span class="acc-result-names">' +
                    '<span class="acc-result-name">' + escapeHtml(u.userName) + '</span>' +
                    (u.fullName ? '<span class="acc-result-full muted">' + escapeHtml(u.fullName) + '</span>' : '') +
                '</span>' +
                (has ? '<span class="acc-chip read acc-result-has">has access</span>' : '') +
            '</button>';
        }).join('');
        if (accSearchRows.length < accSearchTotal) {
            html += '<button type="button" class="acc-results-more" data-load-more="true">' +
                'Load more <span>Showing ' + accSearchRows.length + ' of ' + accSearchTotal + '</span>' +
            '</button>';
        } else if (accSearchTotal > ACC_SEARCH_PAGE_SIZE) {
            html += '<p class="muted acc-results-hint">Showing all ' + accSearchTotal + ' matches.</p>';
        }
        host.innerHTML = html;
    }

    async function runAccSearch(q, page = 0, append = false, token = null) {
        const query = (q || '').trim();
        if (!query) {
            clearAccSearch();
            return;
        }
        if (token == null)
            token = accSearchRunner.cancel();
        accSearchQuery = query;
        if (!append) {
            accSearchRows = [];
            accSearchTotal = 0;
            accSearchPage = 0;
        }
        renderAccSearchResults(query, true);
        const res = await Server.callQuiet(WS_ACC, 'searchUsers', {
            repoId: repoId,
            query: query,
            page: page,
            pageSize: ACC_SEARCH_PAGE_SIZE
        });
        if (!accSearchRunner.isCurrent(token))
            return;
        if (!res._Success) {
            renderAccSearchResults(query, false, 'Unable to search users right now.');
            return;
        }
        const rows = res.rows || [];
        accSearchRows = append ? accSearchRows.concat(rows) : rows;
        accSearchTotal = Number(res.total) || accSearchRows.length;
        accSearchPage = Number(res.page) || page;
        renderAccSearchResults(query);
    }

    function scheduleAccSearch(q) {
        const query = (q || '').trim();
        if (!query) {
            clearAccSearch();
            return;
        }
        accSearchQuery = query;
        accSearchRows = [];
        accSearchTotal = 0;
        accSearchPage = 0;
        renderAccSearchResults(query, true);
        accSearchRunner.schedule();
    }

    accSearchRunner = SvnHubUI.createDebouncedRunner((token) => {
        runAccSearch(accSearchQuery, 0, false, token);
    }, 220);

    function openAccessEditor(grantRow) {
        accEditing = !!grantRow;
        document.getElementById('acc-edit-title').textContent = accEditing ? 'Edit access' : 'Add a user';
        $$('acc-remove').hide(!accEditing);
        if (grantRow) {
            setChosenUser({userId: grantRow.userId, userName: grantRow.userName, fullName: grantRow.fullName}, grantRow);
        } else {
            setChosenUser(null);
        }
        showAccPane('edit');
        if (!grantRow)
            setTimeout(() => document.getElementById('acc-search').focus(), 250);   // after the slide
    }

    async function openAccess() {
        $$('acc-title').setValue('Access — ' + (repoName || repoKey));
        document.getElementById('acc-people').innerHTML = SvnHubUI.spinner('Loading…');
        document.getElementById('acc-count').textContent = '';
        showAccPane('list');
        Utils.popup_open('repo-access-popup');
        await loadAccess();
    }

    $$('repo-settings-menu').onSelect((value) => {
        if (value === 'edit')
            openEditRepo();
        else if (value === 'access')
            openAccess();
        else if (value === 'delete')
            openDeleteRepo();
    });
    $$('acc-close').onclick(() => Utils.popup_close());
    document.getElementById('acc-add-btn').addEventListener('click', () => openAccessEditor(null));
    document.getElementById('acc-back').addEventListener('click', () => showAccPane('list'));
    document.getElementById('acc-change').addEventListener('click', () => {
        setChosenUser(null);
        setTimeout(() => document.getElementById('acc-search').focus(), 0);
    });

    // People list: click a row to edit, × to remove.
    document.getElementById('acc-people').addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.acc-person-remove');
        if (removeBtn) {
            const uid = Number(removeBtn.getAttribute('data-remove'));
            const row = accGrantByUser[uid];
            if (!row)
                return;
            Utils.yesNo('Remove access', 'Remove ' + row.userName + '\u2019s access to this repository?', async () => {
                const res = await Server.call(WS_ACC, 'revoke', {repoId: repoId, userId: uid});
                if (res._Success) {
                    Utils.toast.success('Access removed');
                    await loadAccess();
                }
            });
            return;
        }
        const person = e.target.closest('.acc-person');
        if (person)
            openAccessEditor(accGrantByUser[Number(person.getAttribute('data-user-id'))]);
    });
    document.getElementById('acc-people').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const person = e.target.closest('.acc-person');
        if (person)
            openAccessEditor(accGrantByUser[Number(person.getAttribute('data-user-id'))]);
    });

    const accSearchInput = document.getElementById('acc-search');
    accSearchInput.addEventListener('input', (e) => {
        scheduleAccSearch(e.target.value);
    });
    accSearchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        e.preventDefault();
        runAccSearch(e.target.value, 0, false);
    });
    document.getElementById('acc-results').addEventListener('click', (e) => {
        const more = e.target.closest('.acc-results-more');
        if (more) {
            runAccSearch(accSearchQuery, accSearchPage + 1, true);
            return;
        }
        const btn = e.target.closest('.acc-result');
        if (!btn)
            return;
        const uid = Number(btn.getAttribute('data-user-id'));
        const u = accSearchRows.find((x) => Number(x.userId) === uid);
        if (u)
            setChosenUser(u);
    });

    $$('acc-grant').onclick(async () => {
        if (!accChosen) {
            Utils.showMessage('Select a user', 'Search for and choose a user first.');
            return;
        }
        const res = await Server.call(WS_ACC, 'grant', {
            repoId: repoId,
            userId: Number(accChosen.userId),
            canRead: $$('acc-read').getValue(),
            canWrite: $$('acc-write').getValue(),
            canAdmin: $$('acc-admin').getValue()
        });
        if (res._Success) {
            Utils.toast.success(accEditing ? 'Access updated' : 'Access granted');
            await loadAccess();
            showAccPane('list');
        }
    });
    $$('acc-remove').onclick(() => {
        if (!accChosen)
            return;
        Utils.yesNo('Remove access', 'Remove ' + accChosen.userName + '\u2019s access to this repository?', async () => {
            const res = await Server.call(WS_ACC, 'revoke', {repoId: repoId, userId: Number(accChosen.userId)});
            if (res._Success) {
                Utils.toast.success('Access removed');
                await loadAccess();
                showAccPane('list');
            }
        });
    });

    // Scroll to and highlight one revision in the History feed (deep link).
    function focusRevision(rev) {
        const node = document.querySelector('.rev-node[data-rev="' + rev + '"]');
        if (!node)
            return;
        node.classList.add('rev-focus');
        try {
            node.scrollIntoView({block: 'center', behavior: 'smooth'});
        } catch (e) {
            node.scrollIntoView();
        }
    }

    // ---- About facts (branches / tags / files / size come from the stats service) ----
    async function loadAbout() {
        const today = (typeof DateUtils !== 'undefined') ? DateUtils.today() : 20260101;
        const res = await Server.call(WS_STATS, 'repoFacts', {repoId: repoId, beginDay: 19900101, endDay: today});
        if (!res._Success) {
            // Settle the loading shimmer so the card doesn't animate forever.
            ['fact-branches', 'fact-tags', 'fact-files', 'fact-size'].forEach((id) => setFact(id, null));
            return;
        }
        setFact('fact-head', 'r' + (res.headRevision || 0));
        setFact('fact-branches', res.branchCount == null ? '–' : res.branchCount);
        setFact('fact-tags', res.tagCount == null ? '–' : res.tagCount);
        setFact('fact-files', res.fileCount == null ? '–' : res.fileCount);
        setFact('fact-size', fmtSize(res.sizeBytes));
        if (res.createdTs)
            setFact('fact-created', fmtDate(res.createdTs));
    }

})();
