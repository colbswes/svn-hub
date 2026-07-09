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
    let selectedPersonHandle = '';
    // Per-handle cache of getPersonDetail responses so re-selecting a person is
    // instant. Value is either the detail object, or the string 'loading'.
    const personDetailCache = {};
    let detailRequestToken = 0;
    const DETAIL_ACTIVITY_LIMIT = 4;

    const searchPlaceholders = {
        all: 'Search repositories and people by name, description, or key',
        repos: 'Search repositories by name, description, or key',
        people: 'Search people by name or username'
    };
    const masterDetailQuery = window.matchMedia ? window.matchMedia('(min-width: 961px)') : null;

    // Build a "return to Explore" target that restores the current filter and
    // search term, so hitting Back on a profile/repo lands the user back where
    // they were (for example, still on the People tab with their query).
    function exploreOrigin() {
        const data = {discoverFilter: filter};
        const q = ($$('disc-search').getValue() || '').trim();
        if (q)
            data.discoverQuery = q;
        return {
            page: 'screens/Discover/Discover',
            nav: 'discover',
            data: data
        };
    }

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
        const selected = showPeopleMasterDetail() && handle && handle === selectedPersonHandle;
        return '<button class="person-card' + (selected ? ' selected' : '') + '" data-handle="' + esc(handle) +
            '"' + (selected ? ' aria-pressed="true"' : '') + '>' +
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

    function showPeopleMasterDetail() {
        return filter === 'people' && (!masterDetailQuery || masterDetailQuery.matches);
    }

    function selectedPerson(rows) {
        if (!selectedPersonHandle)
            return null;
        const person = rows.find((u) => (u.handle || '') === selectedPersonHandle) || null;
        if (!person)
            selectedPersonHandle = '';
        return person;
    }

    // Kick off (or reuse a cached) getPersonDetail load for a handle. Re-renders
    // the panel when the response lands, but only if this handle is still the
    // selected one (guards against rapid selection changes).
    function fetchPersonDetail(handle) {
        if (!handle || personDetailCache[handle])
            return;
        personDetailCache[handle] = 'loading';
        const token = ++detailRequestToken;
        Server.callQuiet(WS, 'getPersonDetail',
            {handle: handle, page: 0, pageSize: 6, activityLimit: DETAIL_ACTIVITY_LIMIT})
            .then((res) => {
                personDetailCache[handle] = (res && res._Success) ? res : {_error: true};
                if (token === detailRequestToken && selectedPersonHandle === handle)
                    renderAll();
            })
            .catch(() => {
                personDetailCache[handle] = {_error: true};
                if (token === detailRequestToken && selectedPersonHandle === handle)
                    renderAll();
            });
    }

    function fmtDate(ms) {
        return SvnHubUI.fmtDate(ms);
    }

    // The header block (avatar / name / handle / member-since / view profile).
    function detailHead(handle, name, profile) {
        const initials = SvnHubUI.personInitials(name || handle);
        const since = profile && profile.memberSince
            ? 'Member since ' + esc(fmtDate(profile.memberSince))
            : 'Member profile';
        return '<div class="people-detail-head">' +
            '<div class="people-detail-avatar" aria-hidden="true">' + esc(initials) + '</div>' +
            '<div class="people-detail-copy">' +
                '<h2>' + esc(name) + '</h2>' +
                '<div class="people-detail-handle mono">@' + esc(handle) + '</div>' +
                '<div class="people-detail-since">' + since + '</div>' +
            '</div>' +
            '<button type="button" class="people-detail-open" data-open-selected-person="' + esc(handle) + '">View profile &rarr;</button>' +
        '</div>';
    }

    // A three-up stat strip using the shared profile-stat block styling.
    function detailStats(stats, fallbackCount) {
        const repoCount = Number((stats && stats.visibleRepoCount) || fallbackCount || 0);
        const revisions = Number((stats && stats.visibleRevisionCount) || 0);
        const commits = Number((stats && stats.commitCount) || 0);
        return '<div class="people-detail-statgrid">' +
            SvnHubUI.statBlock(repoCount, repoCount === 1 ? 'repository' : 'repositories') +
            SvnHubUI.statBlock(revisions, revisions === 1 ? 'revision' : 'revisions') +
            SvnHubUI.statBlock(commits, commits === 1 ? 'commit' : 'commits') +
        '</div>';
    }

    // Recent commit activity list (compact). rows: activity[] from getPersonDetail.
    function detailActivity(rows) {
        rows = rows || [];
        if (!rows.length)
            return '';
        const items = rows.slice(0, DETAIL_ACTIVITY_LIMIT).map((r) => {
            const label = r.repoName || r.repoKey || 'repository';
            const when = r.commitTs
                ? '<span class="people-act-when" title="' + esc(fmtDate(r.commitTs)) + '">' + esc(SvnHubUI.relTime(r.commitTs)) + '</span>'
                : '';
            const msg = (r.message || '').split('\n')[0].trim() || '(no message)';
            return '<li class="people-act" tabindex="0" data-repo-id="' + esc(r.repoId) +
                '" data-repo-key="' + esc(r.repoKey || '') + '" data-repo-name="' + esc(r.repoName || '') +
                '" data-rev="' + esc(r.revision || 0) + '">' +
                '<span class="people-act-rev mono">r' + esc(r.revision || 0) + '</span>' +
                '<span class="people-act-body">' +
                    '<span class="people-act-msg">' + esc(msg) + '</span>' +
                    '<span class="people-act-meta"><span class="people-act-repo">' + esc(label) + '</span>' + when + '</span>' +
                '</span>' +
            '</li>';
        }).join('');
        return '<section class="people-detail-block">' +
            '<h3 class="people-detail-block-title">Recent activity</h3>' +
            '<ul class="people-act-list">' + items + '</ul>' +
        '</section>';
    }

    // The body shown once a person's detail has loaded (or while still loading,
    // using whatever the search row already told us).
    function detailBody(person) {
        const handle = person.handle || '';
        const name = person.fullName || handle || 'Person';
        const fallbackCount = Number(person.publicRepoCount || 0);
        const cached = personDetailCache[handle];

        // Trigger the detail load lazily on first render for this handle.
        if (!cached)
            fetchPersonDetail(handle);

        const detail = (cached && cached !== 'loading' && !cached._error) ? cached : null;
        const profile = detail ? (detail.profile || {}) : {};
        const stats = detail ? (detail.stats || {}) : null;
        const displayName = profile.fullName || name;

        let html = detailHead(handle, displayName, profile);
        html += detailStats(stats, fallbackCount);

        if (cached === 'loading' || !cached) {
            html += '<div class="people-detail-loading">' + SvnHubUI.spinner('Loading profile…') + '</div>';
            return html;
        }

        if (cached._error) {
            html += '<p class="people-detail-note">Couldn\u2019t load this profile right now. Open it to try again.</p>';
            return html;
        }

        const weekly = detail.weeklyActivity || [];
        const topRepos = detail.topRepos || [];
        const activity = detail.activity || [];
        let hasContent = false;

        const sparkHtml = SvnHubUI.weeklySpark(weekly);
        if (sparkHtml) {
            hasContent = true;
            html += '<section class="people-detail-block">' +
                '<h3 class="people-detail-block-title">Commit activity <span class="people-detail-block-note">last 26 weeks</span></h3>' +
                sparkHtml +
            '</section>';
        }

        if (topRepos.length) {
            hasContent = true;
            html += '<section class="people-detail-block">' +
                '<h3 class="people-detail-block-title">Most active in</h3>' +
                SvnHubUI.topReposList(topRepos.slice(0, 4)) +
            '</section>';
        }

        const activityHtml = detailActivity(activity);
        if (activityHtml) {
            hasContent = true;
            html += activityHtml;
        }

        if (!hasContent) {
            html += '<p class="people-detail-note">' + esc(profile.viewerCanSeePrivate
                ? 'No visible repositories or commit activity yet.'
                : 'No public repositories or commit activity yet.') + '</p>';
        }
        return html;
    }

    // Re-trigger the enter animation on an element by removing the class,
    // forcing a reflow, then re-adding it. Transform/opacity only — no layout.
    function replayAnim(el, cls) {
        if (!el)
            return;
        el.classList.remove(cls);
        // eslint-disable-next-line no-unused-expressions
        void el.offsetWidth;
        el.classList.add(cls);
    }

    // Track what the detail panel last showed so we only animate on a real
    // change of selection/state, not on every incidental re-render (search
    // keystrokes, viewport changes, etc.).
    let lastDetailKey = null;

    function renderPeopleDetail(rows) {
        const panel = document.getElementById('people-detail');
        if (!panel)
            return;
        if (!showPeopleMasterDetail() || !rows.length) {
            panel.hidden = true;
            panel.classList.remove('is-empty');
            panel.innerHTML = '';
            lastDetailKey = null;
            return;
        }

        const person = selectedPerson(rows);
        if (!person) {
            const key = 'empty';
            panel.hidden = false;
            panel.classList.add('is-empty');
            panel.innerHTML =
                '<div class="people-detail-empty-icon" aria-hidden="true">@</div>' +
                '<div class="people-detail-copy">' +
                    '<h2>Select someone</h2>' +
                    '<div class="people-detail-handle">Choose a person from the list to see their repositories and activity.</div>' +
                '</div>';
            if (key !== lastDetailKey)
                replayAnim(panel, 'is-entering');
            lastDetailKey = key;
            return;
        }

        const handle = person.handle || '';
        const cached = personDetailCache[handle];
        // Distinguish the loading vs loaded render for the same person so the
        // content fades in once when the real detail arrives, too.
        const key = 'p:' + handle + ':' + (cached && cached !== 'loading' ? 'full' : 'lite');
        panel.hidden = false;
        panel.classList.remove('is-empty');
        panel.innerHTML = detailBody(person);
        if (key !== lastDetailKey)
            replayAnim(panel, 'is-entering');
        lastDetailKey = key;
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

    function syncResultHeader(panel) {
        const head = panel.querySelector('.discover-result-head');
        const filtered = filter !== 'all';
        panel.classList.toggle('is-filtered', filtered);
        if (head)
            head.hidden = filtered;
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
        syncResultHeader(hostPanel);

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
            renderPeopleDetail([]);
            return 0;
        }
        syncResultHeader(hostPanel);

        const rows = applyPeopleSort(allPeople);
        hostPanel.classList.toggle('is-master', showPeopleMasterDetail() && rows.length > 0);

        document.getElementById('people-title').textContent = 'People';
        document.getElementById('people-subtitle').textContent = term
            ? 'People matching "' + term + '"'
            : 'Find other people using Subversion.';
        $$('people-count').setValue(resultCount(rows.length, peopleTotal || rows.length, 'person', 'people'));

        hostPanel.hidden = rows.length === 0;
        if (!rows.length) {
            host.innerHTML = '';
            renderPeopleDetail([]);
            return 0;
        }

        host.innerHTML = rows.map(personCard).join('') +
            (hasSearched ? loadMoreButton('people', allPeople.length, peopleTotal, 'people') : '');
        renderPeopleDetail(rows);
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

    function validFilter(mode) {
        return mode === 'repos' || mode === 'people' || mode === 'all';
    }

    function syncUrlState(q) {
        const url = new URL(location.href);
        if (q)
            url.searchParams.set('q', q);
        else
            url.searchParams.delete('q');
        if (filter && filter !== 'all')
            url.searchParams.set('filter', filter);
        else
            url.searchParams.delete('filter');
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
        syncUrlState(q);

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
        syncUrlState('');
        await loadBrowse();
    }

    function setFilter(mode, opts) {
        opts = opts || {};
        filter = mode;
        const list = document.getElementById('filter-list');
        if (list && opts.instant)
            list.classList.add('no-animate');
        [['all', 'filter-all'], ['repos', 'filter-repos'], ['people', 'filter-people']]
            .forEach((p) => {
                const el = $$(p[1]).element;
                const on = p[0] === filter;
                el.classList.toggle('active', on);
                el.setAttribute('aria-selected', on ? 'true' : 'false');
            });
        if (list)
            list.setAttribute('data-filter', filter);
        syncSearchPlaceholder();
        syncUrlState($$('disc-search').getValue().trim());
        renderAll();
        if (list && opts.instant)
            requestAnimationFrame(() => list.classList.remove('no-animate'));
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
            SvnHubUI.openPerson(owner.getAttribute('data-person-handle'), exploreOrigin());
            return;
        }
        const card = e.target.closest('.repo-card');
        if (card)
            SvnHubUI.openRepo(repoFromCard(card), exploreOrigin());
    });
    document.getElementById('repo-results').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const card = e.target.closest('.repo-card');
        if (card)
            SvnHubUI.openRepo(repoFromCard(card), exploreOrigin());
    });
    document.getElementById('people-results').addEventListener('click', (e) => {
        const more = e.target.closest('[data-load-more="people"]');
        if (more) {
            loadMore('people');
            return;
        }
        const card = e.target.closest('.person-card');
        if (!card)
            return;
        const handle = card.getAttribute('data-handle');
        if (showPeopleMasterDetail()) {
            selectedPersonHandle = handle;
            renderAll();
            return;
        }
        SvnHubUI.openPerson(handle, exploreOrigin());
    });
    document.getElementById('people-detail').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-open-selected-person]');
        if (btn) {
            SvnHubUI.openPerson(btn.getAttribute('data-open-selected-person'), exploreOrigin());
            return;
        }
        const repoItem = e.target.closest('.top-repo, .people-act');
        if (repoItem)
            SvnHubUI.openRepo(repoFromCard(repoItem), exploreOrigin());
    });
    document.getElementById('people-detail').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ')
            return;
        const repoItem = e.target.closest('.top-repo, .people-act');
        if (repoItem) {
            e.preventDefault();
            SvnHubUI.openRepo(repoFromCard(repoItem), exploreOrigin());
        }
    });
    if (masterDetailQuery) {
        const rerenderForViewport = () => renderAll();
        if (masterDetailQuery.addEventListener)
            masterDetailQuery.addEventListener('change', rerenderForViewport);
        else if (masterDetailQuery.addListener)
            masterDetailQuery.addListener(rerenderForViewport);
    }

    initDiscoverSections();

    if (Utils.setAppNavActive)
        Utils.setAppNavActive('discover', 'screens/Discover/Discover');

    const urlParams = new URLSearchParams(location.search || '');
    const urlFilter = urlParams.get('filter') || '';
    const pendingFilter = urlFilter || Utils.getAndEraseData('discoverFilter');
    const urlQuery = (urlParams.get('q') || '').trim();
    const dataQuery = (Utils.getAndEraseData('discoverQuery') || '').trim();
    const pendingQuery = urlQuery || dataQuery;
    if (validFilter(pendingFilter))
        filter = pendingFilter;
    setFilter(filter, {instant: true});
    if (pendingQuery)
        $$('disc-search').setValue(pendingQuery);
    syncSearchClear();
    if (pendingQuery) {
        await runSearch();
    } else {
        await loadBrowse();
    }

})();
