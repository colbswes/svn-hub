/* global $$, Utils, Server, DateTimeUtils, SvnHubUI */
'use strict';

(async function () {

    const WS_REPO = 'services/RepositoryService';

    let repoRows = [];
    let recentCount = 0;
    let activityCount = 0;

    function esc(val) {
        const div = document.createElement('div');
        div.textContent = val == null ? '' : String(val);
        return div.innerHTML;
    }

    function fmtDate(ms) {
        return ms ? DateTimeUtils.formatDate(ms) : 'No revisions yet';
    }

    function fmtAge(ms) {
        if (!ms)
            return '';
        const mins = Math.floor((Date.now() - Number(ms)) / 60000);
        if (mins < 60)
            return mins <= 1 ? 'just now' : mins + 'm ago';
        const hours = Math.floor(mins / 60);
        if (hours < 24)
            return hours + 'h ago';
        const days = Math.floor(hours / 24);
        if (days < 30)
            return days + 'd ago';
        return SvnHubUI.fmtDate(ms);
    }

    function fmtDayLabel(day) {
        const s = String(day);
        return s.length === 8 ? s.slice(4, 6) + '/' + s.slice(6, 8) : s;
    }

    function toRow(r) {
        return Object.assign({}, r, {
            description: r.description || 'No description provided.',
            defaultBranch: r.defaultBranch || 'trunk'
        });
    }

    function repoById(id) {
        return repoRows.find((r) => r.repoId === Number(id)) || null;
    }

    // ---- rendering ----
    function renderRepoCards(rows) {
        const list = document.getElementById('repo-card-list');
        if (!list)
            return;

        if (!rows.length) {
            list.innerHTML = '<div class="card card-pad repo-empty"><h3>No repositories yet</h3><p class="muted">Create a repository in your namespace to get started.</p></div>';
            return;
        }

        const shown = rows.slice(0, 6);
        list.innerHTML = shown.map((row) => SvnHubUI.repoCard(row)).join('');
    }

    function updatePillCounts() {
        // no pill counts on the overview page
    }

    async function loadProfile() {
        const handle = Utils.getData('handle') || '';
        document.getElementById('repo-prof-avatar').textContent = handle ? handle.substring(0, 2).toUpperCase() : 'SV';
        $$('repo-prof-handle').setValue(handle);
        const prof = await Server.call('services/DiscoverService', 'getProfile', {handle: handle, page: 0, pageSize: 1});
        $$('repo-prof-name').setValue((prof._Success && prof.profile && prof.profile.fullName) ? prof.profile.fullName : handle);
        const sum = await Server.call('services/StatsService', 'userSummary', {});
        if (sum._Success)
            document.getElementById('repo-prof-stats').innerHTML =
                SvnHubUI.statBlock(sum.reposOwned, 'repositories') +
                SvnHubUI.statBlock(sum.commits, 'commits') +
                SvnHubUI.statBlock(sum.checkouts, 'checkouts');
    }

    function applyFilter() {
        // No tab/filter UI on the overview — just render owned repos.
        renderRepoCards(repoRows);
    }

    async function loadMine() {
        const res = await Server.call(WS_REPO, 'getRepositories');
        if (!res._Success)
            return;
        repoRows = res.rows.map(toRow);
        updatePillCounts();
        applyFilter();
    }

    async function loadRecent() {
        const res = await Server.call(WS_REPO, 'getRecentRepositories', {limit: 4});
        const list = document.getElementById('home-recent-list');
        if (!list)
            return;
        if (!res._Success || !res.rows || !res.rows.length) {
            recentCount = 0;
            list.innerHTML = '<div class="card card-pad repo-empty"><h3>No recent activity yet</h3><p class="muted">Repositories you own or can read will show up here once they have revisions.</p></div>';
            return;
        }
        recentCount = res.rows.length;
        list.innerHTML = res.rows.map((row) => SvnHubUI.repoCard(toRow(row))).join('');
    }

    async function loadActivity() {
        const res = await Server.call(WS_REPO, 'getRecentActivity', {limit: 8});
        const list = document.getElementById('home-activity-list');
        if (!list)
            return;
        if (!res._Success || !res.rows || !res.rows.length) {
            activityCount = 0;
            list.innerHTML = '<div class="home-activity-empty muted">No commits have been recorded yet.</div>';
            return;
        }
        activityCount = res.rows.length;
        list.innerHTML = res.rows.map((c) => {
            const when = c.commitTs ? SvnHubUI.fmtDate(c.commitTs) : '';
            const author = c.author || '(unknown)';
            const msg = (c.message || '').split('\n')[0].trim();
            return '<button class="home-activity-row" data-repo-id="' + esc(c.repoId) +
                '" data-repo-key="' + esc(c.repoKey || '') + '" data-repo-name="' + esc(c.repoName || '') +
                '" data-revision="' + esc(c.revision) + '">' +
                    '<span class="home-activity-rev mono">r' + esc(c.revision) + '</span>' +
                    '<span class="home-activity-body">' +
                        '<span class="home-activity-msg">' + esc(msg || '(no message)') + '</span>' +
                        '<span class="home-activity-meta">' +
                            '<span class="home-activity-repo">' + esc(c.repoName || c.repoKey || '') + '</span>' +
                            '<span class="home-activity-author mono">@' + esc(author) + '</span>' +
                        '</span>' +
                    '</span>' +
                    '<span class="home-activity-when">' + esc(when) + '</span>' +
                '</button>';
        }).join('');
    }

    async function loadInsightsLite() {
        const el = document.getElementById('home-insights-chart');
        if (!el)
            return;
        const res = await Server.callQuiet('services/StatsService', 'userCommitSeries', {days: 30});
        if (!res._Success || !res.rows || !res.rows.length) {
            el.innerHTML = '<div class="home-activity-empty muted">No commit activity recorded yet.</div>';
            return;
        }
        const rows = res.rows;
        const total = rows.reduce((sum, r) => sum + (Number(r.commits) || 0), 0);
        if (!total) {
            el.innerHTML = '<div class="home-activity-empty muted">No commits in the last 30 days.</div>';
            return;
        }
        const max = Math.max(1, ...rows.map((r) => Number(r.commits) || 0));
        el.innerHTML =
            '<div class="home-ins-bars">' + rows.map((r) => {
                const n = Number(r.commits) || 0;
                const h = n ? Math.max(8, Math.round((n / max) * 100)) : 3;
                const tip = fmtDayLabel(r.day) + ': ' + n + (n === 1 ? ' commit' : ' commits');
                return '<span class="home-ins-bar' + (n ? '' : ' zero') + '" style="height:' + h + '%" title="' + esc(tip) + '"></span>';
            }).join('') + '</div>' +
            '<div class="home-ins-total muted">' + esc(total) + (total === 1 ? ' commit' : ' commits') + ' in the last 30 days</div>';
    }

    async function loadWorkingCopies() {
        const sumEl = document.getElementById('home-wc-summary');
        const list = document.getElementById('home-wc-list');
        if (!sumEl || !list)
            return;
        const res = await Server.callQuiet('services/StatsService', 'userWorkingCopySummary', {limit: 5, behindThreshold: 10});
        const total = res._Success ? (Number(res.totalCopies) || 0) : 0;
        if (!total) {
            sumEl.innerHTML = '';
            list.innerHTML = '<div class="home-activity-empty muted">No working copies tracked yet — stats appear once people check out your repositories.</div>';
            return;
        }
        const stale = Number(res.staleCopies) || 0;
        const threshold = Number(res.behindThreshold) || 10;
        sumEl.innerHTML =
            '<span class="home-wc-count">' + esc(total) + esc(total === 1 ? ' working copy tracked' : ' working copies tracked') + '</span>' +
            ' · ' +
            (stale
                ? '<span class="home-wc-stale">' + esc(stale) + esc(stale === 1 ? ' is ' : ' are ') + esc(threshold) + '+ revisions behind HEAD</span>'
                : '<span>all reasonably fresh</span>');
        const rows = res.rows || [];
        list.innerHTML = rows.map((r) => {
            const behind = Number(r.revisionsBehind) || 0;
            let cls = 'fresh-ok', label = 'up to date';
            if (behind >= threshold) {
                cls = 'fresh-far';
                label = behind + ' behind';
            } else if (behind >= 1) {
                cls = 'fresh-near';
                label = behind + ' behind';
            }
            return '<button class="home-wc-row" data-repo-id="' + esc(r.repoId) +
                '" data-repo-key="' + esc(r.repoKey || '') + '" data-repo-name="' + esc(r.repoName || '') + '">' +
                    '<span class="home-wc-user">' + esc(r.userName || '(unknown)') + '</span>' +
                    '<span class="home-wc-repo mono">' + esc(r.repoName || '') + '</span>' +
                    '<span class="fresh-pill ' + cls + '">' + esc(label) + '</span>' +
                    '<span class="home-wc-when">' + esc(fmtAge(r.lastActivityTs || r.lastSyncTs)) + '</span>' +
                '</button>';
        }).join('');
    }

    async function loadAttention() {
        const sumEl = document.getElementById('home-attention-summary');
        const list = document.getElementById('home-attention-list');
        if (!sumEl || !list)
            return;
        const res = await Server.callQuiet(WS_REPO, 'getAttentionItems', {limit: 5});
        const rows = (res._Success && res.rows) ? res.rows : [];
        if (!rows.length) {
            sumEl.innerHTML = '';
            list.innerHTML = '<div class="home-activity-empty muted">Nothing needs your attention.</div>';
            return;
        }
        const issues = Number(res.openIssues) || 0;
        const mrs = Number(res.openMergeRequests) || 0;
        sumEl.innerHTML = esc(issues) + esc(issues === 1 ? ' open issue' : ' open issues') +
            ' · ' + esc(mrs) + esc(mrs === 1 ? ' open merge request' : ' open merge requests');
        list.innerHTML = rows.map((r) => {
            const isIssue = r.type === 'issue';
            return '<button class="home-attn-row" data-repo-id="' + esc(r.repoId) +
                '" data-repo-key="' + esc(r.repoKey || '') + '" data-repo-name="' + esc(r.repoName || '') +
                '" data-section="' + (isIssue ? 'issues' : 'mrs') + '">' +
                    '<span class="home-attn-badge ' + (isIssue ? 'attn-issue' : 'attn-mr') + '">' + (isIssue ? 'Issue' : 'MR') + '</span>' +
                    '<span class="home-attn-body">' +
                        '<span class="home-attn-title">' + esc(r.title || '(untitled)') + '</span>' +
                        '<span class="home-attn-meta">' +
                            '<span>' + esc(r.repoName || r.repoKey || '') + '</span>' +
                            '<span class="mono">#' + esc(r.number) + '</span>' +
                        '</span>' +
                    '</span>' +
                    '<span class="home-attn-when">' + esc(fmtAge(r.createdTs)) + '</span>' +
                '</button>';
        }).join('');
    }

    function openRepo(row) {
        if (!row)
            return;
        Utils.saveData('repoId', row.repoId);
        Utils.saveData('repoKey', row.repoKey);
        Utils.saveData('repoName', row.name);
        Utils.saveData('repoReturnTo', dashboardOrigin);
        Utils.routePage('screens/Repository/Repository', 'app-screen-area');
    }

    function openRepoFromCard(card) {
        if (!card)
            return;
        const id = Number(card.getAttribute('data-repo-id'));
        const row = repoById(id) || {
            repoId: id,
            repoKey: card.getAttribute('data-repo-key') || '',
            name: card.getAttribute('data-repo-name') || ''
        };
        openRepo(row);
    }

    // ---- card interactions: the whole card opens the repository ----
    const cardList = document.getElementById('repo-card-list');
    const recentList = document.getElementById('home-recent-list');
    const dashboardOrigin = {
        page: 'screens/Dashboard/Dashboard',
        nav: 'repositories',
        data: {}
    };
    function handleCardListClick(evt) {
        const owner = evt.target.closest('.repo-owner-link');
        if (owner) {
            evt.stopPropagation();
            SvnHubUI.openPerson(owner.getAttribute('data-person-handle'), dashboardOrigin);
            return;
        }
        const card = evt.target.closest('.repo-card');
        if (card)
            openRepoFromCard(card);
    }
    cardList.addEventListener('click', handleCardListClick);
    if (recentList)
        recentList.addEventListener('click', handleCardListClick);

    // ---- profile banner: clicking the avatar or the @username opens your own profile ----
    function makeProfileLink(el, label) {
        if (!el)
            return;
        el.classList.add('is-clickable');
        el.setAttribute('role', 'link');
        el.setAttribute('tabindex', '0');
        el.setAttribute('title', label);
        el.addEventListener('click', openOwnProfile);
        el.addEventListener('keydown', function (evt) {
            if (evt.key === 'Enter' || evt.key === ' ') {
                evt.preventDefault();
                openOwnProfile();
            }
        });
    }
    makeProfileLink(document.getElementById('repo-prof-avatar'), 'View my profile');
    makeProfileLink(document.getElementById('repo-prof-handle-line'), 'View my profile');
    function handleCardListKeydown(evt) {
        if (evt.key !== 'Enter')
            return;
        const card = evt.target.closest('.repo-card');
        if (card)
            openRepoFromCard(card);
    }
    cardList.addEventListener('keydown', handleCardListKeydown);
    if (recentList)
        recentList.addEventListener('keydown', handleCardListKeydown);

    const activityList = document.getElementById('home-activity-list');
    if (activityList) {
        activityList.addEventListener('click', (evt) => {
            const row = evt.target.closest('.home-activity-row');
            if (!row)
                return;
            // Deep-link into the repository's History section, focused on this revision.
            Utils.saveData('repoSection', 'history');
            const rev = Number(row.getAttribute('data-revision'));
            if (rev)
                Utils.saveData('repoRevision', rev);
            openRepoFromCard(row);
        });
    }

    const attentionList = document.getElementById('home-attention-list');
    if (attentionList) {
        attentionList.addEventListener('click', (evt) => {
            const row = evt.target.closest('.home-attn-row');
            if (!row)
                return;
            // Deep-link into the repository's Issues or Merge Requests section.
            const section = row.getAttribute('data-section');
            if (section)
                Utils.saveData('repoSection', section);
            openRepoFromCard(row);
        });
    }

    const wcList = document.getElementById('home-wc-list');
    if (wcList) {
        wcList.addEventListener('click', (evt) => {
            const row = evt.target.closest('.home-wc-row');
            if (row)
                openRepoFromCard(row);
        });
    }

    // ---- "view all" / header routing ----
    function goExplore() {
        if (Utils.setAppNavActive)
            Utils.setAppNavActive('discover', 'screens/Discover/Discover');
        Utils.routePage('screens/Discover/Discover', 'app-screen-area');
    }

    function goInsights() {
        if (Utils.setAppNavActive)
            Utils.setAppNavActive('insights', 'screens/Insights/Insights');
        Utils.routePage('screens/Insights/Insights', 'app-screen-area');
    }

    function openOwnProfile() {
        const handle = Utils.getData('handle') || '';
        if (!handle)
            return;
        SvnHubUI.openPerson(handle, dashboardOrigin);
    }

    // ---- first-run: no repos and nothing visible yet -> one "Get started" card ----
    function syncFirstRun() {
        const grid = document.getElementById('home-grid');
        const starter = document.getElementById('home-getstarted');
        if (!grid || !starter)
            return;
        const firstRun = !repoRows.length && !recentCount && !activityCount;
        grid.style.display = firstRun ? 'none' : '';
        starter.style.display = firstRun ? '' : 'none';
    }

    // ---- create repository (editing lives on the Repository page itself) ----
    const rfErr = document.getElementById('rf-name-err');
    function showRepoFormError(msg) {
        rfErr.textContent = msg || '';
        rfErr.classList.toggle('show', !!msg);
        $$('rf-name').element.classList.toggle('input-bad', !!msg);
    }
    function newRepoNameProblem(name) {
        if (!name)
            return 'A repository name is required.';
        if (!/^[A-Za-z0-9_-]+$/.test(name))
            return 'Use only letters, digits, dash or underscore — no spaces.';
        const dup = repoRows.some((r) => (r.name || '').toLowerCase() === name.toLowerCase());
        if (dup)
            return "You already have a repository named '" + name + "'.";
        return '';
    }
    function syncRepoFormEnabled() {
        const name = $$('rf-name').getValue().trim();
        $$('rf-submit').enable(name.length > 0);
        // Clear a stale error as the user edits; don't nag while typing.
        if (rfErr.classList.contains('show'))
            showRepoFormError(newRepoNameProblem(name));
    }
    function openNewRepoDialog() {
        $$('rf-name').setValue('');
        $$('rf-desc').setValue('');
        $$('rf-vis').setValue('private');
        $$('rf-layout').setValue(true);
        $$('rf-submit').enable(false);
        showRepoFormError('');
        Utils.popup_open('repo-form-popup', 'rf-name');
    }
    $$('home-new').onclick(openNewRepoDialog);
    $$('gs-new').onclick(openNewRepoDialog);
    $$('home-recent-more').onclick(goExplore);
    $$('home-mine-more').onclick(openOwnProfile);
    $$('home-insights-more').onclick(goInsights);
    async function submitRepoForm() {
        const name = $$('rf-name').getValue().trim();
        const problem = newRepoNameProblem(name);
        if (problem) {
            showRepoFormError(problem);
            $$('rf-name').focus();
            return;
        }
        showRepoFormError('');
        const res = await Server.call(WS_REPO, 'createRepository', {
            repoKey: name,
            description: $$('rf-desc').getValue().trim(),
            visibility: $$('rf-vis').getValue(),
            standardLayout: $$('rf-layout').getValue()
        });
        if (res._Success) {
            Utils.popup_close();
            Utils.toast.success('Repository created');
            await loadMine();
            loadRecent();
            syncFirstRun();
        }
    }
    $$('rf-name').element.addEventListener('input', syncRepoFormEnabled);
    $$('rf-cancel').onclick(() => Utils.popup_close());
    $$('rf-submit').onclick(submitRepoForm);
    $$('rf-name').onEnter(submitRepoForm);
    $$('rf-desc').onEnter(submitRepoForm);

    // ---- init ----
    if (Utils.setAppNavActive)
        Utils.setAppNavActive('repositories');
    const gsHandle = document.getElementById('gs-handle');
    if (gsHandle && Utils.getData('handle'))
        gsHandle.textContent = Utils.getData('handle');
    loadProfile();
    loadInsightsLite();
    loadWorkingCopies();
    loadAttention();
    await Promise.all([loadRecent(), loadActivity(), loadMine()]);
    syncFirstRun();

    if (Utils.getAndEraseData('openNewRepo'))
        openNewRepoDialog();

})();
