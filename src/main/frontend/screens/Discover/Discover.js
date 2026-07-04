/* global $$, Utils, Server, AGGrid, DateTimeUtils */
'use strict';

(async function () {

    const WS = 'services/DiscoverService';
    const PAGE_SIZE = 20;

    function fmtDate(ms) {
        if (!ms)
            return '';
        try {
            return DateTimeUtils.formatDate(ms);
        } catch (e) {
            return '' + ms;
        }
    }
    function rangeLabel(total, page, count) {
        if (!total)
            return 'No matches.';
        const from = page * PAGE_SIZE + 1;
        return 'Showing ' + from + '–' + (from + count - 1) + ' of ' + total;
    }

    // ===== People =====
    const peopleGrid = new AGGrid('people-grid', [
        {headerName: 'Username', field: 'handle', flex: 1},
        {headerName: 'Name', field: 'fullName', flex: 2},
        {headerName: 'Public repos', field: 'publicRepoCount', width: 130}
    ], 'handle');
    peopleGrid.show();
    peopleGrid.setOnRowDoubleClicked(() => {
        const row = peopleGrid.getSelectedRow();
        if (row)
            loadProfile(row.handle, 0);
    });

    let peopleQuery = null;   // null => no search performed yet
    let peoplePage = 0;
    let peopleTotal = 0;

    async function loadPeople(page) {
        if (peopleQuery === null)
            return;
        const res = await Server.call(WS, 'searchUsers', {query: peopleQuery, page: page, pageSize: PAGE_SIZE});
        if (!res._Success)
            return;
        peoplePage = res.page;
        peopleTotal = res.total;
        peopleGrid.clear();
        peopleGrid.addRecords(res.rows);
        $$('people-count').setValue(rangeLabel(res.total, res.page, res.rows.length));
        $$('people-prev').enable(res.page > 0);
        $$('people-next').enable((res.page + 1) * PAGE_SIZE < res.total);
    }
    $$('people-prev').onclick(() => loadPeople(peoplePage - 1));
    $$('people-next').onclick(() => loadPeople(peoplePage + 1));

    // ===== Projects (search matches, or one person's repos after drilling in) =====
    const repoGrid = new AGGrid('repos-grid', [
        {headerName: 'Owner', field: 'ownerHandle', width: 130},
        {headerName: 'Name', field: 'name', flex: 2},
        {headerName: 'Visibility', field: 'visibility', width: 100},
        {headerName: 'Description', field: 'description', flex: 3},
        {headerName: 'HEAD', field: 'headRevision', width: 80},
        {headerName: 'Checkout URL', field: 'checkoutUrl', flex: 3}
    ], 'repoId');
    repoGrid.show();
    repoGrid.setOnRowDoubleClicked(() => {
        const row = repoGrid.getSelectedRow();
        if (!row)
            return;
        Utils.saveData('repoId', row.repoId);
        Utils.saveData('repoKey', row.repoKey);
        Utils.saveData('repoName', row.name);
        Router.go('/repository');
    });

    // reposSource: null (nothing yet) | {type:'search', query} | {type:'profile', handle}
    let reposSource = null;
    let reposPage = 0;
    let reposTotal = 0;

    async function loadRepos(page) {
        if (!reposSource)
            return;
        let res;
        if (reposSource.type === 'search')
            res = await Server.call(WS, 'searchRepos', {query: reposSource.query, page: page, pageSize: PAGE_SIZE});
        else
            res = await Server.call(WS, 'getProfile', {handle: reposSource.handle, page: page, pageSize: PAGE_SIZE});
        if (!res._Success)
            return;
        const rows = reposSource.type === 'search' ? res.rows : res.repos;
        reposPage = res.page;
        reposTotal = res.total;
        repoGrid.clear();
        repoGrid.addRecords(rows);
        $$('repos-count').setValue(rangeLabel(res.total, res.page, rows.length));
        $$('repos-prev').enable(res.page > 0);
        $$('repos-next').enable((res.page + 1) * PAGE_SIZE < res.total);
        if (reposSource.type === 'profile' && res.profile) {
            const p = res.profile;
            $$('disc-repos-title').setValue('@' + p.handle + (p.fullName ? ' — ' + p.fullName : ''));
            $$('disc-repos-sub').setValue(
                (p.memberSince ? 'Member since ' + fmtDate(p.memberSince) + '  ·  ' : '') +
                'double-click a project to open it');
        }
    }
    $$('repos-prev').onclick(() => loadRepos(reposPage - 1));
    $$('repos-next').onclick(() => loadRepos(reposPage + 1));

    // ===== one search box drives both =====
    async function search() {
        const q = $$('disc-search').getValue().trim();
        if (!q) {
            // Don't list everything before the user has actually searched.
            peopleQuery = null;
            reposSource = null;
            peopleGrid.clear();
            repoGrid.clear();
            $$('disc-repos-title').setValue('Projects');
            $$('disc-repos-sub').setValue('');
            $$('people-count').setValue('Enter a search term above.');
            $$('repos-count').setValue('');
            disableAllPagers();
            return;
        }
        peopleQuery = q;
        reposSource = {type: 'search', query: q};
        $$('disc-repos-title').setValue('Projects');
        $$('disc-repos-sub').setValue('');
        await loadPeople(0);
        await loadRepos(0);
    }
    $$('disc-search-go').onclick(search);
    $$('disc-search').onEnter(search);

    async function loadProfile(handle, page) {
        reposSource = {type: 'profile', handle: handle};
        await loadRepos(page);
    }

    function disableAllPagers() {
        $$('people-prev').disable();
        $$('people-next').disable();
        $$('repos-prev').disable();
        $$('repos-next').disable();
    }

    // Initial state: empty, waiting for a search.
    disableAllPagers();
    $$('people-count').setValue('Enter a search term above.');
    $$('disc-search').focus();

})();
