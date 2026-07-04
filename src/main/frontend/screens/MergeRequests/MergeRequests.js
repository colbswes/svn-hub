/* global $$, Utils, Server, AGGrid, DateTimeUtils, marked, Diff2Html */
'use strict';

(async function () {

    const WS = 'services/MergeRequestService';
    const repoId = Utils.getData('repoId');
    const repoName = Utils.getData('repoName');
    if (!repoId) {
        //  Deep link with no repository selected — go to the list (replace, so the
        //  Back button doesn't return to this dead end).
        Router.replace('/repositories');
        return;
    }
    let current = null;

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

    $$('mr-repo').setValue(repoName || ('#' + repoId));
    $$('mr-back').onclick(() => {
        Router.go('/repository');
    });

    $$('mr-filter').clear();
    $$('mr-filter').add('open', 'Open');
    $$('mr-filter').add('merged', 'Merged');
    $$('mr-filter').add('closed', 'Closed');
    $$('mr-filter').add('', 'All');
    $$('mr-filter').setValue('open');
    $$('mr-filter').onChange(loadList);

    const grid = new AGGrid('mr-grid', [
        {headerName: '#', field: 'number', width: 70},
        {headerName: 'Title', field: 'title', flex: 3},
        {headerName: 'Status', field: 'status', width: 100},
        {headerName: 'Source', field: 'sourcepath', flex: 1},
        {headerName: 'Target', field: 'targetpath', flex: 1},
        {headerName: 'By', field: 'createdby', width: 110},
        {headerName: 'Merged r', field: 'mergedrev', width: 100}
    ], 'number');
    grid.show();
    grid.setOnRowDoubleClicked(() => {
        const row = grid.getSelectedRow();
        if (row)
            openMr(row.number);
    });

    async function loadList() {
        grid.clear();
        const res = await Server.call(WS, 'list', {repoId: repoId, status: $$('mr-filter').getValue()});
        if (res._Success)
            grid.addRecords(res.rows.map((r) => Object.assign({}, r, {createdStr: fmtDate(r.createdts)})));
    }

    // New MR
    $$('mr-new').onclick(() => {
        $$('mn-source').clear();
        $$('mn-target').setValue('/trunk');
        $$('mn-title').clear();
        $$('mn-body').clear();
        Utils.popup_open('mr-new-popup', 'mn-source');
    });
    $$('mn-cancel').onclick(() => Utils.popup_close());
    $$('mn-ok').onclick(async () => {
        if ($$('mn-source').isError('Source') || $$('mn-target').isError('Target'))
            return;
        const res = await Server.call(WS, 'create', {
            repoId: repoId,
            sourcePath: $$('mn-source').getValue(),
            targetPath: $$('mn-target').getValue(),
            title: $$('mn-title').getValue(),
            body: $$('mn-body').getValue()
        });
        if (res._Success) {
            Utils.popup_close();
            await loadList();
        }
    });

    // Detail
    async function openMr(number) {
        const res = await Server.call(WS, 'get', {repoId: repoId, number: number});
        if (!res._Success)
            return;
        current = number;
        const m = res.mr;
        $$('md-title').setValue('#' + m.number + '  ' + m.title);
        $$('md-meta').setHTMLValue('<b>' + esc(m.status) + '</b> &middot; ' + esc(m.sourcePath) +
            ' &rarr; ' + esc(m.targetPath) + ' &middot; by ' + esc(m.createdBy) + ' &middot; ' + fmtDate(m.createdTs) +
            (m.mergedRev ? ' &middot; merged as r' + m.mergedRev : ''));
        renderComments(res.comments);
        $$('md-newcomment').clear();

        // diff preview (only meaningful while open)
        $$('md-diff').setValue('Loading diff…');
        const dp = await Server.call(WS, 'diffPreview', {repoId: repoId, number: number});
        if (dp._Success) {
            if (dp.diff && typeof Diff2Html !== 'undefined')
                $$('md-diff').setHTMLValue(Diff2Html.html(dp.diff, {drawFileList: true, matching: 'lines', outputFormat: 'line-by-line'}));
            else
                $$('md-diff').setHTMLValue('<pre>' + esc(dp.diff || '(no differences)') + '</pre>');
        }

        const open = m.status === 'open';
        $$('md-merge').onclick(async () => {
            Utils.yesNo('Merge', 'Merge ' + m.sourcePath + ' into ' + m.targetPath + '?', async () => {
                const r = await Server.call(WS, 'approveAndMerge', {repoId: repoId, number: number});
                if (r._Success) {
                    Utils.showMessage('Merged', 'Committed as revision ' + r.mergedRev + '.');
                    Utils.popup_close();
                    await loadList();
                }
            });
        });
        $$('md-closereq').onclick(async () => {
            const r = await Server.call(WS, 'close', {repoId: repoId, number: number});
            if (r._Success) {
                Utils.popup_close();
                await loadList();
            }
        });
        // Enable merge/close only while open and (for merge) the user can write.
        if (open && res.canMerge)
            $$('md-merge').enable();
        else
            $$('md-merge').disable();
        if (open)
            $$('md-closereq').enable();
        else
            $$('md-closereq').disable();

        Utils.popup_open('mr-detail-popup');
    }
    function renderComments(comments) {
        if (!comments || !comments.length) {
            $$('md-comments').setValue('No comments yet.');
            return;
        }
        let html = '';
        for (const c of comments) {
            const anchor = c.filepath ? ('<i>' + esc(c.filepath) + (c.lineno ? ':' + c.lineno : '') + '</i> — ') : '';
            html += '<div class="cmt"><div class="meta">' + esc(c.username) + ' &middot; ' + fmtDate(c.createdts) +
                '</div>' + anchor + md(c.body) + '</div>';
        }
        $$('md-comments').setHTMLValue(html);
    }
    $$('md-comment').onclick(async () => {
        const body = $$('md-newcomment').getValue();
        if (!body || !body.trim())
            return;
        const res = await Server.call(WS, 'comment', {repoId: repoId, number: current, body: body});
        if (res._Success)
            await openMr(current);
    });
    $$('md-done').onclick(() => Utils.popup_close());

    loadList();

})();
