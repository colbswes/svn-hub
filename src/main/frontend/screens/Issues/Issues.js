/* global $$, Utils, Server, DateTimeUtils, marked, Router */
'use strict';

(async function () {

    const WS = 'services/IssueService';
    const guest = Utils.getData('guest') === true;
    const repoId = Utils.getData('repoId');
    const repoName = Utils.getData('repoName');
    if (!repoId) {
        //  Deep link with no repository selected — go to the list (replace, so the
        //  Back button doesn't return to this dead end).
        Router.replace(guest ? '/discover' : '/dashboard');
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

    let issueFilter = 'open';
    const issueFilterEl = document.getElementById('iss-filter');
    function setIssueFilter(status, reload = true) {
        issueFilter = status || '';
        issueFilterEl.querySelectorAll('.root-chip').forEach((btn) => {
            const active = (btn.getAttribute('data-status') || '') === issueFilter;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (reload)
            loadList();
    }
    issueFilterEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.root-chip');
        if (btn)
            setIssueFilter(btn.getAttribute('data-status') || '');
    });
    setIssueFilter(issueFilter, false);

    const listHost = document.getElementById('iss-list');

    // ---- views: the list, an in-place issue detail, and an in-place composer.
    // Which one shows is mirrored in a ?issue= query param (a number, or "new"),
    // pushed to browser history so Back/Forward walk through list <-> detail and
    // deep links restore the exact view. The state keeps whatever the host
    // Repository screen put there (__repoSection etc.) so its popstate handling
    // still restores the Issues section first.
    const VIEWS = {list: 'iss-view-list', detail: 'iss-view-detail', compose: 'iss-view-new'};
    function showView(name) {
        Object.keys(VIEWS).forEach((k) => {
            const el = document.getElementById(VIEWS[k]);
            if (el)
                el.style.display = k === name ? '' : 'none';
        });
    }

    function issueUrl(val) {
        const url = new URL(location.href);
        if (val == null || val === '')
            url.searchParams.delete('issue');
        else
            url.searchParams.set('issue', val);
        return url.pathname + url.search + url.hash;
    }
    function writeIssueHistory(val, mode = 'push') {
        try {
            const url = issueUrl(val);
            const currentUrl = location.pathname + location.search + location.hash;
            if (mode !== 'replace' && url === currentUrl)
                return;
            const state = Object.assign({}, history.state || {}, {__issue: val == null ? '' : String(val)});
            history[mode === 'replace' ? 'replaceState' : 'pushState'](state, '', url);
        } catch (e) { /* history not available */ }
    }

    async function showList(historyMode = null) {
        if (historyMode)
            writeIssueHistory(null, historyMode);
        showView('list');
        await loadList();
    }

    // Re-open whatever the URL names. Called on load, on Back/Forward, and when
    // the Repository screen re-shows an already-loaded Issues embed.
    async function syncFromUrl() {
        if (!document.getElementById('iss-list'))
            return;                                   // this screen has been replaced
        const params = new URLSearchParams(location.search || '');
        const section = params.get('section');
        if (section && section !== 'issues')
            return;                                   // another repo section owns the view
        const v = params.get('issue') || '';
        if (v === 'new' && !guest)
            showCompose(false);
        else if (/^\d+$/.test(v))
            await openIssue(Number(v), {writeHistory: false});
        else
            await showList();
    }
    // Only one such listener pair is ever registered (each load removes the last).
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
    if (window.__issuesViewSync) {
        window.removeEventListener('repo-embed-sync', window.__issuesViewSync);
        window.removeEventListener('popstate', window.__issuesViewSync);
    }
    window.__issuesViewSync = queueSync;
    window.addEventListener('repo-embed-sync', window.__issuesViewSync);
    window.addEventListener('popstate', window.__issuesViewSync);

    // status glyphs — open ring (copper) vs. closed check (green)
    const ICON_OPEN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>' +
        '<circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
    const ICON_CLOSED = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>' +
        '<path d="M5.4 8.2l1.8 1.8L10.8 6" stroke="currentColor" stroke-width="1.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ICON_COMMENT = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<path d="M2.5 3.5h11v7h-6l-3 2.2V10.5h-2z" stroke="currentColor" stroke-width="1.3" ' +
        'stroke-linejoin="round"/></svg>';

    function issueRow(r) {
        const closed = ('' + r.status).toLowerCase() === 'closed';
        const createdBy = r.createdBy || r.createdby;
        const created = fmtDate(r.createdTs || r.createdts);
        const comments = Number(r.comments) || 0;
        const meta = 'opened by ' + esc(createdBy || 'unknown') +
            (created ? ' &middot; ' + esc(created) : '');
        return '<article class="issue-row" data-number="' + esc(r.number) + '" tabindex="0">' +
            '<span class="issue-status ' + (closed ? 'closed' : 'open') + '" title="' +
                (closed ? 'Closed' : 'Open') + '">' + (closed ? ICON_CLOSED : ICON_OPEN) + '</span>' +
            '<div class="issue-body">' +
                '<div class="issue-title-line">' +
                    '<span class="issue-num">#' + esc(r.number) + '</span>' +
                    '<span class="issue-title">' + esc(r.title) + '</span>' +
                '</div>' +
                '<div class="issue-meta">' + meta + '</div>' +
            '</div>' +
            '<span class="issue-comments" title="' + comments + ' comments">' +
                ICON_COMMENT + comments +
            '</span>' +
        '</article>';
    }

    // Keep the Repository rail badge honest when the open count is on screen.
    function updateRailCount(openCount) {
        const el = document.getElementById('count-issues');
        if (!el)
            return;
        el.textContent = openCount;
        el.hidden = openCount <= 0;
    }

    async function loadList() {
        listHost.innerHTML = '<p class="muted issue-empty" style="padding:8px 2px;">Loading issues…</p>';
        const res = await Server.call(WS, 'list', {repoId: repoId, status: issueFilter});
        if (!res._Success) {
            listHost.innerHTML = '<p class="muted issue-empty" style="padding:8px 2px;">Unable to load issues.</p>';
            return;
        }
        const rows = res.rows || [];
        if (issueFilter === 'open')
            updateRailCount(rows.length);
        if (!rows.length) {
            listHost.innerHTML = '<p class="muted issue-empty" style="padding:8px 2px;">No issues to show.</p>';
            return;
        }
        listHost.innerHTML = rows.map(issueRow).join('');
    }

    listHost.addEventListener('click', (e) => {
        const row = e.target.closest('.issue-row');
        if (row)
            openIssue(Number(row.getAttribute('data-number')));
    });
    listHost.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const row = e.target.closest('.issue-row');
        if (row)
            openIssue(Number(row.getAttribute('data-number')));
    });

    // ---- composer (in place of the old popup) ----
    function showCompose(writeHistory = true) {
        if (guest)
            return;
        $$('in-title').clear();
        $$('in-body').clear();
        if (writeHistory)
            writeIssueHistory('new');
        showView('compose');
        $$('in-title').focus();
    }
    $$('iss-new').onclick(() => showCompose());
    $$('in-back').onclick(() => showList('replace'));
    $$('in-cancel').onclick(() => showList('replace'));
    $$('in-ok').onclick(async () => {
        if ($$('in-title').isError('Title'))
            return;
        const res = await Server.call(WS, 'create',
            {repoId: repoId, title: $$('in-title').getValue(), body: $$('in-body').getValue()});
        if (res._Success) {
            Utils.toast.success('Issue created');
            await showList('replace');
        }
    });

    // ---- in-place detail ----
    async function openIssue(number, options = {}) {
        const res = await Server.call(WS, 'get', {repoId: repoId, number: number});
        if (!res._Success)
            return;
        current = number;
        const i = res.issue;
        const closed = ('' + i.status).toLowerCase() === 'closed';
        document.getElementById('id-num').textContent = '#' + i.number;
        document.getElementById('id-title').textContent = i.title;
        document.getElementById('id-meta').innerHTML =
            '<span class="ticket-pill ' + (closed ? 'closed' : 'open') + '">' +
                (closed ? ICON_CLOSED : ICON_OPEN) + (closed ? 'Closed' : 'Open') + '</span>' +
            '<span>opened by <b>' + esc(i.createdBy) + '</b></span>' +
            '<span class="ticket-dotsep">&middot;</span><span>' + esc(fmtDate(i.createdTs)) + '</span>';
        document.getElementById('id-body').innerHTML =
            (i.body && i.body.trim()) ? md(i.body) : '<p class="muted" style="margin:0;">No description provided.</p>';
        renderComments(res.comments);
        $$('id-newcomment').clear();
        $$('id-toggle').setValue(closed ? 'Reopen issue' : 'Close issue');
        $$('id-toggle').onclick(async () => {
            const newStatus = closed ? 'open' : 'closed';
            const r = await Server.call(WS, 'setStatus', {repoId: repoId, number: number, status: newStatus});
            if (r._Success) {
                Utils.toast.success(newStatus === 'closed' ? 'Issue closed' : 'Issue reopened');
                await openIssue(number, {writeHistory: false});   // stay here, refresh state
            }
        });
        if (options.writeHistory !== false)
            writeIssueHistory(number);
        showView('detail');
        if (guest)
            hideGuestDetailControls();
    }
    $$('id-back').onclick(() => showList('replace'));

    function renderComments(comments) {
        const host = document.getElementById('id-comments');
        const countEl = document.getElementById('id-comment-count');
        const n = comments ? comments.length : 0;
        if (countEl)
            countEl.textContent = n;
        if (!n) {
            host.innerHTML = '<p class="muted" style="margin:0; padding:4px 0 10px;">No comments yet.</p>';
            return;
        }
        let html = '';
        for (const c of comments)
            html += '<div class="cmt"><div class="meta">' + esc(c.userName || c.username) + ' &middot; ' +
                fmtDate(c.createdTs || c.createdts) + '</div>' + md(c.body) + '</div>';
        host.innerHTML = html;
    }
    $$('id-comment').onclick(async () => {
        if (guest)
            return;
        const body = $$('id-newcomment').getValue();
        if (!body || !body.trim())
            return;
        const res = await Server.call(WS, 'comment', {repoId: repoId, number: current, body: body});
        if (res._Success) {
            Utils.toast.success('Comment saved');
            await openIssue(current, {writeHistory: false});   // reload detail
        }
    });

    if (Utils.setAppNavActive)
        Utils.setAppNavActive('repositories');
    if (guest)
        $$('iss-new').hide();
    await syncFromUrl();

    function hideGuestDetailControls() {
        const composer = document.getElementById('id-composer');
        if (composer)
            composer.style.display = 'none';
        $$('id-toggle').hide();
    }

})();
