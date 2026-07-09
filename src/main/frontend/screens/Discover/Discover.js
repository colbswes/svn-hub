/* global $$, Utils, Server, SvnHubUI */
'use strict';

(async function () {

    const WS = 'services/DiscoverService';
    const REPO_PAGE_SIZE = 48;
    const PEOPLE_PAGE_SIZE = 48;

    const guest = Utils.getData('guest') === true;
    let allRepos = [];
    let allPeople = [];
    let repoTotal = 0;
    let peopleTotal = 0;
    let repoPage = 0;
    let peoplePage = 0;
    let filter = 'all'; // all | repos | people
    let repoTerm = '';
    let peopleTerm = '';
    let repoServerSearchActive = false;
    let searchRunner = null;
    let hasSearched = false;
    let browseMode = false;

    const searchPlaceholders = {
        all: 'Search repositories and people by name, description, or key',
        repos: 'Search repositories by name, description, or key',
        people: 'Search people by name or username'
    };

    const exploreOrigin = {
        page: 'screens/Discover/Discover',
        nav: 'discover',
        data: {}
    };

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function plural(n, one, many) {
        return n + ' ' + (n === 1 ? one : many);
    }

    function repoCard(r) {
        return SvnHubUI.repoCard(r);
    }

    function personCard(u) {
        const handle = u.handle || '';
        const name = u.fullName || handle || 'Person';
        const count = Number(u.publicRepoCount || 0);
        return '<button class="person-card" data-handle="' + esc(handle) + '">' +
            '<span class="person-card-avatar" aria-hidden="true">' + esc((handle || name || '?').charAt(0).toUpperCase()) + '</span>' +
            '<span class="person-card-main">' +
                '<span class="person-card-name">' + esc(name) + '</span>' +
                '<span class="person-card-handle mono">@' + esc(handle) + '</span>' +
            '</span>' +
            '<span class="person-card-meta">' +
                '<span class="person-card-count mono">' + esc(count) + '</span>' +
                '<span>' + esc(count === 1 ? 'public repo' : 'public repos') + '</span>' +
            '</span>' +
        '</button>';
    }

    function syncSearchClear() {
        const ctl = $$('disc-search');
        const shell = ctl && ctl.element ? ctl.element.closest('.discover-search') : null;
        if (shell)
            shell.classList.toggle('has-value', !!ctl.getValue().trim());
    }

    function syncSearchPlaceholder() {
        const ctl = $$('disc-search');
        if (ctl && ctl.setPlaceholder)
            ctl.setPlaceholder(searchPlaceholders[filter] || searchPlaceholders.all);
    }

    function applyRepoSort(rows) {
        let out = rows.slice();
        if (repoTerm) {
            const q = repoTerm.toLowerCase();
            out = out.filter((r) =>
                (r.name || '').toLowerCase().includes(q) ||
                (r.description || '').toLowerCase().includes(q) ||
                (r.repoKey || '').toLowerCase().includes(q));
        }
        return out;
    }

    function applyPeopleSort(rows) {
        return rows.slice();
    }

    function resultCount(shown, total, one, many) {
        if (total > shown)
            return shown + ' of ' + plural(total, one, many);
        return plural(shown, one, many);
    }

    function loadMoreButton(kind, shown, total, label) {
        if (shown >= total)
            return '';
        return '<button type="button" class="discover-load-more" data-load-more="' + esc(kind) + '">' +
            '<span>Load more ' + esc(label) + '</span>' +
            '<span>Showing ' + esc(shown) + ' of ' + esc(total) + '</span>' +
        '</button>';
    }

    function renderRepos() {
        if (!hasSearched && !browseMode)
            return 0;

        const showRepos = filter === 'all' || filter === 'repos';
        const hostPanel = document.getElementById('repos-panel');
        const host = document.getElementById('repo-results');
        const term = repoTerm;

        if (!showRepos) {
            hostPanel.hidden = true;
            return 0;
        }

        const rows = applyRepoSort(allRepos);

        document.getElementById('result-title').textContent = browseMode ? 'Browse repositories' : 'Repositories';
        $$('result-sub').setValue(term
            ? 'Results for "' + esc(term) + '" across repositories'
            : (browseMode
                ? 'Currently showing most active repositories'
                : 'Public and accessible Subversion repositories'));
        $$('repos-count').setValue(resultCount(rows.length, repoTotal || rows.length, 'repo', 'repos'));

        hostPanel.hidden = rows.length === 0;
        if (!rows.length) {
            host.innerHTML = '';
            return 0;
        }

        host.innerHTML = rows.map(repoCard).join('') +
            (repoServerSearchActive ? loadMoreButton('repos', allRepos.length, repoTotal, 'repositories') : '');
        return rows.length;
    }

    function renderPeople() {
        if (!hasSearched && !browseMode)
            return 0;

        const showPeople = filter === 'all' || filter === 'people';
        const hostPanel = document.getElementById('people-panel');
        const host = document.getElementById('people-results');
        const term = peopleTerm;

        if (!showPeople) {
            hostPanel.hidden = true;
            return 0;
        }

        const rows = applyPeopleSort(allPeople);

        document.getElementById('people-title').textContent = 'People';
        document.getElementById('people-subtitle').textContent = term
            ? 'People matching "' + term + '"'
            : 'Find other people using Subversion.';
        $$('people-count').setValue(resultCount(rows.length, peopleTotal || rows.length, 'person', 'people'));

        hostPanel.hidden = rows.length === 0;
        if (!rows.length) {
            host.innerHTML = '';
            return 0;
        }

        host.innerHTML = rows.map(personCard).join('') +
            (hasSearched ? loadMoreButton('people', allPeople.length, peopleTotal, 'people') : '');
        return rows.length;
    }

    function syncDiscoverEmpty(repoCount, peopleCount) {
        const placeholder = document.getElementById('discover-empty');
        if (!placeholder)
            return;

        if (!hasSearched && !browseMode) {
            placeholder.hidden = false;
            placeholder.querySelector('h2').textContent = 'Search across svn·hub';
            placeholder.querySelector('p').textContent = 'Search for repositories or people to see matching results.';
            return;
        }

        const showRepos = filter === 'all' || filter === 'repos';
        const showPeople = filter === 'all' || filter === 'people';
        const anyVisible = (showRepos && repoCount > 0) || (showPeople && peopleCount > 0);

        placeholder.hidden = anyVisible;
        if (!anyVisible) {
            if (browseMode && filter === 'people') {
                placeholder.querySelector('h2').textContent = 'Find other people using Subversion';
                placeholder.querySelector('p').textContent = 'Search by name or username to see who else is here.';
                return;
            }
            if (browseMode) {
                placeholder.querySelector('h2').textContent = 'Nothing to browse yet';
                placeholder.querySelector('p').textContent = 'No repositories are visible to you yet. Try a search, or check back later.';
                return;
            }
            const q = repoTerm || peopleTerm;
            placeholder.querySelector('h2').textContent = 'No results';
            placeholder.querySelector('p').textContent = q
                ? 'Nothing matched "' + q + '". Try a different search.'
                : 'Try a different search or filter.';
        }
    }

    function renderAll() {
        if (!document.getElementById('discover-empty'))
            return;

        if (!hasSearched && !browseMode) {
            document.getElementById('repos-panel').hidden = true;
            document.getElementById('people-panel').hidden = true;
            syncDiscoverEmpty(0, 0);
            return;
        }

        const repoCount = renderRepos();
        const peopleCount = renderPeople();
        syncDiscoverEmpty(repoCount, peopleCount);
    }

    function expandVisibleResultSections() {
        document.querySelectorAll('.discover-result-section').forEach((section) => {
            if (section.hidden)
                return;
            const btn = section.querySelector('.discover-result-head');
            const body = section.querySelector('.ins-section-body');
            section.classList.remove('collapsed', 'animating');
            if (btn)
                btn.setAttribute('aria-expanded', 'true');
            if (body) {
                body.inert = false;
                body.style.height = '';
            }
        });
    }

    function initDiscoverSections() {
        SvnHubUI.initExpandableSections({
            sectionSelector: '.discover-result-section',
            headSelector: '.discover-result-head',
            bodySelector: '.ins-section-body'
        });
    }

    function syncUrlQuery(q) {
        const url = new URL(location.href);
        if (q)
            url.searchParams.set('q', q);
        else
            url.searchParams.delete('q');
        const next = url.pathname + url.search + url.hash;
        if (next !== location.pathname + location.search + location.hash)
            history.replaceState(history.state, document.title, next);
    }

    async function runSearch(token = null) {
        const q = $$('disc-search').getValue().trim();
        if (!q) {
            clearSearch();
            return;
        }
        if (token == null)
            token = searchRunner.cancel();
        repoTerm = q;
        peopleTerm = q;
        syncSearchClear();
        syncUrlQuery(q);

        repoPage = 0;
        peoplePage = 0;
        repoTotal = 0;
        peopleTotal = 0;

        const [repoRows, peopleRows] = await Promise.all([
            Server.callQuiet(WS, 'searchRepos', {query: q, page: repoPage, pageSize: REPO_PAGE_SIZE}),
            Server.callQuiet(WS, 'searchUsers', {query: q, page: peoplePage, pageSize: PEOPLE_PAGE_SIZE})
        ]);

        if (!searchRunner.isCurrent(token))
            return;

        allRepos = (repoRows._Success && repoRows.rows) ? repoRows.rows : [];
        allPeople = (peopleRows._Success && peopleRows.rows) ? peopleRows.rows : [];
        repoTotal = repoRows._Success ? Number(repoRows.total || allRepos.length) : allRepos.length;
        peopleTotal = peopleRows._Success ? Number(peopleRows.total || allPeople.length) : allPeople.length;
        repoServerSearchActive = !!q;
        hasSearched = true;
        browseMode = false;

        renderAll();
        expandVisibleResultSections();
    }

    // Default "Browse" listing when there is no query. Signed-in users get owned
    // + granted + public repos; guests get the public search listing.
    async function loadBrowse() {
        const token = searchRunner.cancel();
        const res = guest
            ? await Server.callQuiet(WS, 'searchRepos', {query: '', page: 0, pageSize: REPO_PAGE_SIZE})
            : await Server.callQuiet('services/RepositoryService', 'searchRepositories', {query: ''});
        if (!searchRunner.isCurrent(token))
            return;
        const rows = (res._Success && res.rows) ? res.rows.slice() : [];
        rows.sort((a, b) =>
            (Number(b.headRevisionTs || b.createdTs || 0)) - (Number(a.headRevisionTs || a.createdTs || 0)));
        allRepos = rows;
        allPeople = [];
        repoTotal = res._Success ? Number(res.total || rows.length) : rows.length;
        peopleTotal = 0;
        repoPage = 0;
        peoplePage = 0;
        repoTerm = '';
        peopleTerm = '';
        repoServerSearchActive = false;
        hasSearched = false;
        browseMode = true;
        renderAll();
    }

    async function loadMore(kind) {
        const q = $$('disc-search').getValue().trim();
        if (!q || !hasSearched)
            return;
        const token = searchRunner.cancel();
        if (kind === 'repos') {
            const nextPage = repoPage + 1;
            const res = await Server.callQuiet(WS, 'searchRepos', {
                query: q,
                page: nextPage,
                pageSize: REPO_PAGE_SIZE
            });
            if (!searchRunner.isCurrent(token))
                return;
            if (res._Success) {
                repoPage = nextPage;
                allRepos = allRepos.concat(res.rows || []);
                repoTotal = Number(res.total || allRepos.length);
                renderAll();
            }
            return;
        }
        if (kind === 'people') {
            const nextPage = peoplePage + 1;
            const res = await Server.callQuiet(WS, 'searchUsers', {
                query: q,
                page: nextPage,
                pageSize: PEOPLE_PAGE_SIZE
            });
            if (!searchRunner.isCurrent(token))
                return;
            if (res._Success) {
                peoplePage = nextPage;
                allPeople = allPeople.concat(res.rows || []);
                peopleTotal = Number(res.total || allPeople.length);
                renderAll();
            }
        }
    }

    async function clearSearch(fromControl = false) {
        searchRunner.cancel();
        if (!fromControl)
            $$('disc-search').clear();
        repoTerm = '';
        peopleTerm = '';
        syncSearchClear();
        hasSearched = false;
        syncUrlQuery('');
        await loadBrowse();
    }

    function setFilter(mode) {
        filter = mode;
        [['all', 'filter-all'], ['repos', 'filter-repos'], ['people', 'filter-people']]
            .forEach((p) => {
                const el = $$(p[1]).element;
                const on = p[0] === filter;
                el.classList.toggle('active', on);
                el.setAttribute('aria-selected', on ? 'true' : 'false');
            });
        const list = document.getElementById('filter-list');
        if (list)
            list.setAttribute('data-filter', filter);
        syncSearchPlaceholder();
        if (repoServerSearchActive)
            Utils.saveData('discoverFilter', filter);
        renderAll();
    }

    function repoFromCard(card) {
        return {
            repoId: card.getAttribute('data-repo-id'),
            repoKey: card.getAttribute('data-repo-key'),
            name: card.getAttribute('data-repo-name')
        };
    }

    $$('filter-all').onclick(() => setFilter('all'));
    $$('filter-repos').onclick(() => setFilter('repos'));
    $$('filter-people').onclick(() => setFilter('people'));

    searchRunner = SvnHubUI.createDebouncedRunner(runSearch, 220);
    $$('disc-search').onSearch(() => searchRunner.runNow());
    $$('disc-search').onClear(() => clearSearch(true));
    $$('disc-search').element.addEventListener('input', () => {
        searchRunner.cancel();
        syncSearchClear();
    });

    document.getElementById('repo-results').addEventListener('click', (e) => {
        const more = e.target.closest('[data-load-more="repos"]');
        if (more) {
            loadMore('repos');
            return;
        }
        const owner = e.target.closest('.repo-owner-link');
        if (owner) {
            e.stopPropagation();
            SvnHubUI.openPerson(owner.getAttribute('data-person-handle'), exploreOrigin);
            return;
        }
        const card = e.target.closest('.repo-card');
        if (card)
            SvnHubUI.openRepo(repoFromCard(card), exploreOrigin);
    });
    document.getElementById('repo-results').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const card = e.target.closest('.repo-card');
        if (card)
            SvnHubUI.openRepo(repoFromCard(card), exploreOrigin);
    });
    document.getElementById('people-results').addEventListener('click', (e) => {
        const more = e.target.closest('[data-load-more="people"]');
        if (more) {
            loadMore('people');
            return;
        }
        const card = e.target.closest('.person-card');
        if (card)
            SvnHubUI.openPerson(card.getAttribute('data-handle'), exploreOrigin);
    });

    initDiscoverSections();

    if (Utils.setAppNavActive)
        Utils.setAppNavActive('discover', 'screens/Discover/Discover');

    const pendingFilter = Utils.getAndEraseData('discoverFilter');
    const urlQuery = (new URLSearchParams(location.search || '').get('q') || '').trim();
    const dataQuery = (Utils.getAndEraseData('discoverQuery') || '').trim();
    const pendingQuery = urlQuery || dataQuery;
    if (pendingFilter === 'repos' || pendingFilter === 'people' || pendingFilter === 'all')
        filter = pendingFilter;
    setFilter(filter);
    if (pendingQuery)
        $$('disc-search').setValue(pendingQuery);
    syncSearchClear();
    if (pendingQuery) {
        await runSearch();
    } else {
        await loadBrowse();
    }

})();
