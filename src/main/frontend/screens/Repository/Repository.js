/* global $$, Utils, Server, AGGrid, DateTimeUtils, marked, hljs, Diff2Html */
'use strict';

(async function () {

    const WS_BROWSE = 'services/BrowseService';
    const WS_HIST = 'services/HistoryService';

    const repoId = Utils.getData('repoId');
    const repoKey = Utils.getData('repoKey');
    const repoName = Utils.getData('repoName');
    if (!repoId) {
        Utils.loadPage('screens/Repositories/Repositories', 'app-screen-area');
        return;
    }

    let currentPath = '';

    $$('repo-title').setValue(repoName || repoKey);
    $$('back').onclick(() => {
        Utils.cleanup();
        Utils.loadPage('screens/Repositories/Repositories', 'app-screen-area');
    });

    // ---- helpers ----
    function join(base, name) {
        return base ? base + '/' + name : name;
    }
    function parent(path) {
        const i = path.lastIndexOf('/');
        return i < 0 ? '' : path.substring(0, i);
    }
    function escapeHtml(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

    // ---- browse grid ----
    const browseCols = [
        {headerName: '', field: 'icon', width: 40},
        {headerName: 'Name', field: 'name', flex: 2},
        {headerName: 'Rev', field: 'revision', width: 80},
        {headerName: 'Author', field: 'author', width: 120},
        {headerName: 'Date', field: 'dateStr', width: 170},
        {headerName: 'Last message', field: 'message', flex: 3}
    ];
    const browseGrid = new AGGrid('browse-grid', browseCols, 'name');
    browseGrid.show();
    browseGrid.setOnRowDoubleClicked(() => {
        const row = browseGrid.getSelectedRow();
        if (!row)
            return;
        if (row.kind === 'dir') {
            currentPath = join(currentPath, row.name);
            loadDir();
        } else {
            openFile(join(currentPath, row.name), row.name);
        }
    });

    async function loadDir() {
        $$('crumb').setValue('/' + currentPath);
        browseGrid.clear();
        const res = await Server.call(WS_BROWSE, 'listDir', {repoId: repoId, path: currentPath});
        if (res._Success) {
            $$('repo-head').setValue('HEAD r' + res.revision);
            const rows = res.entries.map((e) => ({
                name: e.name,
                kind: e.kind,
                icon: e.kind === 'dir' ? '\u{1F4C1}' : '\u{1F4C4}',
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
            browseGrid.addRecords(rows);
        }
        loadReadme();
    }

    $$('up').onclick(() => {
        if (!currentPath)
            return;
        currentPath = parent(currentPath);
        loadDir();
    });

    // ---- README ----
    async function loadReadme() {
        const res = await Server.call(WS_BROWSE, 'readme', {repoId: repoId, path: currentPath});
        if (res._Success && res.found) {
            let html;
            if (res.isMarkdown && typeof marked !== 'undefined')
                html = marked.parse(res.content);
            else
                html = '<pre>' + escapeHtml(res.content) + '</pre>';
            $$('readme').setHTMLValue(html);
        } else {
            $$('readme').setValue('No README in this directory.');
        }
    }

    // ---- file view popup ----
    async function openFile(path, name) {
        const res = await Server.call(WS_BROWSE, 'cat', {repoId: repoId, path: path});
        if (!res._Success)
            return;
        $$('fp-title').setValue(path);
        if (res.binary) {
            $$('fp-content').setValue('Binary file (' + res.size + ' bytes) — cannot display.');
        } else {
            let inner;
            if (typeof hljs !== 'undefined') {
                try {
                    inner = hljs.highlightAuto(res.content).value;
                } catch (e) {
                    inner = escapeHtml(res.content);
                }
            } else {
                inner = escapeHtml(res.content);
            }
            $$('fp-content').setHTMLValue('<code class="hljs">' + inner + '</code>');
        }
        Utils.popup_open('file-popup');
    }
    $$('fp-close').onclick(() => Utils.popup_close());

    // ---- commits ----
    const commitCols = [
        {headerName: 'Rev', field: 'revision', width: 80},
        {headerName: 'Author', field: 'author', width: 130},
        {headerName: 'Date', field: 'dateStr', width: 170},
        {headerName: 'Message', field: 'message', flex: 3}
    ];
    const commitGrid = new AGGrid('commits-grid', commitCols, 'revision');
    commitGrid.show();
    commitGrid.setOnRowDoubleClicked(() => {
        const row = commitGrid.getSelectedRow();
        if (row)
            openRevision(row.revision);
    });

    async function loadCommits() {
        commitGrid.clear();
        const res = await Server.call(WS_HIST, 'log', {repoId: repoId, path: '', limit: 50});
        if (res._Success) {
            const rows = res.commits
                .filter((c) => c.revision > 0)
                .map((c) => ({
                    revision: c.revision,
                    author: c.author,
                    dateStr: fmtDate(c.date),
                    message: c.message
                }));
            commitGrid.addRecords(rows);
        }
    }

    async function openRevision(rev) {
        const res = await Server.call(WS_HIST, 'revisionDetail', {repoId: repoId, revision: rev});
        if (!res._Success)
            return;
        $$('rev-title').setValue('Revision ' + rev);
        $$('rev-info').setHTMLValue(
            '<b>' + escapeHtml(res.author || '') + '</b> &middot; ' + fmtDate(res.date) +
            '<br>' + escapeHtml(res.message || ''));
        let html;
        if (res.diff && typeof Diff2Html !== 'undefined')
            html = Diff2Html.html(res.diff, {drawFileList: true, matching: 'lines', outputFormat: 'line-by-line'});
        else
            html = '<pre>' + escapeHtml(res.diff || '(no diff)') + '</pre>';
        $$('rev-diff').setHTMLValue(html);
        Utils.popup_open('rev-popup');
    }
    $$('rev-close').onclick(() => Utils.popup_close());

    // ---- init ----
    await loadDir();
    await loadCommits();

})();
