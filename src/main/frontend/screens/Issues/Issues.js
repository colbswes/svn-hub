/* global $$, Utils, Server, AGGrid, DateTimeUtils, marked */
'use strict';

(async function () {

    const WS = 'services/IssueService';
    const repoId = Utils.getData('repoId');
    const repoName = Utils.getData('repoName');
    if (!repoId) {
        //  Deep link with no repository selected — go to the list (replace, so the
        //  Back button doesn't return to this dead end).
        Router.replace('/repositories');
        return;
    }
    let current = null;   // currently open issue number

    function fmtDate(ms) {
        try {
            return ms ? DateTimeUtils.formatDate(ms) : '';
        } catch (e) {
            return '' + ms;
        }
    }
    function esc(s) {
        return ('' + (s == null ? '' : s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function md(s) {
        if (typeof marked !== 'undefined' && s)
            return marked.parse(s);
        return '<pre>' + esc(s) + '</pre>';
    }

    $$('iss-repo').setValue(repoName || ('#' + repoId));
    $$('iss-back').onclick(() => {
        Router.go('/repository');
    });

    $$('iss-filter').clear();
    $$('iss-filter').add('open', 'Open');
    $$('iss-filter').add('closed', 'Closed');
    $$('iss-filter').add('', 'All');
    $$('iss-filter').setValue('open');
    $$('iss-filter').onChange(loadList);

    const grid = new AGGrid('iss-grid', [
        {headerName: '#', field: 'number', width: 70},
        {headerName: 'Title', field: 'title', flex: 3},
        {headerName: 'Status', field: 'status', width: 100},
        {headerName: 'By', field: 'createdby', width: 120},
        {headerName: 'Comments', field: 'comments', width: 110},
        {headerName: 'Created', field: 'createdStr', flex: 1}
    ], 'number');
    grid.show();
    grid.setOnRowDoubleClicked(() => {
        const row = grid.getSelectedRow();
        if (row)
            openIssue(row.number);
    });

    async function loadList() {
        grid.clear();
        const res = await Server.call(WS, 'list', {repoId: repoId, status: $$('iss-filter').getValue()});
        if (res._Success)
            grid.addRecords(res.rows.map((r) => Object.assign({}, r, {createdStr: fmtDate(r.createdts)})));
    }

    // New issue
    $$('iss-new').onclick(() => {
        $$('in-title').clear();
        $$('in-body').clear();
        Utils.popup_open('iss-new-popup', 'in-title');
    });
    $$('in-cancel').onclick(() => Utils.popup_close());
    $$('in-ok').onclick(async () => {
        if ($$('in-title').isError('Title'))
            return;
        const res = await Server.call(WS, 'create',
            {repoId: repoId, title: $$('in-title').getValue(), body: $$('in-body').getValue()});
        if (res._Success) {
            Utils.popup_close();
            await loadList();
        }
    });

    // Detail
    async function openIssue(number) {
        const res = await Server.call(WS, 'get', {repoId: repoId, number: number});
        if (!res._Success)
            return;
        current = number;
        const i = res.issue;
        $$('id-title').setValue('#' + i.number + '  ' + i.title);
        $$('id-meta').setHTMLValue('<b>' + esc(i.status) + '</b> &middot; opened by ' + esc(i.createdBy) +
            ' &middot; ' + fmtDate(i.createdTs));
        $$('id-body').setHTMLValue(md(i.body));
        renderComments(res.comments);
        $$('id-newcomment').clear();
        $$('id-toggle').setValue(i.status === 'open' ? 'Close issue' : 'Reopen issue');
        $$('id-toggle').onclick(async () => {
            const newStatus = i.status === 'open' ? 'closed' : 'open';
            const r = await Server.call(WS, 'setStatus', {repoId: repoId, number: number, status: newStatus});
            if (r._Success) {
                Utils.popup_close();
                await loadList();
            }
        });
        Utils.popup_open('iss-detail-popup');
    }
    function renderComments(comments) {
        if (!comments || !comments.length) {
            $$('id-comments').setValue('No comments yet.');
            return;
        }
        let html = '';
        for (const c of comments)
            html += '<div class="cmt"><div class="meta">' + esc(c.username) + ' &middot; ' +
                fmtDate(c.createdts) + '</div>' + md(c.body) + '</div>';
        $$('id-comments').setHTMLValue(html);
    }
    $$('id-comment').onclick(async () => {
        const body = $$('id-newcomment').getValue();
        if (!body || !body.trim())
            return;
        const res = await Server.call(WS, 'comment', {repoId: repoId, number: current, body: body});
        if (res._Success)
            await openIssue(current);   // reload detail
    });
    $$('id-close').onclick(() => Utils.popup_close());

    loadList();

})();
