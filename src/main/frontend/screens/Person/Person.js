/* global $$, Utils, Server, DateTimeUtils, SvnHubUI */
'use strict';

(async function () {

    const WS = 'services/DiscoverService';
    const PAGE_SIZE = 30;
    const guest = Utils.getData('guest') === true;
    const returnTo = Utils.getData('personReturnTo');
    const handle = (Utils.getData('personHandle') || new URLSearchParams(location.search || '').get('personHandle') || '').trim();
    const myHandle = Utils.getData('handle') || '';
    const isSelf = !guest && !!handle && handle.toLowerCase() === myHandle.toLowerCase();
    const activeNav = isSelf ? null : (returnTo && Object.prototype.hasOwnProperty.call(returnTo, 'nav') ? returnTo.nav : 'discover');

    // Client-side repo state for filter / sort / load-more (item: repo toolbar).
    let allRepos = [];
    let repoTotal = 0;
    let repoPage = 0;
    let viewerCanSeePrivate = false;
    let svnUrlPrefix = '';

    function esc(s) {
        return SvnHubUI.esc(s);
    }

    function plural(n, one, many) {
        return n + ' ' + (n === 1 ? one : many);
    }

    function fmtDate(ms) {
        if (!ms)
            return '–';
        try {
            return DateTimeUtils.formatDate(ms);
        } catch (e) {
            return '' + ms;
        }
    }

    function fallbackBack() {
        if (isSelf)
            return {page: 'screens/Dashboard/Dashboard', nav: 'repositories'};
        return {page: 'screens/Discover/Discover', nav: 'discover'};
    }

    function thisPersonTarget() {
        return {
            page: 'screens/Person/Person',
            nav: activeNav,
            data: {
                personHandle: handle,
                personReturnTo: returnTo || fallbackBack()
            }
        };
    }

    function repoFromEl(el) {
        return {
            repoId: el.getAttribute('data-repo-id'),
            repoKey: el.getAttribute('data-repo-key'),
            name: el.getAttribute('data-repo-name')
        };
    }

    function activityFromNode(node) {
        return {
            repoId: node.getAttribute('data-repo-id'),
            repoKey: node.getAttribute('data-repo-key'),
            name: node.getAttribute('data-repo-name'),
            revision: node.getAttribute('data-rev')
        };
    }

    function emptyCard(title, body) {
        return '<div class="card card-pad repo-empty"><h3>' + esc(title) + '</h3><p class="muted">' + esc(body) + '</p></div>';
    }

    function hideLoading() {
        const loading = document.getElementById('person-loading');
        if (loading)
            loading.hidden = true;
    }

    function showError(title, body) {
        hideLoading();
        document.getElementById('person-body').hidden = true;
        const box = document.getElementById('person-error');
        box.hidden = false;
        document.getElementById('person-error-title').textContent = title;
        document.getElementById('person-error-body').textContent = body;
    }

    // ---- copy affordance (mirrors the Repository checkout copy pattern) ----
    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        document.body.removeChild(ta);
        return ok;
    }

    function copyText(text, onDone) {
        if (!text) {
            onDone(false);
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => onDone(true), () => onDone(fallbackCopy(text)));
        } else {
            onDone(fallbackCopy(text));
        }
    }

    function flashLabel(el, base, done) {
        el.textContent = done ? 'Copied' : 'Copy failed';
        el.classList.add('copied');
        setTimeout(() => {
            el.textContent = base;
            el.classList.remove('copied');
        }, 1500);
    }

    function currentProfileName() {
        const nameEl = document.getElementById('person-name');
        if (!nameEl)
            return handle;
        const value = nameEl.tagName === 'INPUT' ? nameEl.value : nameEl.textContent;
        return (value || handle).trim();
    }

    // ---- repository list: filter + sort + render (item: repo toolbar) ----
    function sortedFilteredRepos() {
        const q = (document.getElementById('person-repo-filter').value || '').trim().toLowerCase();
        const sort = document.getElementById('person-repo-sort').value;
        let rows = allRepos.slice();
        if (q) {
            rows = rows.filter((r) =>
                ('' + (r.name || '')).toLowerCase().indexOf(q) > -1 ||
                ('' + (r.description || '')).toLowerCase().indexOf(q) > -1 ||
                ('' + (r.repoKey || '')).toLowerCase().indexOf(q) > -1);
        }
        if (sort === 'updated')
            rows.sort((a, b) => Number(b.headRevisionTs || b.createdTs || 0) - Number(a.headRevisionTs || a.createdTs || 0));
        else if (sort === 'revisions')
            rows.sort((a, b) => Number(b.headRevision || 0) - Number(a.headRevision || 0));
        else
            rows.sort((a, b) => ('' + (a.name || '')).localeCompare('' + (b.name || '')));
        return rows;
    }

    function renderRepos() {
        const display = currentProfileName() || handle;
        const host = document.getElementById('person-repos');
        const rows = sortedFilteredRepos();
        if (!rows.length) {
            const filtered = (document.getElementById('person-repo-filter').value || '').trim();
            if (filtered)
                host.innerHTML = emptyCard('No matches', 'No repositories match "' + filtered + '".');
            else if (viewerCanSeePrivate)
                host.innerHTML = emptyCard('No visible repositories', display + ' does not have visible repositories yet.');
            else
                host.innerHTML = emptyCard('No public repositories', display + ' has no public repositories yet.');
        } else {
            host.innerHTML = rows.map((r) => SvnHubUI.repoCard(r)).join('');
        }
        // Toolbar only earns its place once there is something to filter/sort.
        document.getElementById('person-repo-toolbar').hidden = allRepos.length < 2;
        // Truncation / load-more.
        const moreWrap = document.getElementById('person-repo-more');
        const loadMore = $$('person-repo-load-more');
        if (repoTotal > allRepos.length) {
            moreWrap.hidden = false;
            document.getElementById('person-repo-more-text').textContent =
                'Showing ' + allRepos.length + ' of ' + repoTotal + ' repositories';
            loadMore.show();
        } else {
            moreWrap.hidden = true;
            loadMore.hide();
        }
    }

    async function loadMoreRepos() {
        repoPage += 1;
        const res = await Server.call(WS, 'getPersonDetail',
            {handle: handle, page: repoPage, pageSize: PAGE_SIZE, activityLimit: 1});
        if (!res._Success)
            return;
        allRepos = allRepos.concat(res.repos || []);
        repoTotal = Number(res.total || allRepos.length);
        $$('person-repo-count').setValue(plural(repoTotal, 'repo', 'repos'));
        renderRepos();
    }

    // ---- activity feed (item: deep-link + relative time + private badge) ----
    function renderActivity(rows) {
        rows = rows || [];
        const host = document.getElementById('person-activity');
        host.classList.toggle('revision-spine', rows.length > 0);
        $$('person-activity-count').setValue(plural(rows.length, 'commit', 'commits'));
        if (!rows.length) {
            host.innerHTML = '<p class="muted person-activity-empty">' +
                (viewerCanSeePrivate ? 'No visible commit activity yet.' : 'No public commit activity yet.') + '</p>';
            return;
        }
        host.innerHTML = rows.map((r) => {
            const changed = Number(r.changedCount || 0);
            const isPrivate = viewerCanSeePrivate && r.visibility && r.visibility !== 'public';
            return '<div class="rev-node person-commit" tabindex="0" data-repo-id="' + esc(r.repoId) +
                '" data-repo-key="' + esc(r.repoKey || '') + '" data-repo-name="' + esc(r.repoName || '') +
                '" data-rev="' + esc(r.revision || 0) + '">' +
                '<div class="rev-dot">' + esc(r.revision || 0) + '</div>' +
                '<div class="rev-body">' +
                    '<div class="rev-msg">' + esc(r.message || '(no message)') + '</div>' +
                    '<div class="rev-meta">' +
                        '<span class="rev-author">' + esc(r.repoKey || r.repoName || 'repository') + '</span>' +
                        (isPrivate ? '<span class="visibility-pill private">private</span>' : '') +
                        '<span class="rev-dotsep">&middot;</span>' +
                        '<span title="' + esc(fmtDate(r.commitTs)) + '">' + esc(SvnHubUI.relTime(r.commitTs)) + '</span>' +
                        '<span class="rev-dotsep">&middot;</span><span class="mono">r' + esc(r.revision || 0) + '</span>' +
                        (changed ? '<span class="rev-dotsep">&middot;</span><span>' + esc(changed) + ' paths</span>' : '') +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // ================================================================ init

    if (!handle) {
        SvnHubUI.goBack(returnTo, fallbackBack());
        return;
    }

    if (Utils.setAppNavActive)
        Utils.setAppNavActive(activeNav);

    $$('person-back').onclick(() => SvnHubUI.goBack(returnTo, fallbackBack()));

    let res;
    try {
        res = await Server.call(WS, 'getPersonDetail',
            {handle: handle, page: 0, pageSize: PAGE_SIZE, activityLimit: 16});
    } catch (e) {
        res = null;
    }
    if (!res || !res._Success) {
        showError('Couldn\u2019t load profile', 'This person could not be found, or the profile failed to load.');
        return;
    }

    const profile = res.profile || {};
    const stats = res.stats || {};
    allRepos = res.repos || [];
    repoTotal = Number(res.total || allRepos.length);
    repoPage = 0;
    const activity = res.activity || [];
    const weekly = res.weeklyActivity || [];
    const topRepos = res.topRepos || [];
    viewerCanSeePrivate = !!profile.viewerCanSeePrivate;
    const display = profile.fullName || profile.handle || handle;

    // SVN checkout URL prefix for this person (derive from a repo's checkoutUrl,
    // else leave blank and hide the copy button).
    const sampleRepo = allRepos.find((r) => r.checkoutUrl && r.repoKey);
    if (sampleRepo) {
        const url = sampleRepo.checkoutUrl;
        const key = sampleRepo.repoKey;
        const cut = url.lastIndexOf('/' + key);
        const ownerHandle = profile.handle || handle;
        svnUrlPrefix = (cut > -1 ? url.substring(0, cut) : url) + '/' + ownerHandle + '/';
    }

    hideLoading();
    document.getElementById('person-body').hidden = false;
    document.getElementById('person-avatar').textContent = SvnHubUI.personInitials(display || handle);
    document.getElementById('person-name').textContent = display;
    $$('person-handle').setValue(profile.handle || handle);
    document.getElementById('person-since').textContent = profile.memberSince ? 'Member since ' + fmtDate(profile.memberSince) : 'Member profile';

    const repoCount = Number(stats.visibleRepoCount || repoTotal || 0);
    const revisions = Number(stats.visibleRevisionCount || 0);
    const commits = Number(stats.commitCount || 0);
    document.getElementById('person-stats').innerHTML =
        SvnHubUI.statBlock(repoCount, 'repositories') +
        SvnHubUI.statBlock(revisions, 'revisions') +
        SvnHubUI.statBlock(commits, 'commits');
    document.getElementById('person-fact-last').textContent = stats.lastCommitTs ? SvnHubUI.relTime(stats.lastCommitTs) : '–';
    document.getElementById('person-fact-last').setAttribute('title', fmtDate(stats.lastCommitTs));
    $$('person-repo-count').setValue(plural(repoTotal, 'repo', 'repos'));

    // Header sparkline (item: commits-per-week).
    const sparkHtml = SvnHubUI.weeklySpark(weekly);
    if (sparkHtml) {
        document.getElementById('person-spark').innerHTML = sparkHtml;
        document.getElementById('person-spark-wrap').hidden = false;
    }

    // Top repositories rail (item: most active in).
    if (topRepos.length) {
        document.getElementById('person-top-repos').innerHTML = SvnHubUI.topReposList(topRepos);
    } else {
        document.getElementById('person-top-repos-card').hidden = true;
    }

    document.getElementById('person-repo-subtitle').textContent = viewerCanSeePrivate
        ? 'Repositories visible to you for this person.'
        : 'Public repositories owned by this person.';
    renderRepos();
    renderActivity(activity);
    SvnHubUI.initExpandableSections({
        sectionSelector: '.person-expand-section',
        headSelector: '.person-expand-head',
        bodySelector: '.person-expand-body'
    });

    // Edit profile (item: self only). The display name edits in place while the
    // adjacent affordance toggles between edit and cancel. The shell's
    // edit-profile popup (opened from the account menu) still notifies us via
    // svnhubProfileUpdated.
    window.svnhubProfileUpdated = null;
    if (isSelf) {
        const editBtn = document.getElementById('person-name-edit');
        if (editBtn)
            editBtn.hidden = false;
        // On your own profile there's nothing to copy out, so drop the SVN URL button.
        const ownUrlBtn = document.getElementById('person-copy-url');
        if (ownUrlBtn)
            ownUrlBtn.hidden = true;
        window.svnhubProfileUpdated = (fullName) => applyProfileName(fullName || profile.handle || handle);
    }

    let nameEditState = null;
    let nameSavePending = false;
    let nameSaveToken = 0;

    function applyProfileName(name) {
        const nextName = name || profile.handle || handle;
        const nameEl = document.getElementById('person-name');
        const avatarEl = document.getElementById('person-avatar');
        profile.fullName = nextName;
        if (nameEl)
            nameEl.textContent = nextName;
        if (nameEditState)
            nameEditState.current = nextName;
        if (avatarEl)
            avatarEl.textContent = SvnHubUI.personInitials(nextName);
    }

    function setNameEditButtonEditing(editing) {
        const btn = document.getElementById('person-name-edit');
        const saveBtn = document.getElementById('person-name-save');
        if (btn) {
            btn.classList.toggle('is-editing', editing);
            btn.setAttribute('aria-label', editing ? 'Cancel name edit' : 'Edit name');
            btn.setAttribute('title', editing ? 'Cancel edit' : 'Edit name');
        }
        if (saveBtn)
            saveBtn.hidden = !editing;
    }

    function setNameSavePending(pending) {
        nameSavePending = pending;
        const btn = document.getElementById('person-name-edit');
        if (!btn)
            return;
        btn.disabled = pending;
        btn.setAttribute('aria-busy', pending ? 'true' : 'false');
        btn.setAttribute('title', pending ? 'Saving name' : 'Edit name');
    }

    function syncSavedProfileName(name, expectedVisibleName) {
        if (nameEditState) {
            nameEditState.current = name;
            if (normalizeEditedName(currentProfileName()) !== expectedVisibleName) {
                profile.fullName = name;
                return;
            }
        }
        applyProfileName(name);
    }

    async function saveProfileNameOptimistically(original, next) {
        const token = ++nameSaveToken;
        setNameSavePending(true);
        let res = null;
        try {
            res = await Server.call('services/AccountService', 'updateProfile', {fullName: next});
        } catch (e) {
            res = null;
        }
        if (token !== nameSaveToken)
            return;
        if (res && res._Success) {
            syncSavedProfileName(res.fullName != null ? res.fullName : next, next);
            Utils.toast.success('Profile saved');
        } else {
            syncSavedProfileName(original, next);
            Utils.toast.error('Couldn\'t save name');
        }
        setNameSavePending(false);
    }

    function startInlineNameEdit() {
        if (nameEditState || nameSavePending)
            return;
        const nameEl = document.getElementById('person-name');
        if (!nameEl)
            return;
        const row = nameEl.closest('.person-name-row');
        const editBtn = document.getElementById('person-name-edit');
        const saveBtn = document.getElementById('person-name-save');
        const current = nameEl.textContent.trim();
        nameEl.contentEditable = 'true';
        nameEl.spellcheck = false;
        nameEl.setAttribute('role', 'textbox');
        nameEl.setAttribute('aria-label', 'Display name');
        nameEl.setAttribute('aria-multiline', 'false');
        if (row)
            row.classList.add('is-editing');
        setNameEditButtonEditing(true);
        nameEl.focus();
        selectProfileName(nameEl);

        let finished = false;
        async function commit(save) {
            if (finished)
                return;
            finished = true;
            const original = nameEditState ? nameEditState.current : current;
            const next = save ? normalizeEditedName(nameEl.textContent) : original;
            if (save && next === original) {
                restoreName(original);
                return;
            }
            if (!save || !next) {
                restoreName(original);
                return;
            }
            if (next.length > 200) {
                finished = false;
                nameEl.focus();
                return;
            }
            restoreName(next);
            saveProfileNameOptimistically(original, next);
        }

        function restoreName(name) {
            document.removeEventListener('pointerdown', onPointerDownOutside, true);
            nameEl.removeEventListener('keydown', onKeyDown);
            nameEl.removeEventListener('blur', onBlur);
            nameEl.removeEventListener('paste', onPaste);
            nameEl.removeAttribute('contenteditable');
            nameEl.removeAttribute('spellcheck');
            nameEl.removeAttribute('role');
            nameEl.removeAttribute('aria-label');
            nameEl.removeAttribute('aria-multiline');
            if (row)
                row.classList.remove('is-editing');
            setNameEditButtonEditing(false);
            clearProfileNameSelection(nameEl);
            nameEditState = null;
            applyProfileName(name);
        }

        function onPointerDownOutside(e) {
            if (row && row.contains(e.target))
                return;
            commit(false);
        }

        nameEditState = {commit: commit, current: current};
        document.addEventListener('pointerdown', onPointerDownOutside, true);

        function onKeyDown(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit(false);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                commit(false);
            }
        }

        function onBlur(e) {
            if (e.relatedTarget === editBtn || e.relatedTarget === saveBtn) {
                e.relatedTarget.addEventListener('blur', () => {
                    setTimeout(() => {
                        if (nameEditState && document.activeElement !== nameEl && document.activeElement !== editBtn && document.activeElement !== saveBtn)
                            commit(false);
                    }, 0);
                }, {once: true});
                return;
            }
            setTimeout(() => {
                if (nameEditState && document.activeElement !== nameEl && document.activeElement !== editBtn && document.activeElement !== saveBtn)
                    commit(false);
            }, 0);
        }

        function onPaste(e) {
            const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
            if (!text)
                return;
            e.preventDefault();
            document.execCommand('insertText', false, text);
        }

        nameEl.addEventListener('keydown', onKeyDown);
        nameEl.addEventListener('blur', onBlur);
        nameEl.addEventListener('paste', onPaste);
    }

    function normalizeEditedName(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function selectProfileName(el) {
        const selection = window.getSelection && window.getSelection();
        if (!selection)
            return;
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function clearProfileNameSelection(el) {
        const selection = window.getSelection && window.getSelection();
        if (!selection || !selection.rangeCount || !el.contains(selection.anchorNode))
            return;
        selection.removeAllRanges();
    }

    const nameEditBtn = document.getElementById('person-name-edit');
    if (nameEditBtn) {
        nameEditBtn.addEventListener('pointerdown', (e) => {
            if (nameEditState)
                e.preventDefault();
        });
        nameEditBtn.addEventListener('click', () => {
            if (nameEditState)
                nameEditState.commit(false);
            else
                startInlineNameEdit();
        });
    }
    const nameSaveBtn = document.getElementById('person-name-save');
    if (nameSaveBtn) {
        nameSaveBtn.addEventListener('pointerdown', (e) => {
            if (nameEditState)
                e.preventDefault();
        });
        nameSaveBtn.addEventListener('click', () => {
            if (nameEditState)
                nameEditState.commit(true);
        });
    }

    // Copy affordances (item: @handle + SVN URL).
    document.getElementById('person-handle-copy').addEventListener('click', () => {
        const btn = document.getElementById('person-handle-copy');
        copyText('@' + (profile.handle || handle), (ok) => {
            btn.classList.toggle('copied', ok);
            btn.setAttribute('title', ok ? 'Copied' : 'Copy failed');
            setTimeout(() => {
                btn.classList.remove('copied');
                btn.removeAttribute('title');
            }, 1500);
        });
    });
    if (svnUrlPrefix && !isSelf) {
        const urlBtn = document.getElementById('person-copy-url');
        const urlText = document.getElementById('person-copy-url-text');
        urlBtn.hidden = false;
        urlBtn.setAttribute('title', svnUrlPrefix);
        urlBtn.addEventListener('click', () => copyText(svnUrlPrefix, (ok) => flashLabel(urlText, 'Copy SVN URL', ok)));
    }

    // ---- delegated interactions ----
    document.getElementById('person-repos').addEventListener('click', (e) => {
        const owner = e.target.closest('.repo-owner-link');
        if (owner) {
            e.stopPropagation();
            SvnHubUI.openPerson(owner.getAttribute('data-person-handle'), returnTo || fallbackBack());
            return;
        }
        const card = e.target.closest('.repo-card');
        if (card)
            SvnHubUI.openRepo(repoFromEl(card), thisPersonTarget());
    });

    document.getElementById('person-repos').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const card = e.target.closest('.repo-card');
        if (card)
            SvnHubUI.openRepo(repoFromEl(card), thisPersonTarget());
    });

    document.getElementById('person-repo-filter').addEventListener('input', renderRepos);
    document.getElementById('person-repo-sort').addEventListener('change', renderRepos);
    $$('person-repo-load-more').onclick(loadMoreRepos);

    document.getElementById('person-top-repos').addEventListener('click', (e) => {
        const row = e.target.closest('.top-repo');
        if (row)
            SvnHubUI.openRepo(repoFromEl(row), thisPersonTarget());
    });
    document.getElementById('person-top-repos').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const row = e.target.closest('.top-repo');
        if (row)
            SvnHubUI.openRepo(repoFromEl(row), thisPersonTarget());
    });

    document.getElementById('person-activity').addEventListener('click', (e) => {
        const node = e.target.closest('.person-commit');
        if (node)
            SvnHubUI.openRepo(activityFromNode(node), thisPersonTarget(), {revision: node.getAttribute('data-rev'), section: 'history'});
    });

    document.getElementById('person-activity').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        const node = e.target.closest('.person-commit');
        if (node)
            SvnHubUI.openRepo(activityFromNode(node), thisPersonTarget(), {revision: node.getAttribute('data-rev'), section: 'history'});
    });

})();
