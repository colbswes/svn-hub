/* global $$, Utils, Server, AGGrid, DateUtils, DateTimeUtils */
'use strict';

(async function () {

    const WS_REPO = 'services/RepositoryService';
    const WS_STATS = 'services/StatsService';

    function fmtDate(ms) {
        if (!ms)
            return '';
        try {
            return DateTimeUtils.formatDate(ms);
        } catch (e) {
            return '' + ms;
        }
    }
    function fmtDay(d) {
        const s = '' + d;
        return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : s;
    }
    function fmtSize(b) {
        if (b == null)
            return '-';
        const u = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0, n = b;
        while (n >= 1024 && i < u.length - 1) {
            n /= 1024;
            i++;
        }
        return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
    }
    function esc(s) {
        return ('' + (s == null ? '' : s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function cards(rows) {
        let h = '<div class="ins-cards">';
        for (const row of rows)
            h += '<div class="ins-card"><div class="n">' + esc(row[0] == null ? '-' : row[0]) +
                '</div><div class="l">' + esc(row[1]) + '</div></div>';
        return h + '</div>';
    }
    function diffLabel(c) {
        if (c.behind == null)
            return 'unknown';
        if (c.behind > 0)
            return c.behind + ' behind';
        if (c.behind < 0)
            return (-c.behind) + ' ahead';
        return 'up to date';
    }

    // ---- grids ----
    const refCols = [
        {headerName: 'Name', field: 'name', flex: 2},
        {headerName: 'Last rev', field: 'revision', width: 100},
        {headerName: 'Author', field: 'author', width: 150},
        {headerName: 'Date', field: 'dateStr', flex: 1}
    ];
    const branchGrid = new AGGrid('branches-grid', refCols, 'name');
    branchGrid.show();
    const tagGrid = new AGGrid('tags-grid', refCols, 'name');
    tagGrid.show();

    const cloneGrid = new AGGrid('clones-grid', [
        {headerName: 'User', field: 'username', flex: 1},
        {headerName: 'Client host', field: 'clientHost', width: 150},
        {headerName: 'Cloned', field: 'clonedStr', flex: 1},
        {headerName: 'Synced rev', field: 'syncedRevision', width: 110},
        {headerName: 'Difference', field: 'diff', width: 130},
        {headerName: 'Last activity', field: 'lastStr', flex: 1}
    ], 'cloneKey');
    cloneGrid.show();

    async function loadAll() {
        const repoId = parseInt($$('ins-repo').getValue(), 10);
        if (!repoId)
            return;
        const beginDay = $$('ins-begin').getValue();
        const endDay = $$('ins-end').getValue();
        $$('ins-range-label').setValue('(' + fmtDay(beginDay) + ' – ' + fmtDay(endDay) + ')');

        const res = await Server.call(WS_STATS, 'insights', {repoId: repoId, beginDay: beginDay, endDay: endDay});
        if (!res._Success)
            return;

        $$('ins-repo-stats').setHTMLValue(cards([
            [fmtDate(res.createdTs), 'Created'],
            [fmtDate(res.lastCommitTs), 'Last commit'],
            [res.headRevision, 'Current revision'],
            [fmtSize(res.sizeBytes), 'Size'],
            [res.fileCount, 'Files (HEAD)'],
            [res.branchCount, 'Branches'],
            [res.tagCount, 'Tags'],
            [res.cloneCount, 'Clones']
        ]));
        $$('ins-activity-stats').setHTMLValue(cards([
            [res.checkouts, 'Checkouts'],
            [res.updates, 'Updates'],
            [res.commits, 'Commits'],
            [res.uniqueCheckoutUsers, 'Users – checked out'],
            [res.uniqueUpdateUsers, 'Users – updated'],
            [res.uniqueCommitUsers, 'Users – committed']
        ]));

        $$('ins-branch-count').setValue(res.branchCount);
        $$('ins-tag-count').setValue(res.tagCount);
        $$('ins-clone-count').setValue(res.cloneCount);

        branchGrid.clear();
        branchGrid.addRecords((res.branches || []).map((b) => Object.assign({}, b, {dateStr: fmtDate(b.date)})));
        tagGrid.clear();
        tagGrid.addRecords((res.tags || []).map((t) => Object.assign({}, t, {dateStr: fmtDate(t.date)})));
        cloneGrid.clear();
        cloneGrid.addRecords((res.clones || []).map((c) => ({
            cloneKey: c.username + '|' + (c.clientHost || ''),
            username: c.username,
            clientHost: c.clientHost,
            clonedStr: fmtDate(c.clonedTs),
            syncedRevision: c.syncedRevision,
            diff: diffLabel(c),
            lastStr: fmtDate(c.lastTs)
        })));
    }

    // ---- controls ----
    const repos = await Server.call(WS_REPO, 'getRepositories');
    $$('ins-repo').clear();
    const haveRepos = repos._Success && repos.rows.length;
    if (haveRepos) {
        for (const r of repos.rows)
            $$('ins-repo').add(String(r.repoId), r.name);
        $$('ins-repo').setValue(String(repos.rows[0].repoId));
    }

    const today = DateUtils.today();
    $$('ins-end').setValue(today);
    $$('ins-begin').setValue(DateUtils.intAddDays(today, -30));

    $$('ins-apply').onclick(loadAll);
    $$('ins-repo').onChange(loadAll);

    if (haveRepos)
        await loadAll();
    else
        $$('ins-repo-stats').setValue('No repositories available.');

})();
