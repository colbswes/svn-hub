/* global $$, Utils, Server, Router, SvnHubUI */

'use strict';

(async function () {

    const screenArea = 'app-screen-area';
    const navIds = ['repositories', 'discover', 'insights', 'users', 'help'];
    //  A "guest" is any visitor without a session — exactly who the Router treats as
    //  unauthenticated.  Derive it from the live session (rather than a stored flag) and
    //  publish it so the public sub-screens, which read Utils.getData('guest'), agree.
    const guest = !Server.uuid;
    Utils.saveData('guest', guest);
    const isAdmin = Utils.getData('isAdmin') === true;
    const appNav = document.querySelector('.app-nav');
    const primaryNav = document.getElementById('primary-nav');
    const navMenu = document.getElementById('nav-menu');
    const mobileNavToggle = document.getElementById('mobile-nav-toggle');
    const mobileNavMq = window.matchMedia('(max-width: 760px)');
    let activeNavId = null;
    let navPillReady = false;
    let navPillReadyQueued = false;

    function isMobileNav() {
        return mobileNavMq.matches;
    }

    function syncMobileNavAccessibility(open) {
        if (!navMenu)
            return;
        const hidden = isMobileNav() && !open;
        navMenu.setAttribute('aria-hidden', hidden ? 'true' : 'false');
        if ('inert' in navMenu)
            navMenu.inert = hidden;
    }

    function setMobileNavOpen(open) {
        if (!appNav || !mobileNavToggle)
            return;
        const shouldOpen = !!open && isMobileNav();
        appNav.classList.toggle('menu-open', shouldOpen);
        mobileNavToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        mobileNavToggle.setAttribute('aria-label', shouldOpen ? 'Close navigation' : 'Open navigation');
        mobileNavToggle.title = shouldOpen ? 'Close menu' : 'Menu';
        syncMobileNavAccessibility(shouldOpen);
        window.requestAnimationFrame(updateActiveNavPill);
    }

    function syncMobileNavMode() {
        if (!isMobileNav()) {
            setMobileNavOpen(false);
            return;
        }
        syncMobileNavAccessibility(appNav && appNav.classList.contains('menu-open'));
    }

    function isUsableNavButton(el) {
        return el && primaryNav && primaryNav.contains(el) && el.offsetParent !== null && !el.disabled;
    }

    function setNavPillVars(prefix, el) {
        if (!primaryNav || !isUsableNavButton(el))
            return false;
        const navRect = primaryNav.getBoundingClientRect();
        const btnRect = el.getBoundingClientRect();
        primaryNav.style.setProperty('--nav-' + prefix + '-x', Math.round(btnRect.left - navRect.left) + 'px');
        primaryNav.style.setProperty('--nav-' + prefix + '-y', Math.round(btnRect.top - navRect.top) + 'px');
        primaryNav.style.setProperty('--nav-' + prefix + '-w', Math.round(btnRect.width) + 'px');
        primaryNav.style.setProperty('--nav-' + prefix + '-h', Math.round(btnRect.height) + 'px');
        return true;
    }

    function updateActiveNavPill() {
        const ctl = activeNavId ? $$(activeNavId) : null;
        const ok = ctl && setNavPillVars('active', ctl.element);
        if (!primaryNav)
            return;
        primaryNav.classList.toggle('nav-has-active', !!ok);
        if (!ok)
            return;
        if (navPillReady) {
            primaryNav.classList.add('nav-ready');
            return;
        }
        if (navPillReadyQueued)
            return;
        navPillReadyQueued = true;
        window.requestAnimationFrame(() => {
            navPillReady = true;
            navPillReadyQueued = false;
            primaryNav.classList.add('nav-ready');
        });
    }

    function setActive(id, page) {
        activeNavId = id || null;
        for (const navId of navIds) {
            const ctl = $$(navId);
            if (!ctl)
                continue;
            const active = navId === id;
            ctl.element.classList.toggle('active', active);
            if (active)
                ctl.element.setAttribute('aria-current', 'page');
            else
                ctl.element.removeAttribute('aria-current');
        }
        window.requestAnimationFrame(updateActiveNavPill);

        const navSearch = document.getElementById('nav-search');
        if (navSearch)
            navSearch.classList.toggle('hidden', page === 'screens/Discover/Discover');
        setMobileNavOpen(false);
    }

    Utils.setAppNavActive = setActive;

    if (mobileNavToggle) {
        mobileNavToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            setMobileNavOpen(!appNav.classList.contains('menu-open'));
        });
        syncMobileNavMode();
        if (mobileNavMq.addEventListener)
            mobileNavMq.addEventListener('change', syncMobileNavMode);
    }

    //  Map a screen page path to its Router route (declared in routes.js).  Screen
    //  data is passed via Utils.saveData before navigating (screens read it with
    //  Utils.getData), so these route paths carry no parameters.
    const PAGE_ROUTES = {
        'screens/Dashboard/Dashboard': '/dashboard',
        'screens/Discover/Discover': '/discover',
        'screens/Insights/Insights': '/insights',
        'screens/Users/Users': '/users',
        'screens/Help/Help': '/help',
        'screens/AboutSubversion/AboutSubversion': '/about-subversion',
        'screens/Repository/Repository': '/repository',
        'screens/Person/Person': '/person',
        'screens/Landing/Landing': '/landing'
    };
    function pageRoute(page) {
        return PAGE_ROUTES[page] || '/';
    }

    function route(id, page) {
        setActive(id, page);
        Router.go(pageRoute(page));
    }

    function goSignIn() {
        setMobileNavOpen(false);
        Server.clearSession();
        Router.go('/login');
    }

    $$('repositories').onclick(function () {
        if (guest) {
            route('discover', 'screens/Discover/Discover');
            return;
        }
        route('repositories', 'screens/Dashboard/Dashboard');
    });

    $$('discover').onclick(function () {
        route('discover', 'screens/Discover/Discover');
    });

    $$('insights').onclick(function () {
        if (guest) {
            goSignIn();
            return;
        }
        route('insights', 'screens/Insights/Insights');
    });

    $$('users').onclick(function () {
        if (!isAdmin)
            return;
        if (guest) {
            goSignIn();
            return;
        }
        route('users', 'screens/Users/Users');
    });

    $$('help').onclick(function () {
        route('help', 'screens/Help/Help');
    });

    $$('signin').onclick(goSignIn);

    if (primaryNav) {
        window.addEventListener('resize', function () {
            syncMobileNavMode();
            updateActiveNavPill();
        });
    }

    // ---- brand → landing page ----
    function goHome() {
        setActive(null);
        Router.go('/landing');
    }
    const brandEl = document.getElementById('brand-home');
    brandEl.addEventListener('click', goHome);
    brandEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            goHome();
        }
    });

    // ---- account dropdown menu ----
    const acctChip = document.getElementById('acct-chip');
    const acctDropdown = document.getElementById('acct-dropdown');

    function closeAcctMenu() {
        acctDropdown.classList.remove('open');
        acctChip.setAttribute('aria-expanded', 'false');
    }
    function toggleAcctMenu() {
        const open = acctDropdown.classList.toggle('open');
        acctChip.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    acctChip.addEventListener('click', function (e) {
        if (guest) {
            goSignIn();
            return;
        }
        e.stopPropagation();
        toggleAcctMenu();
    });
    document.addEventListener('click', function (e) {
        if (appNav && !e.target.closest('.app-nav'))
            setMobileNavOpen(false);
        if (!e.target.closest('#acct-menu'))
            closeAcctMenu();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            setMobileNavOpen(false);
            closeAcctMenu();
        }
    });

    document.getElementById('menu-logout').addEventListener('click', function () {
        closeAcctMenu();
        Utils.yesNo('Sign out', 'Are you sure you want to sign out?', function () {
            Server.logout();
        });
    });

    document.getElementById('menu-view-profile').addEventListener('click', function () {
        closeAcctMenu();
        const myHandle = Utils.getData('handle') || '';
        if (!myHandle)
            return;
        setActive(null, 'screens/Person/Person');
        Utils.saveData('personHandle', myHandle);
        Utils.saveData('personReturnTo', {
            page: 'screens/Dashboard/Dashboard',
            nav: 'repositories',
            data: {}
        });
        Router.go('/person');
    });

    // ---- edit profile (display name) ----
    const epErr = document.getElementById('ep-err');
    function showEpError(msg) {
        epErr.textContent = msg || '';
        epErr.classList.toggle('show', !!msg);
    }
    async function openEditProfile() {
        closeAcctMenu();
        showEpError('');
        $$('ep-name').clear();
        $$('ep-ok').enable();
        const res = await Server.call('services/AccountService', 'status', {});
        if (res._Success)
            $$('ep-name').setValue(res.fullName || '');
        Utils.popup_open('edit-profile-popup', 'ep-name');
    }
    $$('ep-cancel').onclick(() => Utils.popup_close());
    $$('ep-ok').onclick(async () => {
        const fullName = $$('ep-name').getValue().trim();
        if (fullName.length > 200) {
            showEpError('Your name must be 200 characters or fewer.');
            return;
        }
        showEpError('');
        $$('ep-ok').disable();
        const res = await Server.call('services/AccountService', 'updateProfile', {fullName: fullName});
        $$('ep-ok').enable();
        if (!res._Success)
            return;
        Utils.popup_close();
        Utils.toast.success('Profile saved');
        // Let the visible screen (e.g. the Person page showing your own profile)
        // refresh its display name without a reload.
        if (typeof window.svnhubProfileUpdated === 'function')
            window.svnhubProfileUpdated(res.fullName || fullName);
    });

    // ---- change password ----
    const cpwErr = document.getElementById('cpw-err');
    function showCpwError(msg) {
        cpwErr.textContent = msg || '';
        cpwErr.classList.toggle('show', !!msg);
    }
    function cpwAllFilled() {
        return $$('cpw-cur').getValue().length > 0 &&
               $$('cpw-new').getValue().length > 0 &&
               $$('cpw-confirm').getValue().length > 0;
    }
    function syncCpwEnabled() {
        $$('cpw-ok').enable(cpwAllFilled());
        if (cpwErr.classList.contains('show'))
            showCpwError('');
    }
    ['cpw-cur', 'cpw-new', 'cpw-confirm'].forEach(function (id) {
        $$(id).element.addEventListener('input', syncCpwEnabled);
    });
    document.getElementById('menu-change-pw').addEventListener('click', function () {
        closeAcctMenu();
        $$('cpw-cur').clear();
        $$('cpw-new').clear();
        $$('cpw-confirm').clear();
        showCpwError('');
        $$('cpw-ok').disable();
        Utils.popup_open('change-pw-popup', 'cpw-cur');
    });
    $$('cpw-cancel').onclick(() => Utils.popup_close());
    $$('cpw-ok').onclick(async () => {
        const next = $$('cpw-new').getValue();
        if (next.length < 6) {
            showCpwError('Your new password must be at least 6 characters.');
            return;
        }
        if (next !== $$('cpw-confirm').getValue()) {
            showCpwError('The new passwords do not match.');
            return;
        }
        showCpwError('');
        const res = await Server.call('services/AccountService', 'changePassword', {
            currentPassword: $$('cpw-cur').getValue(),
            newPassword: next
        });
        if (res._Success) {
            Utils.popup_close();
            Utils.toast.success('Password changed');
            await Utils.showMessage('Password changed',
                'Your password has been updated (web UI and svn). Please sign in again with your new password.');
            Server.logout();
        }
    });

    // ---- global topbar search ----
    const navSearchCtl = $$('nav-q');
    const navQ = document.getElementById('nav-q-input');
    const navResults = document.getElementById('nav-results');
    const navSearch = document.getElementById('nav-search');
    let navSearchRunner = null;
    let navDefaultRows = null;
    let navDefaultPromise = null;

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }
    function hideNavResults() {
        navResults.classList.remove('open');
        navResults.innerHTML = '';
    }
    function syncNavClear() {
        navSearch.classList.toggle('has-value', !!navSearchCtl.getValue().trim());
    }
    function clearNavSearch(fromControl = false) {
        navSearchRunner.cancel();
        if (!fromControl)
            navSearchCtl.clear();
        syncNavClear();
        hideNavResults();
    }
    function openRepoFromSearch(id, key, name) {
        hideNavResults();
        navSearchCtl.clear();
        syncNavClear();
        Utils.saveData('repoId', Number(id));
        Utils.saveData('repoKey', key);
        Utils.saveData('repoName', name);
        Utils.saveData('repoReturnTo', {
            page: 'screens/Discover/Discover',
            nav: 'discover',
            data: {}
        });
        setActive('discover');
        Router.go('/repository');
    }
    function openPersonFromSearch(handle) {
        hideNavResults();
        navSearchCtl.clear();
        syncNavClear();
        Utils.saveData('personHandle', handle);
        Utils.saveData('personReturnTo', {
            page: 'screens/Discover/Discover',
            nav: 'discover',
            data: {}
        });
        setActive('discover');
        Router.go('/person');
    }
    function searchRepoService() {
        return guest ? 'services/DiscoverService' : 'services/RepositoryService';
    }
    function searchRepoMethod() {
        return guest ? 'searchRepos' : 'searchRepositories';
    }
    function limitedRows(rows, limit) {
        return Array.isArray(rows) ? rows.slice(0, limit) : [];
    }
    function navRepoRow(r) {
        return '<button class="nav-result nav-result-repo" data-type="repo" data-id="' + esc(r.repoId) +
            '" data-key="' + esc(r.repoKey || '') + '" data-name="' + esc(r.name || '') + '">' +
                '<span class="nav-result-icon" aria-hidden="true">R</span>' +
                '<span class="nav-result-main">' +
                    '<span class="nav-result-name">' + esc(r.name || r.repoKey || 'Repository') + '</span>' +
                    '<span class="nav-result-path mono">' + esc(r.repoKey || '') + '</span>' +
                    (r.description ? '<span class="nav-result-desc">' + esc(r.description) + '</span>' : '') +
                '</span>' +
                (r.visibility ? '<span class="nav-result-badge">' + esc(r.visibility) + '</span>' : '') +
            '</button>';
    }
    function navPersonRow(u) {
        const display = u.fullName || u.handle || 'Person';
        return '<button class="nav-result nav-result-person" data-type="person" data-handle="' + esc(u.handle || '') + '">' +
                '<span class="nav-result-icon person" aria-hidden="true">' + esc((u.handle || display || '?').charAt(0).toUpperCase()) + '</span>' +
                '<span class="nav-result-main">' +
                    '<span class="nav-result-name">' + esc(display) + '</span>' +
                    '<span class="nav-result-path mono">@' + esc(u.handle || '') + '</span>' +
                '</span>' +
                '<span class="nav-result-badge">' + esc(u.publicRepoCount || 0) + ' repos</span>' +
            '</button>';
    }
    function renderNavGroups(groups, emptyText) {
        const visible = groups.filter((g) => g.rows && g.rows.length);
        if (!visible.length) {
            navResults.innerHTML = '<div class="nav-result-empty">' + esc(emptyText) + '</div>';
            navResults.classList.add('open');
            return;
        }
        navResults.innerHTML = visible.map((g) =>
            '<section class="nav-result-section">' +
                '<div class="nav-result-kicker">' +
                    '<span>' + esc(g.label) + '</span>' +
                    '<span class="nav-result-count">' + esc(g.total == null ? g.rows.length : g.total) + '</span>' +
                '</div>' +
                g.rows.map(g.render).join('') +
            '</section>').join('');
        navResults.classList.add('open');
    }
    function defaultNavLabel() {
        return guest ? 'Public repositories' : 'Your repositories';
    }
    function loadDefaultNavRows() {
        if (!navDefaultPromise) {
            navDefaultPromise = (guest
                ? Server.callQuiet('services/DiscoverService', 'searchRepos', {query: '', page: 0, pageSize: 12})
                : Server.callQuiet('services/RepositoryService', 'getRepositories'))
                .then((res) => {
                    navDefaultRows = (res._Success && res.rows) ? limitedRows(res.rows, 12) : [];
                    return navDefaultRows;
                })
                .finally(() => {
                    navDefaultPromise = null;
                });
        }
        return navDefaultPromise;
    }
    async function showDefaultNavResults() {
        const q = navSearchCtl.getValue().trim();
        if (q) {
            runNavSearch();
            return;
        }
        if (navDefaultRows) {
            if (navDefaultRows.length)
                renderNavGroups([{label: defaultNavLabel(), rows: navDefaultRows, render: navRepoRow}], '');
            else
                hideNavResults();
            return;
        }
        const token = navSearchRunner.cancel();
        hideNavResults();
        const rows = await loadDefaultNavRows();
        if (!navSearchRunner.isCurrent(token) || navSearchCtl.getValue().trim() || document.activeElement !== navQ)
            return;
        if (rows.length)
            renderNavGroups([{label: defaultNavLabel(), rows: rows, render: navRepoRow}], '');
        else
            hideNavResults();
    }
    async function runNavSearch(token) {
        if (token == null)
            token = navSearchRunner.cancel();
        const q = navSearchCtl.getValue().trim();
        if (!q) {
            showDefaultNavResults();
            return;
        }
        hideNavResults();
        const [repoRes, peopleRes] = await Promise.all([
            Server.callQuiet(searchRepoService(), searchRepoMethod(), {query: q, page: 0, pageSize: 6}),
            Server.callQuiet('services/DiscoverService', 'searchUsers', {query: q, page: 0, pageSize: 6})
        ]);
        if (!navSearchRunner.isCurrent(token) || navSearchCtl.getValue().trim() !== q || document.activeElement !== navQ)
            return;
        renderNavGroups([
            {
                label: 'Repositories',
                rows: (repoRes._Success && repoRes.rows) ? limitedRows(repoRes.rows, 6) : [],
                total: repoRes._Success ? repoRes.total : null,
                render: navRepoRow
            },
            {
                label: 'People',
                rows: (peopleRes._Success && peopleRes.rows) ? limitedRows(peopleRes.rows, 6) : [],
                total: peopleRes._Success ? peopleRes.total : null,
                render: navPersonRow
            }
        ], 'No results match "' + q + '".');
    }
    navSearchRunner = SvnHubUI.createDebouncedRunner(runNavSearch, 200);
    navSearchCtl.onInput(function () {
        syncNavClear();
        if (!navSearchCtl.getValue().trim()) {
            showDefaultNavResults();
            return;
        }
        navSearchRunner.schedule();
    });
    navSearchCtl.onClear(() => clearNavSearch(true));
    navQ.addEventListener('focus', showDefaultNavResults);
    navQ.addEventListener('click', showDefaultNavResults);
    navSearchCtl.onSearch(function () {
        const q = navSearchCtl.getValue().trim();
        if (!q) {
            hideNavResults();
            return;
        }
        Utils.saveData('discoverQuery', q);
        Utils.saveData('discoverFilter', 'all');
        navSearchCtl.clear();
        syncNavClear();
        navQ.blur();
        hideNavResults();
        route('discover', 'screens/Discover/Discover');
    });
    navQ.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            hideNavResults();
            navQ.blur();
        }
    });
    function openNavResult(btn) {
        if (btn.getAttribute('data-type') === 'person')
            openPersonFromSearch(btn.getAttribute('data-handle'));
        else
            openRepoFromSearch(btn.getAttribute('data-id'), btn.getAttribute('data-key'), btn.getAttribute('data-name'));
    }
    navResults.addEventListener('mousedown', function (e) {
        const btn = e.target.closest('.nav-result');
        if (btn) {
            e.preventDefault();
            openNavResult(btn);
        }
    });
    navQ.addEventListener('blur', function () {
        navSearchRunner.cancel();
        setTimeout(hideNavResults, 150);
    });
    syncNavClear();

    const handle = Utils.getData('handle') || '';
    $$('acct-name').setValue(handle);
    const initials = handle ? handle.substring(0, 2).toUpperCase() : 'SV';
    document.getElementById('acct-avatar').textContent = initials;

    if (guest) {
        $$('repositories').hide();
        $$('insights').hide();
        $$('users').hide();
        document.getElementById('acct-menu').style.display = 'none';
        $$('signin').show();
        document.getElementById('acct-avatar').textContent = 'SV';
    } else {
        $$('signin').hide();
        if (!isAdmin) {
            $$('users').hide();
        } else {
            $$('users').show();
        }
    }

    //  When the shell route itself is the destination ('#/'), show the default
    //  sub-screen.  When the Router is loading a specific sub-screen (e.g. '#/repository'),
    //  it fills the content region itself, so don't load anything here.  Each sub-screen
    //  sets its own nav pill via Utils.setAppNavActive on load.
    if (Router.current() === '/') {
        if (guest)
            Utils.loadPage('screens/Landing/Landing', screenArea);   // public intro (Explore / Sign Up)
        else
            Utils.loadPage('screens/Dashboard/Dashboard', screenArea);
    }

})();
