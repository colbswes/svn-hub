/* global $$, Utils, Server, DateUtils, DateTimeUtils, Chart, SvnHubUI */
'use strict';

(async function () {

    const WS_REPO = 'services/RepositoryService';
    const WS_STATS = 'services/StatsService';
    const scopedRepoId = Utils.getAndEraseData('insightsRepoId');
    const scopedRepoName = Utils.getData('repoName') || 'This repository';
    const scopedToRepo = scopedRepoId != null && scopedRepoId !== '';

    const COL = {
        read: '#1f5d57',      // teal
        readFill: 'rgba(31,93,87,0.10)',
        write: '#445aa8',     // periwinkle (accent)
        writeFill: 'rgba(68,90,168,0.16)',
        fresh: '#2f6b3a',     // up to date
        near: '#c08a1a',      // 1-2 behind (amber warning)
        far: '#9e2b1c',       // 3+ behind (stale — red, not copper)
        grid: 'rgba(28,26,22,0.08)',
        tick: '#9a907a'
    };
    const AVATARS = ['#1f5d57', '#809cc9', '#5768a4', '#6b2c4e', '#3a4f86', '#c08a1a', '#2c7a72'];

    let cadenceChart = null;
    let freshnessChart = null;
    let rangeDays = 30;
    let customBeginDay = null;
    let customEndDay = null;
    let loadSeq = 0;
    const repoNames = {};
    const LS = {
        range: 'svnhub.insights.range',
        customBegin: 'svnhub.insights.customBegin',
        customEnd: 'svnhub.insights.customEnd',
        repo: 'svnhub.insights.repo',
        collapsed: 'svnhub.insights.collapsed'
    };

    // localStorage is disabled when the page is embedded inside a single
    // repository (scopedToRepo); persisting global selections there would
    // leak into the standalone Insights screen.
    function lsGet(key) {
        if (scopedToRepo)
            return null;
        try {
            return window.localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }
    function lsSet(key, val) {
        if (scopedToRepo)
            return;
        try {
            if (val == null)
                window.localStorage.removeItem(key);
            else
                window.localStorage.setItem(key, String(val));
        } catch (e) {
            // storage unavailable (private mode / quota) - non-fatal
        }
    }

    // ---------- helpers ----------
    function esc(s) {
        return ('' + (s == null ? '' : s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escAttr(s) {
        return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtDate(ms) {
        if (!ms)
            return '-';
        try {
            return DateTimeUtils.formatDate(ms);
        } catch (e) {
            return '' + ms;
        }
    }
    function fmtDayLabel(d) {
        const s = '' + d;
        return s.length === 8 ? (s.slice(4, 6) + '/' + s.slice(6, 8)) : s;
    }
    function fmtBytes(bytes) {
        if (bytes == null)
            return '0 B';
        const u = ['B', 'KB', 'MB', 'GB', 'TB'];
        let n = Number(bytes) || 0;
        let i = 0;
        while (n >= 1024 && i < u.length - 1) {
            n /= 1024;
            i++;
        }
        return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
    }
    function fmtHour(hour) {
        return ('' + hour).padStart(2, '0') + ':00';
    }
    function fmtCount(n) {
        return (Number(n) || 0).toLocaleString();
    }
    function setSubTitle(id, text) {
        const el = $$(id) && $$(id).element ? $$(id).element : document.getElementById(id);
        if (!el)
            return;
        if (text)
            el.setAttribute('title', text);
        else
            el.removeAttribute('title');
    }
    function pick(row, ...keys) {
        for (const k of keys)
            if (row && row[k] != null)
                return row[k];
        return null;
    }
    function normalizeRows(rows, spec) {
        return (rows || []).map((r) => {
            const out = {};
            for (const key of Object.keys(spec))
                out[key] = pick(r, ...spec[key]);
            return out;
        });
    }
    function initials(name) {
        const parts = ('' + (name || '?')).trim().split(/[\s._-]+/).filter(Boolean);
        if (!parts.length)
            return '?';
        return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
    }
    function isAnonymousUser(name) {
        const v = ('' + (name || '')).trim().toLowerCase();
        return !v || v === '(anonymous)' || v === 'anonymous' || v === 'unknown user';
    }
    function workingCopyUserCell(name, repoTag) {
        if (isAnonymousUser(name)) {
            return '<div class="wc-user wc-user-anon">' +
                '<span class="wc-user-text"><span class="wc-anon-label">Anonymous checkout</span>' +
                '<span class="wc-anon-meta">No SVN user</span>' + repoTag + '</span>' +
            '</div>';
        }
        return '<div class="wc-user"><span class="wc-av">' + esc(initials(name)) + '</span>' +
            '<span class="wc-user-text">' + esc(name) + repoTag + '</span></div>';
    }
    function sparkline(vals, color) {
        if (!vals || !vals.length)
            return '';
        const w = 74, h = 26, pad = 2;
        const max = Math.max(1, ...vals);
        const step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
        const pts = vals.map((v, i) => {
            const x = pad + i * step;
            const y = h - pad - (v / max) * (h - pad * 2);
            return x.toFixed(1) + ',' + y.toFixed(1);
        });
        const area = 'M' + pts[0] + ' L' + pts.join(' L') +
            ' L' + (pad + (vals.length - 1) * step).toFixed(1) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';
        return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
            '<path d="' + area + '" fill="' + color + '" opacity="0.12"/>' +
            '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
            '</svg>';
    }
    function currentRange() {
        const today = DateUtils.today();
        if (rangeDays === 'custom') {
            const begin = customBeginDay || DateUtils.intAddDays(today, -30);
            const end = customEndDay || today;
            return {beginDay: begin, endDay: end, label: fmtDayLabel(begin) + '–' + fmtDayLabel(end), all: false};
        }
        const isAll = rangeDays >= 9999;
        return {
            beginDay: isAll ? 19900101 : DateUtils.intAddDays(today, -rangeDays),
            endDay: today,
            label: isAll ? 'all time' : 'last ' + rangeDays + ' days',
            all: isAll
        };
    }

    // ---------- loading / error state ----------
    function setLoading(on) {
        const body = document.getElementById('ins-body');
        if (body)
            body.classList.toggle('is-loading', !!on);
    }
    function showError(msg) {
        const el = document.getElementById('ins-error');
        if (!el)
            return;
        el.querySelector('.ins-error-text').textContent = msg ||
            'Something went wrong loading insights. Try again.';
        el.style.display = '';
    }
    function clearError() {
        const el = document.getElementById('ins-error');
        if (el)
            el.style.display = 'none';
    }

    // ---------- data loading ----------
    async function loadAll() {
        const val = scopedToRepo ? String(scopedRepoId) : $$('ins-repo').getValue();
        const isAgg = (val === 'all');
        const repoId = isAgg ? 0 : parseInt(val, 10);
        if (!isAgg && !repoId)
            return;

        const range = currentRange();
        const beginDay = range.beginDay;
        const endDay = range.endDay;
        const isAll = range.all;
        const numericDays = rangeDays === 'custom' ? Math.max(1, Math.round((endDay - beginDay) || 30)) : rangeDays;
        const prevBegin = (isAll || rangeDays === 'custom') ? 0 : DateUtils.intAddDays(DateUtils.today(), -2 * numericDays);
        const prevEnd = (isAll || rangeDays === 'custom') ? 0 : DateUtils.intAddDays(DateUtils.today(), -numericDays - 1);

        const seq = ++loadSeq;
        clearError();
        setLoading(true);

        let ins, act, contrib, fresh, contribPrev, detail;
        try {
            if (isAgg) {
                [ins, act, contrib, fresh, contribPrev, detail] = await Promise.all([
                    Server.call(WS_STATS, 'aggSummary', {beginDay: beginDay, endDay: endDay}),
                    Server.call(WS_STATS, 'aggActivityByDay', {}),
                    Server.call(WS_STATS, 'aggContributors', {beginDay: beginDay, endDay: endDay, limit: 6}),
                    Server.call(WS_STATS, 'aggFreshness', {}),
                    (isAll || rangeDays === 'custom') ? Promise.resolve({_Success: false}) : Server.call(WS_STATS, 'aggContributors', {beginDay: prevBegin, endDay: prevEnd, limit: 50}),
                    Server.call(WS_STATS, 'aggActivityDetail', {beginDay: beginDay, endDay: endDay, staleDays: 14, limit: 12})
                ]);
            } else {
                [ins, act, contrib, fresh, contribPrev, detail] = await Promise.all([
                    Server.call(WS_STATS, 'insights', {repoId: repoId, beginDay: beginDay, endDay: endDay}),
                    Server.call(WS_STATS, 'activityByDay', {repoId: repoId}),
                    Server.call(WS_STATS, 'contributors', {repoId: repoId, beginDay: beginDay, endDay: endDay, limit: 6}),
                    Server.call(WS_STATS, 'freshness', {repoId: repoId}),
                    (isAll || rangeDays === 'custom') ? Promise.resolve({_Success: false}) : Server.call(WS_STATS, 'contributors', {repoId: repoId, beginDay: prevBegin, endDay: prevEnd, limit: 50}),
                    Server.call(WS_STATS, 'activityDetail', {repoId: repoId, beginDay: beginDay, endDay: endDay, staleDays: 14, limit: 12})
                ]);
            }
        } catch (e) {
            if (seq !== loadSeq)
                return;
            setLoading(false);
            showError('Could not reach the server. Check your connection and try again.');
            return;
        }

        // A newer load started while these requests were in flight; drop this
        // stale response so it never paints over fresher data.
        if (seq !== loadSeq)
            return;

        setLoading(false);

        if (!ins._Success) {
            showError('No insight data is available for this selection.');
            return;
        }

        // Only advance the range label once we actually have data for it.
        document.getElementById('cadence-range-label').textContent = '(' + range.label + ')';

        // The framework's fetchAllJSON lowercases result keys, so normalize the
        // two SQL-sourced arrays back to the camelCase the renderers expect.
        const freshRows = fresh._Success ? (fresh.rows || []).map((r) => ({
            userName: r.username,
            repoName: r.reponame,
            lastSyncedRevision: r.lastsyncedrevision,
            headRevision: r.headrevision,
            revisionsBehind: Number(r.revisionsbehind) || 0,
            clientHost: r.clienthost,
            lastSyncTs: r.lastsyncts,
            lastActivityTs: r.lastactivityts
        })) : [];
        const contribRows = contrib._Success ? (contrib.rows || []).map((r) => ({
            userName: r.username,
            handle: r.handle,
            commits: Number(r.commits) || 0,
            checkouts: Number(r.checkouts) || 0,
            updates: Number(r.updates) || 0
        })).filter((r) => r.commits > 0) : [];

        const priorRows = (contribPrev && contribPrev._Success) ? (contribPrev.rows || [])
            .map((r) => ({commits: Number(r.commits) || 0}))
            .filter((r) => r.commits > 0) : [];

        const prior = priorRows.length ? {
            commits: priorRows.reduce((s, r) => s + r.commits, 0),
            contributors: priorRows.length
        } : null;

        renderKpis(ins, contribRows, freshRows, act, beginDay, endDay, prior, isAgg);
        renderCadence(act._Success ? act.rows : [], beginDay, endDay);
        renderFreshness(freshRows);
        renderContributors(contribRows);
        renderLifecycle(ins, isAgg);
        renderActivityDetail(detail._Success ? detail : {}, isAgg);
        renderWorkingCopies(freshRows, isAgg);
    }

    function cadenceRows(rows, beginDay, endDay) {
        const inRange = (rows || [])
            .filter((r) => r.day >= beginDay && r.day <= endDay)
            .sort((a, b) => Number(a.day) - Number(b.day));
        if (!inRange.length)
            return [];

        const startDay = beginDay <= 19900101 ? Number(inRange[0].day) : beginDay;
        if (DateUtils.julian(endDay) - DateUtils.julian(startDay) > 3700)
            return inRange;

        const byDay = {};
        inRange.forEach((r) => {
            byDay[r.day] = {
                day: Number(r.day),
                reads: Number(r.reads) || 0,
                writes: Number(r.writes) || 0
            };
        });

        const out = [];
        for (let day = startDay; day <= endDay; day = DateUtils.intAddDays(day, 1)) {
            out.push(byDay[day] || {day: day, reads: 0, writes: 0});
        }
        return out;
    }

    function dailyWrites(rows, beginDay, endDay) {
        return cadenceRows(rows, beginDay, endDay)
            .map((r) => Number(r.writes) || 0);
    }

    function setDelta(id, cur, prev) {
        const el = document.getElementById(id);
        if (!el)
            return;
        if (prev == null || prev <= 0) {
            el.textContent = '';
            el.className = 'kpi-delta';
            return;
        }
        const pct = Math.round(((cur - prev) / prev) * 100);
        if (pct > 0) {
            el.textContent = '▲ ' + pct + '%';
            el.className = 'kpi-delta up';
        } else if (pct < 0) {
            el.textContent = '▼ ' + (-pct) + '%';
            el.className = 'kpi-delta down';
        } else {
            el.textContent = '± 0%';
            el.className = 'kpi-delta flat';
        }
    }
    function cumulative(vals) {
        let sum = 0;
        return (vals || []).map((v) => {
            sum += (Number(v) || 0);
            return sum;
        });
    }

    // ---------- renderers ----------
    function renderKpis(ins, contribRows, freshRows, act, beginDay, endDay, prior, isAgg) {
        const commits = Number(ins.commits) || 0;
        const contributors = contribRows.length;
        const copies = freshRows.length || (Number(ins.cloneCount) || 0);
        const behind = freshRows.filter((r) => r.revisionsBehind > 0).length;
        const priorNote = prior ? ('vs prior ' + rangeDays + ' days') : null;

        const commitsDetail = commits + ' commits · ' + (Number(ins.checkouts) || 0) + ' checkouts';
        const contribDetail = (Number(ins.uniqueCommitUsers) || 0) + ' committed in range';

        $$('kpi-commits').setValue(fmtCount(commits));
        setDelta('kpi-commits-delta', commits, prior ? prior.commits : null);
        $$('kpi-commits-sub').setValue(priorNote || commitsDetail);
        setSubTitle('kpi-commits-sub', priorNote ? commitsDetail : null);
        $$('kpi-contributors').setValue(fmtCount(contributors));
        setDelta('kpi-contributors-delta', contributors, prior ? prior.contributors : null);
        $$('kpi-contributors-sub').setValue(priorNote || contribDetail);
        setSubTitle('kpi-contributors-sub', priorNote ? contribDetail : null);
        $$('kpi-clones').setValue(fmtCount(copies));
        $$('kpi-clones-sub').setValue(behind ? (behind + ' behind HEAD') : 'all up to date');

        const w = act._Success ? dailyWrites(act.rows, beginDay, endDay) : [];
        document.getElementById('spark-commits').innerHTML = sparkline(w, COL.write);

        const headSpark = document.getElementById('spark-head');
        if (isAgg) {
            document.getElementById('kpi-head-label').textContent = 'Repositories';
            $$('kpi-head').setValue(fmtCount(Number(ins.repoCount) || 0));
            $$('kpi-head-sub').setValue(fmtCount(Number(ins.totalRevisions) || 0) + ' total revisions');
            if (headSpark)
                headSpark.innerHTML = '';
        } else {
            document.getElementById('kpi-head-label').textContent = 'Current revision';
            $$('kpi-head').setValue('r' + (Number(ins.headRevision) || 0));
            $$('kpi-head-sub').setValue(ins.lastCommitTs ? ('last commit ' + fmtDate(ins.lastCommitTs)) : (Number(ins.fileCount) || 0) + ' files');
            if (headSpark)
                headSpark.innerHTML = sparkline(cumulative(w), COL.write);
        }
    }

    function renderActivityDetail(detail, isAgg) {
        const by = detail.byCategory || {};
        const total = Number(detail.totalEvents) || 0;
        $$('activity-total').setValue(fmtCount(total));
        document.getElementById('activity-users').textContent = fmtCount(Number(detail.distinctUsers) || 0);
        document.getElementById('activity-clients').textContent = fmtCount(Number(detail.distinctClients) || 0);
        document.getElementById('activity-bytes').textContent = fmtBytes(detail.bytes || by.bytes || 0);

        const adoption = detail.revisionAdoption || {};
        const adHost = document.getElementById('revision-adoption');
        if (isAgg || !adoption.revision) {
            adHost.style.display = 'none';
        } else {
            adHost.style.display = '';
            const adopters = Number(adoption.adopters) || 0;
            const totalUsers = Number(adoption.totalUsers) || 0;
            document.getElementById('activity-adoption').textContent =
                totalUsers ? (adopters + '/' + totalUsers + ' at r' + adoption.revision) : 'no reads yet';
        }

        const cats = [
            ['Checkout', 'checkout', COL.read],
            ['Update', 'update', '#2c7a72'],
            ['Switch', 'switch', '#3a4f86'],
            ['Browse', 'browse', '#809cc9'],
            ['Commit', 'commit', COL.write],
            ['Other', 'other', COL.tick]
        ];
        const max = Math.max(1, ...cats.map((c) => Number(by[c[1]]) || 0));
        document.getElementById('activity-mix').innerHTML = cats.map(([label, key, color]) => {
            const n = Number(by[key]) || 0;
            const pct = Math.max(2, Math.round((n / max) * 100));
            return '<div class="activity-bar-row">' +
                '<span class="activity-label">' + esc(label) + '</span>' +
                '<span class="activity-bar"><span style="width:' + pct + '%; background:' + color + '"></span></span>' +
                '<span class="activity-num mono">' + n + '</span>' +
            '</div>';
        }).join('');

        renderCheckoutMix(normalizeRows(detail.checkoutVsUpdate, {
            userName: ['userName', 'username'],
            checkouts: ['checkouts'],
            updates: ['updates'],
            switches: ['switches'],
            commits: ['commits'],
            events: ['events']
        }));
        renderCloneActivity(normalizeRows(detail.cloneActivity, {
            repoName: ['repoName', 'reponame'],
            userName: ['userName', 'username'],
            clientHost: ['clientHost', 'clienthost'],
            clonedTs: ['clonedTs', 'clonedts'],
            syncedRevision: ['syncedRevision', 'syncedrevision'],
            checkouts: ['checkouts'],
            updates: ['updates'],
            events: ['events']
        }), isAgg);
        renderHotPaths(normalizeRows(detail.hotPaths, {
            path: ['path'],
            hits: ['hits'],
            bytes: ['bytes'],
            lastTs: ['lastTs', 'lastts']
        }));
        renderClientLoad(normalizeRows(detail.clientLoad, {
            clientHost: ['clientHost', 'clienthost'],
            events: ['events'],
            reads: ['reads'],
            writes: ['writes'],
            bytes: ['bytes'],
            lastTs: ['lastTs', 'lastts']
        }));
        renderStaleCopies(normalizeRows(detail.staleWorkingCopies, {
            repoName: ['repoName', 'reponame'],
            userName: ['userName', 'username'],
            clientHost: ['clientHost', 'clienthost'],
            lastActivityTs: ['lastActivityTs', 'lastactivityts'],
            lastSyncedRevision: ['lastSyncedRevision', 'lastsyncedrevision'],
            revisionsBehind: ['revisionsBehind', 'revisionsbehind']
        }), isAgg, Number(detail.staleDays) || 14);
        renderHeatmap(detail.heatmap || []);
    }

    function renderCheckoutMix(rows) {
        const host = document.getElementById('checkout-mix');
        if (!rows.length) {
            host.innerHTML = '<p class="muted empty-note">No checkout or update activity in range.</p>';
            return;
        }
        const max = Math.max(1, ...rows.map((r) => (Number(r.checkouts) || 0) + (Number(r.updates) || 0) + (Number(r.switches) || 0)));
        host.innerHTML = rows.map((r) => {
            const c = Number(r.checkouts) || 0;
            const u = Number(r.updates) || 0;
            const s = Number(r.switches) || 0;
            const total = Math.max(1, c + u + s);
            const nums = s > 0 ? (c + ' / ' + u + ' / ' + s) : (c + ' / ' + u);
            return '<div class="mix-row">' +
                '<div class="mix-top"><span>' + esc(r.userName || 'Unknown user') + '</span><span class="mono">' + nums + '</span></div>' +
                '<div class="stack-bar" style="max-width:' + Math.max(18, Math.round((total / max) * 100)) + '%">' +
                    '<span class="stack-checkout" style="width:' + Math.round((c / total) * 100) + '%"></span>' +
                    '<span class="stack-update" style="width:' + Math.round((u / total) * 100) + '%"></span>' +
                    '<span class="stack-switch" style="width:' + Math.round((s / total) * 100) + '%"></span>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // Renders capped table rows into a tbody with a "Show all N" / "Show fewer"
    // toggle. `rowHtml(row)` returns one <tr>. `colspan` sizes the toggle cell.
    function renderCappedRows(tbody, rows, cap, colspan, rowHtml) {
        let expanded = false;
        function paint() {
            const visible = expanded ? rows : rows.slice(0, cap);
            let html = visible.map(rowHtml).join('');
            if (rows.length > cap) {
                const label = expanded
                    ? 'Show fewer'
                    : 'Show all ' + fmtCount(rows.length);
                html += '<tr class="tbl-toggle-row"><td colspan="' + colspan + '">' +
                    '<button type="button" class="tbl-toggle">' + esc(label) + '</button></td></tr>';
            }
            tbody.innerHTML = html;
            const btn = tbody.querySelector('.tbl-toggle');
            if (btn)
                btn.addEventListener('click', () => {
                    expanded = !expanded;
                    paint();
                });
        }
        paint();
    }

    function renderCloneActivity(rows, isAgg) {
        $$('clone-activity-count').setValue(fmtCount(rows.length));
        const body = document.getElementById('clone-tbody');
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center; padding:18px;">No checkout/export activity in range.</td></tr>';
            return;
        }
        const sorted = rows.slice().sort((a, b) => (Number(b.clonedTs) || 0) - (Number(a.clonedTs) || 0));
        renderCappedRows(body, sorted, 8, 4, (r) => {
            const repoTag = isAgg && r.repoName ? '<span class="wc-repo mono">' + esc(r.repoName) + '</span>' : '';
            return '<tr>' +
                '<td>' + workingCopyUserCell(r.userName, repoTag) + '</td>' +
                '<td class="mono muted">' + esc(r.clientHost || '—') + '</td>' +
                '<td class="num mono">r' + esc(r.syncedRevision == null ? '?' : r.syncedRevision) + '</td>' +
                '<td class="muted">' + esc(fmtDate(r.clonedTs)) + '</td>' +
            '</tr>';
        });
    }

    function renderHotPaths(rows) {
        const host = document.getElementById('hot-paths');
        if (!rows.length) {
            host.innerHTML = '<p class="muted empty-note">No read paths in range.</p>';
            return;
        }
        const max = Math.max(1, ...rows.map((r) => Number(r.hits) || 0));
        host.innerHTML = rows.map((r) =>
            '<div class="rank-row">' +
                '<span class="rank-main">' + esc(r.path || '—') + '</span>' +
                '<span class="rank-num">' + esc(r.hits || 0) + '</span>' +
                '<span class="rank-track"><span style="width:' + Math.max(4, Math.round(((Number(r.hits) || 0) / max) * 100)) + '%"></span></span>' +
            '</div>').join('');
    }

    function renderClientLoad(rows) {
        const host = document.getElementById('client-load');
        if (!rows.length) {
            host.innerHTML = '<p class="muted empty-note">No client activity in range.</p>';
            return;
        }
        const max = Math.max(1, ...rows.map((r) => Number(r.events) || 0));
        host.innerHTML = rows.map((r) =>
            '<div class="rank-row">' +
                '<span class="rank-main mono">' + esc(r.clientHost || 'unknown') + '</span>' +
                '<span class="rank-num">' + esc(r.events || 0) + '</span>' +
                '<span class="rank-sub">' + esc((Number(r.reads) || 0) + ' reads · ' + (Number(r.writes) || 0) + ' writes') + '</span>' +
                '<span class="rank-track"><span style="width:' + Math.max(4, Math.round(((Number(r.events) || 0) / max) * 100)) + '%"></span></span>' +
            '</div>').join('');
    }

    function renderStaleCopies(rows, isAgg, staleDays) {
        $$('stale-days').setValue(String(staleDays));
        const host = document.getElementById('stale-list');
        if (!rows.length) {
            host.innerHTML = '<p class="muted empty-note">No stale working copies.</p>';
            return;
        }
        host.innerHTML = rows.map((r) => {
            const repoTag = isAgg && r.repoName ? '<span class="wc-repo mono">' + esc(r.repoName) + '</span>' : '';
            return '<div class="stale-row">' +
                '<div><strong>' + esc(r.userName || 'Unknown user') + '</strong>' + repoTag + '</div>' +
                '<span class="mono">r' + esc(r.lastSyncedRevision == null ? '?' : r.lastSyncedRevision) + '</span>' +
                '<span class="fresh-pill ' + ((Number(r.revisionsBehind) || 0) >= 3 ? 'fresh-far' : 'fresh-near') + '">' + esc((Number(r.revisionsBehind) || 0) + ' behind') + '</span>' +
                '<small>' + esc(fmtDate(r.lastActivityTs)) + '</small>' +
            '</div>';
        }).join('');
    }

    function renderHeatmap(cells) {
        const host = document.getElementById('read-heatmap');
        const max = Math.max(1, ...(cells || []).map((c) => Number(c.count) || 0));
        const byKey = {};
        (cells || []).forEach((c) => {
            byKey[c.dow + '-' + c.hour] = Number(c.count) || 0;
        });
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        let html = '<div class="heat-hours"><span></span><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>';
        days.forEach((day, idx) => {
            const dow = idx + 1;
            html += '<div class="heat-row"><span class="heat-day">' + day + '</span>';
            for (let h = 0; h < 24; h++) {
                const n = byKey[dow + '-' + h] || 0;
                const alpha = n ? (0.12 + 0.78 * (n / max)).toFixed(2) : null;
                const windowLabel = day + ' ' + fmtHour(h) + '-' + fmtHour((h + 1) % 24);
                const countLabel = n + ' read' + (n === 1 ? '' : 's');
                const tip = windowLabel + ' · ' + countLabel;
                html += '<span class="heat-cell" tabindex="0" role="img" data-tip="' + escAttr(tip) + '" data-heat-window="' + escAttr(windowLabel) + '" data-heat-count="' + escAttr(countLabel) + '" aria-label="' + escAttr(tip) + '"' +
                    (alpha ? ' style="background:rgba(31,93,87,' + alpha + ')"' : '') + '></span>';
            }
            html += '</div>';
        });
        host.innerHTML = html;
    }

    function resizeInsightCharts() {
        try {
            if (cadenceChart)
                cadenceChart.resize();
            if (freshnessChart)
                freshnessChart.resize();
        } catch (e) {
            // Chart.js may not be ready during first paint; the next data load will size it.
        }
    }

    function initInsightSections() {
        SvnHubUI.initExpandableSections({
            sectionSelector: '.ins-section',
            headSelector: '.ins-section-head',
            bodySelector: '.ins-section-body',
            storageKey: scopedToRepo ? null : LS.collapsed,
            onExpanded: resizeInsightCharts
        });
    }

    function initHeatmapTooltip() {
        const host = document.getElementById('read-heatmap');
        const tip = document.getElementById('heat-tooltip');
        if (!host || !tip)
            return;
        let activeCell = null;

        function hide() {
            activeCell = null;
            tip.classList.remove('show');
            tip.setAttribute('aria-hidden', 'true');
        }
        function showFor(cell, x, y) {
            if (cell !== activeCell) {
                activeCell = cell;
                tip.innerHTML = '<strong>' + esc(cell.dataset.heatWindow || '') + '</strong><span>' + esc(cell.dataset.heatCount || '') + '</span>';
                tip.classList.add('show');
                tip.setAttribute('aria-hidden', 'false');
            }
            const pad = 14;
            const maxX = Math.max(12, window.innerWidth - 240);
            const maxY = Math.max(12, window.innerHeight - 78);
            tip.style.left = Math.min(x + pad, maxX) + 'px';
            tip.style.top = Math.min(y + pad, maxY) + 'px';
        }
        host.addEventListener('mousemove', (e) => {
            const cell = e.target.closest('.heat-cell');
            if (!cell || !host.contains(cell)) {
                hide();
                return;
            }
            showFor(cell, e.clientX, e.clientY);
        });
        host.addEventListener('mouseleave', hide);
        // Keyboard / touch: anchor the tooltip to the focused cell's rect so
        // non-mouse users get the same detail.
        host.addEventListener('focusin', (e) => {
            const cell = e.target.closest('.heat-cell');
            if (!cell || !host.contains(cell))
                return;
            const rect = cell.getBoundingClientRect();
            showFor(cell, rect.left + rect.width / 2, rect.bottom);
        });
        host.addEventListener('focusout', (e) => {
            if (!host.contains(e.relatedTarget))
                hide();
        });
    }

    function renderCadence(rows, beginDay, endDay) {
        const inRange = cadenceRows(rows, beginDay, endDay);
        const labels = inRange.map((r) => fmtDayLabel(r.day));
        const reads = inRange.map((r) => Number(r.reads) || 0);
        const writes = inRange.map((r) => Number(r.writes) || 0);
        const holder = document.getElementById('cadence-chart').parentNode;
        const hasData = inRange.length > 0 && (reads.some((v) => v > 0) || writes.some((v) => v > 0));
        const singlePoint = labels.length === 1;
        let note = holder.querySelector('.chart-empty');
        if (!hasData) {
            if (!note) {
                note = document.createElement('p');
                note.className = 'muted empty-note chart-empty';
                note.textContent = 'No activity in this range.';
                holder.appendChild(note);
            }
        } else if (note) {
            note.remove();
        }
        const ctx = document.getElementById('cadence-chart').getContext('2d');
        if (cadenceChart)
            cadenceChart.destroy();
        cadenceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {label: 'Reads', data: reads, borderColor: COL.read, backgroundColor: COL.readFill, fill: true, tension: 0.32, borderWidth: 2, pointRadius: singlePoint ? 3 : 0, pointHoverRadius: 3},
                    {label: 'Writes', data: writes, borderColor: COL.write, backgroundColor: COL.writeFill, fill: true, tension: 0.32, borderWidth: 2, pointRadius: singlePoint ? 3 : 0, pointHoverRadius: 3}
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: {mode: 'index', intersect: false},
                plugins: {legend: {display: false}, tooltip: {backgroundColor: '#1c1a16', padding: 10, cornerRadius: 8, titleFont: {family: 'JetBrains Mono'}}},
                scales: {
                    x: {grid: {display: false}, ticks: {color: COL.tick, maxTicksLimit: 8, font: {size: 10, family: 'JetBrains Mono'}}},
                    y: {beginAtZero: true, grid: {color: COL.grid}, ticks: {color: COL.tick, precision: 0, font: {size: 10, family: 'JetBrains Mono'}}}
                }
            }
        });
    }

    function renderFreshness(rows) {
        const upToDate = rows.filter((r) => Number(r.revisionsBehind) <= 0).length;
        const near = rows.filter((r) => Number(r.revisionsBehind) >= 1 && Number(r.revisionsBehind) <= 2).length;
        const far = rows.filter((r) => Number(r.revisionsBehind) >= 3).length;
        const total = rows.length;
        const pct = total ? Math.round((upToDate / total) * 100) : 0;
        $$('fresh-pct').setValue(total ? (pct + '%') : '–');

        const legend = [
            {label: 'Up to date', n: upToDate, c: COL.fresh},
            {label: '1–2 behind', n: near, c: COL.near},
            {label: '3+ behind', n: far, c: COL.far}
        ];
        document.getElementById('fresh-legend').innerHTML = legend.map((l) =>
            '<div class="dl-item"><span class="dl-swatch" style="background:' + l.c + '"></span>' +
            '<span class="dl-label">' + l.label + '</span><span class="dl-num">' + l.n + '</span></div>').join('');

        const ctx = document.getElementById('freshness-chart').getContext('2d');
        if (freshnessChart)
            freshnessChart.destroy();
        freshnessChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: legend.map((l) => l.label),
                datasets: [{data: total ? legend.map((l) => l.n) : [1], backgroundColor: total ? legend.map((l) => l.c) : ['#e3dac6'], borderColor: '#fffdf8', borderWidth: 3, hoverOffset: 4}]
            },
            options: {responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: {legend: {display: false}, tooltip: {enabled: total > 0, backgroundColor: '#1c1a16', padding: 10, cornerRadius: 8}}}
        });
    }

    function renderContributors(rows) {
        document.getElementById('contributors-list').innerHTML = SvnHubUI.contributorBars(rows);
    }

    function renderLifecycle(ins, isAgg) {
        const card = document.getElementById('lifecycle-card');
        const grid = document.getElementById('contrib-grid');
        if (isAgg) {
            // branches/tags are a per-repository concept; drop the panel and let
            // the contributors card use the full width.
            if (card)
                card.style.display = 'none';
            if (grid)
                grid.classList.add('single');
            return;
        }
        if (card)
            card.style.display = '';
        if (grid)
            grid.classList.remove('single');
        $$('ins-branch-count').setValue(String(ins.branchCount || 0));
        $$('ins-tag-count').setValue(String(ins.tagCount || 0));
        renderRefList('branch-list', ins.branches || [], 'No branches.');
        renderRefList('tag-list', ins.tags || [], 'No tags.');
    }
    function renderRefList(id, items, empty) {
        const host = document.getElementById(id);
        if (!items.length) {
            host.innerHTML = '<p class="muted" style="padding:4px 2px; font-size:13px;">' + empty + '</p>';
            return;
        }
        host.innerHTML = items.slice(0, 8).map((b) =>
            '<div class="ref-row">' +
                '<span class="ref-name mono">' + esc(b.name) + '</span>' +
                '<span class="ref-meta">' + esc(b.author || '') + '</span>' +
                '<span class="rev-pill">r' + esc(b.revision) + '</span>' +
            '</div>').join('');
    }

    function renderWorkingCopies(rows, isAgg) {
        $$('ins-clone-count').setValue(fmtCount(rows.length));
        const body = document.getElementById('wc-tbody');
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center; padding:22px;">No working copies have checked out yet.</td></tr>';
            return;
        }
        const sorted = rows.slice().sort((a, b) => {
            const bd = (Number(b.revisionsBehind) || 0) - (Number(a.revisionsBehind) || 0);
            if (bd !== 0)
                return bd;
            return (Number(b.lastActivityTs || b.lastSyncTs) || 0) - (Number(a.lastActivityTs || a.lastSyncTs) || 0);
        });
        renderCappedRows(body, sorted, 10, 5, (r) => {
            const behind = Number(r.revisionsBehind) || 0;
            let cls = 'fresh-ok', label = 'up to date';
            if (behind >= 3) {
                cls = 'fresh-far';
                label = behind + ' behind';
            } else if (behind >= 1) {
                cls = 'fresh-near';
                label = behind + ' behind';
            } else if (behind < 0) {
                cls = 'fresh-near';
                label = (-behind) + ' ahead';
            }
            const repoTag = (isAgg && r.repoName) ? '<span class="wc-repo mono">' + esc(r.repoName) + '</span>' : '';
            return '<tr>' +
                '<td>' + workingCopyUserCell(r.userName, repoTag) + '</td>' +
                '<td class="mono muted">' + esc(r.clientHost || '—') + '</td>' +
                '<td class="num mono">r' + esc(r.lastSyncedRevision == null ? '?' : r.lastSyncedRevision) + '</td>' +
                '<td><span class="fresh-pill ' + cls + '">' + esc(label) + '</span></td>' +
                '<td class="muted">' + esc(fmtDate(r.lastActivityTs || r.lastSyncTs)) + '</td>' +
            '</tr>';
        });
    }

    // ---------- controls ----------
    const rangeBtns = {7: 'rng-7', 30: 'rng-30', 90: 'rng-90', 9999: 'rng-all', custom: 'rng-custom'};
    function updateRangeThumb(active) {
        const seg = document.getElementById('range-seg');
        const id = rangeBtns[active];
        if (!seg || !id)
            return;
        const btn = $$(id).element;
        if (!btn)
            return;
        const segRect = seg.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        seg.style.setProperty('--seg-thumb-x', Math.round(btnRect.left - segRect.left) + 'px');
        seg.style.setProperty('--seg-thumb-width', Math.round(btnRect.width) + 'px');
        seg.classList.add('seg-ready');
    }
    function syncRangeButtons(active) {
        for (const d in rangeBtns)
            $$(rangeBtns[d]).element.classList.toggle('active', String(d) === String(active));
        const isCustom = active === 'custom';
        const custom = document.getElementById('custom-range');
        const control = document.querySelector('.range-control');
        if (custom) {
            custom.setAttribute('aria-hidden', isCustom ? 'false' : 'true');
            custom.inert = !isCustom;
        }
        if (control)
            control.classList.toggle('custom-open', isCustom);
        window.requestAnimationFrame(() => updateRangeThumb(active));
    }
    function setRange(days) {
        rangeDays = days;
        lsSet(LS.range, days);
        syncRangeButtons(days);
        loadAll();
    }
    function showCustomRange() {
        const today = DateUtils.today();
        rangeDays = 'custom';
        if (!customBeginDay)
            customBeginDay = DateUtils.intAddDays(today, -30);
        if (!customEndDay)
            customEndDay = today;
        $$('rng-start').setValue(customBeginDay);
        $$('rng-end').setValue(customEndDay);
        syncRangeButtons('custom');
        window.requestAnimationFrame(() => $$('rng-start').focus());
    }
    function applyCustomRange() {
        const begin = $$('rng-start').getIntValue();
        const end = $$('rng-end').getIntValue();
        if (!begin || !end) {
            Utils.showMessage('Date range', 'Choose both a start date and an end date.');
            return;
        }
        if (begin > end) {
            Utils.showMessage('Date range', 'The start date must be before the end date.');
            return;
        }
        customBeginDay = begin;
        customEndDay = end;
        rangeDays = 'custom';
        lsSet(LS.range, 'custom');
        lsSet(LS.customBegin, begin);
        lsSet(LS.customEnd, end);
        syncRangeButtons('custom');
        loadAll();
    }
    $$('rng-7').onclick(() => setRange(7));
    $$('rng-30').onclick(() => setRange(30));
    $$('rng-90').onclick(() => setRange(90));
    $$('rng-all').onclick(() => setRange(9999));
    $$('rng-custom').onclick(showCustomRange);
    $$('rng-apply').onclick(applyCustomRange);
    $$('rng-start').onEnter(applyCustomRange);
    $$('rng-end').onEnter(applyCustomRange);

    // Restore a previously chosen range (skipped when embedded in a repo).
    (function restoreRange() {
        const saved = lsGet(LS.range);
        if (!saved)
            return;
        if (saved === 'custom') {
            const b = parseInt(lsGet(LS.customBegin), 10);
            const e = parseInt(lsGet(LS.customEnd), 10);
            if (b && e && b <= e) {
                customBeginDay = b;
                customEndDay = e;
                rangeDays = 'custom';
                $$('rng-start').setValue(b);
                $$('rng-end').setValue(e);
            }
        } else if (rangeBtns[saved]) {
            rangeDays = saved === '9999' ? 9999 : parseInt(saved, 10);
        }
    })();

    syncRangeButtons(rangeDays);
    window.addEventListener('resize', () => updateRangeThumb(rangeDays));

    // ---------- init ----------
    initInsightSections();
    initHeatmapTooltip();

    const retryBtn = document.getElementById('ins-error-retry');
    if (retryBtn)
        retryBtn.addEventListener('click', () => {
            clearError();
            loadAll();
        });

    if (Utils.setAppNavActive)
        Utils.setAppNavActive('insights');

    if (scopedToRepo) {
        $$('ins-repo').clear();
        $$('ins-repo').add(String(scopedRepoId), scopedRepoName);
        $$('ins-repo').setValue(String(scopedRepoId));
        $$('ins-repo').hide();
        document.querySelector('.insights-controls').classList.add('repo-scoped');
        await loadAll();
        return;
    }

    $$('ins-repo').clear();
    $$('ins-repo').add('all', 'All repositories');
    $$('ins-repo').setValue('all');

    const repos = await Server.call(WS_REPO, 'getRepositories');
    const haveRepos = repos._Success && repos.rows && repos.rows.length;
    if (!haveRepos) {
        document.getElementById('ins-body').style.display = 'none';
        document.getElementById('ins-empty').style.display = 'block';
        return;
    }

    for (const r of repos.rows) {
        $$('ins-repo').add(String(r.repoId), r.name);
        repoNames[r.repoId] = r.name;
    }
    // Repository selection is per visit; keep global Insights on the aggregate view.
    lsSet(LS.repo, null);
    $$('ins-repo').setValue('all');
    $$('ins-repo').onChange(() => {
        loadAll();
    });

    await loadAll();

})();
