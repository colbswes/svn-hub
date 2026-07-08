/* global $$, Utils, Server, DateTimeUtils, marked, SvnHubUI, Router */
'use strict';

(async function () {

    const WS = 'services/MergeRequestService';
    const guest = Utils.getData('guest') === true;
    const repoId = Utils.getData('repoId');
    const repoName = Utils.getData('repoName');
    if (!repoId) {
        //  Deep link with no repository selected — go to the list (replace, so the
        //  Back button doesn't return to this dead end).
        Router.replace(guest ? '/discover' : '/dashboard');
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

    let mrFilter = 'open';
    const mrFilterEl = document.getElementById('mr-filter');
    function setMrFilter(status, reload = true) {
        mrFilter = status || '';
        mrFilterEl.querySelectorAll('.root-chip').forEach((btn) => {
            const active = (btn.getAttribute('data-status') || '') === mrFilter;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (reload)
            loadList();
    }
    mrFilterEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.root-chip');
        if (btn)
            setMrFilter(btn.getAttribute('data-status') || '');
    });
    setMrFilter(mrFilter, false);

    const listHost = document.getElementById('mr-list');

    // ---- views: list, in-place detail (full-width diff), in-place composer.
    // Mirrored in a ?mr= query param (number or "new") pushed to browser history,
    // exactly like the Issues screen — deep-linkable and Back/Forward friendly.
    const VIEWS = {list: 'mr-view-list', detail: 'mr-view-detail', compose: 'mr-view-new'};
    function showView(name) {
        Object.keys(VIEWS).forEach((k) => {
            const el = document.getElementById(VIEWS[k]);
            if (el)
                el.style.display = k === name ? '' : 'none';
        });
    }

    function mrUrl(val) {
        const url = new URL(location.href);
        if (val == null || val === '')
            url.searchParams.delete('mr');
        else
            url.searchParams.set('mr', val);
        return url.pathname + url.search + url.hash;
    }
    function writeMrHistory(val, mode = 'push') {
        try {
            const url = mrUrl(val);
            const currentUrl = location.pathname + location.search + location.hash;
            if (mode !== 'replace' && url === currentUrl)
                return;
            const state = Object.assign({}, history.state || {}, {__mr: val == null ? '' : String(val)});
            history[mode === 'replace' ? 'replaceState' : 'pushState'](state, '', url);
        } catch (e) { /* history not available */ }
    }

    async function showList(historyMode = null) {
        if (historyMode)
            writeMrHistory(null, historyMode);
        showView('list');
        await loadList();
    }

    async function syncFromUrl() {
        if (!document.getElementById('mr-list'))
            return;                                   // this screen has been replaced
        const params = new URLSearchParams(location.search || '');
        const section = params.get('section');
        if (section && section !== 'mrs')
            return;                                   // another repo section owns the view
        const v = params.get('mr') || '';
        if (v === 'new' && !guest)
            showCompose(false);
        else if (/^\d+$/.test(v))
            await openMr(Number(v), {writeHistory: false});
        else
            await showList();
    }
    let syncQueued = false;
    function queueSync() {
        if (syncQueued)
            return;
        syncQueued = true;
        setTimeout(() => {
            syncQueued = false;
            syncFromUrl();
        }, 0);
    }
    if (window.__mrsViewSync) {
        window.removeEventListener('repo-embed-sync', window.__mrsViewSync);
        window.removeEventListener('popstate', window.__mrsViewSync);
    }
    window.__mrsViewSync = queueSync;
    window.addEventListener('repo-embed-sync', window.__mrsViewSync);
    window.addEventListener('popstate', window.__mrsViewSync);

    // status glyphs — open (git-branch, green), merged (check-in-circle, plum), closed (x, muted)
    const ICON_OPEN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<circle cx="4.5" cy="4" r="1.8" stroke="currentColor" stroke-width="1.3"/>' +
        '<circle cx="4.5" cy="12" r="1.8" stroke="currentColor" stroke-width="1.3"/>' +
        '<circle cx="11.5" cy="4" r="1.8" stroke="currentColor" stroke-width="1.3"/>' +
        '<path d="M11.5 5.8v1.2c0 2-1.5 3-3.5 3.2H6.3M4.5 5.8v4.4" stroke="currentColor" ' +
        'stroke-width="1.3" stroke-linecap="round"/></svg>';
    const ICON_MERGED = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>' +
        '<path d="M5.4 8.2l1.8 1.8L10.8 6" stroke="currentColor" stroke-width="1.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ICON_CLOSED = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>' +
        '<path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.4" ' +
        'stroke-linecap="round"/></svg>';
    const ICON_COMMENT = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<path d="M2.5 3.5h11v7h-6l-3 2.2V10.5h-2z" stroke="currentColor" stroke-width="1.3" ' +
        'stroke-linejoin="round"/></svg>';

    function statusIcon(status) {
        if (status === 'merged')
            return ICON_MERGED;
        if (status === 'closed')
            return ICON_CLOSED;
        return ICON_OPEN;
    }

    function mrRow(r) {
        const status = ('' + r.status).toLowerCase();
        const cls = (status === 'merged' || status === 'closed') ? status : 'open';
        const source = r.sourcePath || r.sourcepath;
        const target = r.targetPath || r.targetpath;
        const createdBy = r.createdBy || r.createdby;
        const mergedRev = r.mergedRev || r.mergedrev;
        const created = fmtDate(r.createdTs || r.createdts);
        const comments = Number(r.comments) || 0;
        let meta = 'opened by ' + esc(createdBy || 'unknown') +
            (created ? ' &middot; ' + esc(created) : '');
        if (mergedRev)
            meta += ' &middot; merged as r' + esc(mergedRev);
        return '<article class="mr-row" data-number="' + esc(r.number) + '" tabindex="0">' +
            '<span class="mr-status ' + cls + '" title="' + cls + '">' + statusIcon(cls) + '</span>' +
            '<div class="mr-body">' +
                '<div class="mr-title-line">' +
                    '<span class="mr-num">#' + esc(r.number) + '</span>' +
                    '<span class="mr-title">' + esc(r.title || '(untitled)') + '</span>' +
                    '<span class="mr-pill ' + cls + '">' + esc(cls) + '</span>' +
                '</div>' +
                '<div class="mr-path">' +
                    '<span class="seg src">' + esc(source || '?') + '</span>' +
                    '<span class="arrow">&rarr;</span>' +
                    '<span class="seg tgt">' + esc(target || '?') + '</span>' +
                '</div>' +
                '<div class="mr-meta">' + meta + '</div>' +
            '</div>' +
            '<span class="mr-right">' +
                '<span class="mr-comments" title="' + comments + ' comments">' +
                    ICON_COMMENT + comments +
                '</span>' +
            '</span>' +
        '</article>';
    }

    // Keep the Repository rail badge honest when the open count is on screen.
    function updateRailCount(openCount) {
        const el = document.getElementById('count-mrs');
        if (!el)
            return;
        el.textContent = openCount;
        el.hidden = openCount <= 0;
    }

    async function loadList() {
        listHost.innerHTML = '<p class="muted mr-empty" style="padding:8px 2px;">Loading merge requests…</p>';
        const res = await Server.call(WS, 'list', {repoId: repoId, status: mrFilter});
        if (!res._Success) {
            listHost.innerHTML = '<p class="muted mr-empty" style="padding:8px 2px;">Unable to load merge requests.</p>';
            return;
        }
        const rows = res.rows || [];
        if (mrFilter === 'open')
            updateRailCount(rows.length);
        if (!rows.length) {
            listHost.innerHTML = '<p class="muted mr-empty" style="padding:8px 2px;">No merge requests to show.</p>';
            return;
        }
        listHost.innerHTML = rows.map(mrRow).join('');
    }

    listHost.addEventListener('click', (e) => {
        const row = e.target.closest('.mr-row');
        if (row)
            openMr(Number(row.getAttribute('data-number')));
    });
    listHost.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const row = e.target.closest('.mr-row');
        if (row)
            openMr(Number(row.getAttribute('data-number')));
    });

    // ---- composer (in place of the old popup) ----
    function showCompose(writeHistory = true) {
        if (guest)
            return;
        $$('mn-source').clear();
        $$('mn-target').setValue('/trunk');
        $$('mn-title').clear();
        $$('mn-body').clear();
        if (writeHistory)
            writeMrHistory('new');
        showView('compose');
        $$('mn-source').focus();
    }
    $$('mr-new').onclick(() => showCompose());
    $$('mn-back').onclick(() => showList('replace'));
    $$('mn-cancel').onclick(() => showList('replace'));
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
            Utils.toast.success('Merge request created');
            await showList('replace');
        }
    });

    // ---- in-place detail ----
    async function openMr(number, options = {}) {
        const res = await Server.call(WS, 'get', {repoId: repoId, number: number});
        if (!res._Success)
            return;
        current = number;
        const m = res.mr;
        const status = ('' + m.status).toLowerCase();
        const cls = (status === 'merged' || status === 'closed') ? status : 'open';
        document.getElementById('md-num').textContent = '#' + m.number;
        document.getElementById('md-title').textContent = m.title || '(untitled)';
        document.getElementById('md-meta').innerHTML =
            '<span class="ticket-pill ' + cls + '">' + statusIcon(cls) + esc(cls) + '</span>' +
            '<span>opened by <b>' + esc(m.createdBy) + '</b></span>' +
            '<span class="ticket-dotsep">&middot;</span><span>' + esc(fmtDate(m.createdTs)) + '</span>' +
            (m.mergedRev ? '<span class="ticket-dotsep">&middot;</span><span class="mono">merged as r' + esc(m.mergedRev) + '</span>' : '');
        document.getElementById('md-path').innerHTML =
            '<span class="seg src">' + esc(m.sourcePath) + '</span>' +
            '<span class="arrow">&rarr;</span>' +
            '<span class="seg tgt">' + esc(m.targetPath) + '</span>';
        document.getElementById('md-desc').innerHTML =
            (m.body && m.body.trim()) ? md(m.body) : '<p class="muted" style="margin:0;">No description provided.</p>';
        renderComments(res.comments);
        $$('md-newcomment').clear();

        if (options.writeHistory !== false)
            writeMrHistory(number);
        showView('detail');

        const open = m.status === 'open';
        $$('md-merge').onclick(async () => {
            Utils.yesNo('Merge', 'Merge ' + m.sourcePath + ' into ' + m.targetPath + '?', async () => {
                const r = await Server.call(WS, 'approveAndMerge', {repoId: repoId, number: number});
                if (r._Success) {
                    Utils.toast.success('Merged as revision ' + r.mergedRev);
                    await openMr(number, {writeHistory: false});   // refresh status in place
                }
            });
        });
        $$('md-closereq').onclick(async () => {
            const r = await Server.call(WS, 'close', {repoId: repoId, number: number});
            if (r._Success) {
                Utils.toast.success('Merge request closed');
                await showList('replace');
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
        if (guest)
            hideGuestDetailControls();

        // diff preview (only meaningful while open) — loaded last so the detail
        // shell paints immediately and the diff streams in below it.
        const diffHost = document.getElementById('md-diff');
        diffHost.innerHTML = SvnHubUI.spinner('Loading diff…');
        const dp = await Server.call(WS, 'diffPreview', {repoId: repoId, number: number});
        if (current !== number || !document.getElementById('md-diff'))
            return;                                   // user has moved on meanwhile
        if (dp._Success)
            SvnHubUI.renderUnifiedDiff(diffHost, dp.diff);
        else
            diffHost.innerHTML = '<p class="muted" style="margin:0; padding:10px 0;">Diff preview unavailable.</p>';
    }
    $$('md-back').onclick(() => showList('replace'));

    function renderComments(comments) {
        const host = document.getElementById('md-comments');
        const countEl = document.getElementById('md-comment-count');
        const n = comments ? comments.length : 0;
        if (countEl)
            countEl.textContent = n;
        if (!n) {
            host.innerHTML = '<p class="muted" style="margin:0; padding:4px 0 10px;">No comments yet.</p>';
            return;
        }
        let html = '';
        for (const c of comments) {
            const filePath = c.filePath || c.filepath;
            const lineNo = c.lineNo || c.lineno;
            const anchor = filePath ? ('<i>' + esc(filePath) + (lineNo ? ':' + lineNo : '') + '</i> &middot; ') : '';
            html += '<div class="cmt"><div class="meta">' + esc(c.userName || c.username) + ' &middot; ' + fmtDate(c.createdTs || c.createdts) +
                '</div>' + anchor + md(c.body) + '</div>';
        }
        host.innerHTML = html;
    }
    $$('md-comment').onclick(async () => {
        if (guest)
            return;
        const body = $$('md-newcomment').getValue();
        if (!body || !body.trim())
            return;
        const res = await Server.call(WS, 'comment', {repoId: repoId, number: current, body: body});
        if (res._Success) {
            Utils.toast.success('Comment saved');
            await openMr(current, {writeHistory: false});
        }
    });

    if (Utils.setAppNavActive)
        Utils.setAppNavActive('repositories');
    if (guest)
        $$('mr-new').hide();
    await syncFromUrl();

    function hideGuestDetailControls() {
        const composer = document.getElementById('md-composer');
        if (composer)
            composer.style.display = 'none';
        $$('md-comment').hide();
        $$('md-merge').hide();
        $$('md-closereq').hide();
    }

})();
