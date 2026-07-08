/* global $$, Utils, Server */

'use strict';

(async function () {

    const screenArea = 'app-screen-area';
    const navIds = ['repositories', 'discover', 'insights', 'users', 'help'];
    const guest = Utils.getData('guest') === true;
    const isAdmin = Utils.getData('isAdmin') === true;
    const primaryNav = document.getElementById('primary-nav');
    let activeNavId = null;

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
        if (ok)
            primaryNav.classList.add('nav-ready');
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
    }

    Utils.setAppNavActive = setActive;

    function route(id, page) {
        setActive(id, page);
        Utils.routePage(page, screenArea);
    }

    function goSignIn() {
        Server.clearUUID();
        Utils.saveData('guest', false);
        history.replaceState(null, document.title, location.pathname);
        location.reload();
    }

    function targetNav(target, fallback) {
        if (target && Object.prototype.hasOwnProperty.call(target, 'nav'))
            return target.nav;
        return fallback;
    }

    function activeForPage(page, routeState) {
        const data = (routeState && routeState.data) || {};
        if (page === 'screens/Landing/Landing')
            return null;
        if (page === 'screens/Discover/Discover')
            return 'discover';
        if (page === 'screens/Person/Person') {
            const personHandle = String(data.personHandle || Utils.getData('personHandle') || '').toLowerCase();
            const myHandle = String(Utils.getData('handle') || '').toLowerCase();
            if (!guest && personHandle && myHandle && personHandle === myHandle)
                return null;
            return targetNav(data.personReturnTo, 'discover');
        }
        if (page === 'screens/Repository/Repository')
            return targetNav(data.repoReturnTo, guest ? 'discover' : 'repositories');
        if (page === 'screens/Insights/Insights')
            return 'insights';
        if (page === 'screens/Users/Users')
            return 'users';
        if (page === 'screens/Help/Help' || page === 'screens/AboutSubversion/AboutSubversion')
            return 'help';
        return 'repositories';
    }

    function restoreInitialPage() {
        const routeState = Utils.getAndEraseData('restoreAppRoute');
        if (routeState && routeState.page) {
            if (routeState.page === 'screens/Users/Users' && !isAdmin) {
                setActive('repositories');
                return Utils.replacePage('screens/Dashboard/Dashboard', screenArea);
            }
            if (routeState.data) {
                for (const key of Object.keys(routeState.data))
                    Utils.saveData(key, routeState.data[key]);
            }
            setActive(activeForPage(routeState.page, routeState), routeState.page);
            return Utils.replacePage(routeState.page, screenArea, routeState.initialFocus, routeState.argv);
        }
        setActive('repositories');
        return Utils.replacePage('screens/Dashboard/Dashboard', screenArea);
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
            updateActiveNavPill();
        });
    }

    // ---- brand → landing page ----
    function goHome() {
        setActive(null);
        Utils.routePage('screens/Landing/Landing', screenArea);
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
        if (!e.target.closest('#acct-menu'))
            closeAcctMenu();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape')
            closeAcctMenu();
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
        Utils.routePage('screens/Person/Person', screenArea);
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
    const navQ = document.getElementById('nav-q');
    const navQClear = document.getElementById('nav-q-clear');
    const navResults = document.getElementById('nav-results');
    const navSearch = document.getElementById('nav-search');
    let navSearchTimer = null;
    let navSearchToken = 0;
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
        navSearch.classList.toggle('has-value', !!navQ.value.trim());
    }
    function clearNavSearch() {
        clearTimeout(navSearchTimer);
        navSearchToken++;
        navQ.value = '';
        syncNavClear();
        hideNavResults();
    }
    function openRepoFromSearch(id, key, name) {
        hideNavResults();
        navQ.value = '';
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
        Utils.routePage('screens/Repository/Repository', screenArea);
    }
    function openPersonFromSearch(handle) {
        hideNavResults();
        navQ.value = '';
        syncNavClear();
        Utils.saveData('personHandle', handle);
        Utils.saveData('personReturnTo', {
            page: 'screens/Discover/Discover',
            nav: 'discover',
            data: {}
        });
        setActive('discover');
        Utils.routePage('screens/Person/Person', screenArea);
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
    function defaultNavEmptyText() {
        return guest ? 'No public repositories yet.' : 'You do not own any repositories yet.';
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
        const q = navQ.value.trim();
        if (q) {
            runNavSearch();
            return;
        }
        if (navDefaultRows) {
            renderNavGroups([{label: defaultNavLabel(), rows: navDefaultRows, render: navRepoRow}], defaultNavEmptyText());
            return;
        }
        const token = ++navSearchToken;
        hideNavResults();
        const rows = await loadDefaultNavRows();
        if (token !== navSearchToken || navQ.value.trim() || document.activeElement !== navQ)
            return;
        renderNavGroups([{label: defaultNavLabel(), rows: rows, render: navRepoRow}], defaultNavEmptyText());
    }
    async function runNavSearch() {
        const token = ++navSearchToken;
        const q = navQ.value.trim();
        if (!q) {
            showDefaultNavResults();
            return;
        }
        hideNavResults();
        const [repoRes, peopleRes] = await Promise.all([
            Server.callQuiet(searchRepoService(), searchRepoMethod(), {query: q, page: 0, pageSize: 6}),
            Server.callQuiet('services/DiscoverService', 'searchUsers', {query: q, page: 0, pageSize: 6})
        ]);
        if (token !== navSearchToken || navQ.value.trim() !== q || document.activeElement !== navQ)
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
    navQ.addEventListener('input', function () {
        syncNavClear();
        clearTimeout(navSearchTimer);
        if (!navQ.value.trim()) {
            showDefaultNavResults();
            return;
        }
        navSearchTimer = setTimeout(runNavSearch, 200);
    });
    navQClear.addEventListener('mousedown', function (e) {
        e.preventDefault();
    });
    navQClear.addEventListener('click', clearNavSearch);
    navQ.addEventListener('focus', showDefaultNavResults);
    navQ.addEventListener('click', showDefaultNavResults);
    navQ.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = navQ.value.trim();
            if (!q) {
                hideNavResults();
                return;
            }
            Utils.saveData('discoverQuery', q);
            Utils.saveData('discoverFilter', 'all');
            navQ.value = '';
            syncNavClear();
            navQ.blur();
            hideNavResults();
            route('discover', 'screens/Discover/Discover');
        } else if (e.key === 'Escape') {
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
        navSearchToken++;
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

    restoreInitialPage();

})();
