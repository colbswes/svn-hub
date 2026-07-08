/* global DateTimeUtils, Utils, Diff2Html */
/*
 * Shared, framework-style render helpers so repeated widgets (repository cards,
 * profile stat blocks) are defined ONCE and reused across screens instead of
 * being re-created per page.  Loaded globally at startup as `SvnHubUI`.
 */
'use strict';

window.SvnHubUI = (function () {

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }
    function initials(name) {
        return (name || '?').charAt(0).toUpperCase();
    }
    function tone(r) {
        return r.visibility === 'public' ? 'public' : 'private';
    }
    function fmtDate(ms) {
        if (!ms)
            return '—';
        try {
            return DateTimeUtils.formatDate(ms);
        } catch (e) {
            return '' + ms;
        }
    }

    /**
     * Human relative time ("just now", "5 minutes ago", "2 days ago"), falling
     * back to the absolute formatted date beyond ~30 days.  Pair with a `title`
     * attribute holding fmtDate(ms) so the exact date is always available.
     */
    function relTime(ms) {
        if (!ms)
            return '—';
        const now = Date.now();
        let diff = now - Number(ms);
        if (diff < 0)
            diff = 0;
        const sec = Math.floor(diff / 1000);
        if (sec < 45)
            return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60)
            return min + (min === 1 ? ' minute ago' : ' minutes ago');
        const hr = Math.floor(min / 60);
        if (hr < 24)
            return hr + (hr === 1 ? ' hour ago' : ' hours ago');
        const day = Math.floor(hr / 24);
        if (day < 30)
            return day + (day === 1 ? ' day ago' : ' days ago');
        return fmtDate(ms);
    }

    function clearData(key) {
        if (typeof Utils !== 'undefined' && Utils.getAndEraseData)
            Utils.getAndEraseData(key);
    }

    function saveDataMap(data) {
        if (!data || typeof Utils === 'undefined')
            return;
        Object.keys(data).forEach((key) => Utils.saveData(key, data[key]));
    }

    function routeTarget(target) {
        if (!target || !target.page || typeof Utils === 'undefined')
            return false;
        saveDataMap(target.data || {});
        if (Object.prototype.hasOwnProperty.call(target, 'nav') && Utils.setAppNavActive)
            Utils.setAppNavActive(target.nav);
        Utils.routePage(target.page, target.tag || 'app-screen-area', target.initialFocus || null, target.argv || null);
        return true;
    }

    function openRepo(r, returnTo, opts) {
        if (!r || typeof Utils === 'undefined')
            return;
        opts = opts || {};
        Utils.saveData('repoId', Number(r.repoId));
        Utils.saveData('repoKey', r.repoKey || '');
        Utils.saveData('repoName', r.name || r.repoName || '');
        if (returnTo)
            Utils.saveData('repoReturnTo', returnTo);
        else
            clearData('repoReturnTo');
        // Deep-link support: the Repository screen focuses `repoRevision` inside the
        // History section when both are supplied (see Repository.js pendingRevision).
        const rev = Number(opts.revision) || 0;
        if (rev > 0) {
            Utils.saveData('repoSection', opts.section || 'history');
            Utils.saveData('repoRevision', rev);
        } else {
            clearData('repoSection');
            clearData('repoRevision');
        }
        Utils.routePage('screens/Repository/Repository', 'app-screen-area');
    }

    function openPerson(handle, returnTo) {
        if (!handle || typeof Utils === 'undefined')
            return;
        Utils.saveData('personHandle', handle);
        if (returnTo)
            Utils.saveData('personReturnTo', returnTo);
        else
            clearData('personReturnTo');
        Utils.routePage('screens/Person/Person', 'app-screen-area');
    }

    function goBack(returnTo, fallback) {
        if (!routeTarget(returnTo))
            routeTarget(fallback);
    }

    /**
     * A repository card, click-through to the repo. `opts.action` injects extra
     * markup into the header action cluster (for example, an Edit button).
     */
    function repoCard(r, opts) {
        opts = opts || {};
        const owner = r.ownerHandle || (r.repoKey && r.repoKey.indexOf('/') > -1 ? r.repoKey.split('/')[0] : 'unowned');
        const key = r.repoKey || (owner + '/' + r.name);
        const t = tone(r);
        const when = r.headRevisionTs || r.createdTs;
        const ownerMarkup = owner && owner !== 'unowned'
            ? '<button type="button" class="repo-owner-link" data-person-handle="' + esc(owner) + '">' + esc(owner) + '</button>'
            : '<span>' + esc(owner) + '</span>';
        return '<article class="repo-card card card-hover ' + t + '" data-repo-id="' + esc(r.repoId) +
                '" data-repo-key="' + esc(key) + '" data-repo-name="' + esc(r.name) +
                '" data-owner-handle="' + esc(owner) + '" tabindex="0">' +
                '<div class="repo-card-head">' +
                    '<div class="repo-card-icon">' + esc(initials(r.name)) + '</div>' +
                    '<div class="repo-card-title-block">' +
                        '<div class="repo-card-path">' + ownerMarkup + ' / ' + esc(r.name) + '</div>' +
                        '<h3>' + esc(r.name) + '</h3>' +
                    '</div>' +
                    '<div class="repo-card-right">' +
                        '<span class="visibility-pill ' + t + '">' + esc(r.visibility || 'private') + '</span>' +
                        '<span class="head-pill mono">HEAD r' + esc(r.headRevision || 0) + '</span>' +
                        (opts.action || '') +
                    '</div>' +
                '</div>' +
                '<p class="repo-card-desc">' + esc(r.description || 'No description provided.') + '</p>' +
                '<div class="repo-card-meta">' +
                    '<span>' + (when ? ('Updated ' + esc(fmtDate(when))) : 'No revisions yet') + '</span>' +
                    '<span class="repo-key mono">' + esc(r.checkoutUrl || key) + '</span>' +
                '</div>' +
            '</article>';
    }

    /** A big-number + label stat block (Meridian profile-header style). */
    function statBlock(n, label) {
        return '<div class="profile-stat"><span class="profile-stat-n tnum">' + esc(n) +
            '</span><span class="profile-stat-l">' + esc(label) + '</span></div>';
    }

    /**
     * A compact commits-per-week bar strip. weeks: [{weekStartTs, count}].
     * Heights scale to the busiest week; every bar carries a title tooltip.
     * Returns '' when there is no activity so the caller can hide the section.
     */
    function weeklySpark(weeks) {
        if (!weeks || !weeks.length)
            return '';
        const max = Math.max(0, ...weeks.map((w) => Number(w.count) || 0));
        if (max <= 0)
            return '';
        return '<div class="spark-strip" role="img" aria-label="Commit activity, last ' + weeks.length + ' weeks">' +
            weeks.map((w) => {
                const c = Number(w.count) || 0;
                const h = c > 0 ? Math.max(10, Math.round((c / max) * 100)) : 3;
                const title = c + (c === 1 ? ' commit' : ' commits') + ', week of ' + fmtDate(w.weekStartTs);
                return '<span class="spark-bar' + (c > 0 ? '' : ' spark-empty') +
                    '" style="height:' + h + '%" title="' + esc(title) + '"></span>';
            }).join('') +
            '</div>';
    }

    /**
     * "Most active in" list for a person's side rail. rows:
     * [{repoId, repoKey, repoName, commitCount}]. Rows are keyboard-focusable and
     * carry data-repo-* so the caller can delegate clicks to openRepo.
     */
    function topReposList(rows) {
        if (!rows || !rows.length)
            return '<p class="muted" style="margin:0;">No commit activity yet.</p>';
        const max = Math.max(1, ...rows.map((r) => Number(r.commitCount) || 0));
        return '<ul class="top-repo-list">' + rows.map((r) => {
            const c = Number(r.commitCount) || 0;
            const w = Math.max(6, Math.round((c / max) * 100));
            const name = r.repoName || r.repoKey || 'repository';
            return '<li class="top-repo" tabindex="0" data-repo-id="' + esc(r.repoId) +
                '" data-repo-key="' + esc(r.repoKey || '') + '" data-repo-name="' + esc(r.repoName || '') + '">' +
                '<div class="top-repo-top">' +
                    '<span class="top-repo-name">' + esc(name) + '</span>' +
                    '<span class="top-repo-count mono">' + esc(c) + '</span>' +
                '</div>' +
                '<div class="top-repo-bar"><span style="width:' + w + '%"></span></div>' +
            '</li>';
        }).join('') + '</ul>';
    }

    /**
     * A commit-message panel: the first line becomes a bold subject, any remaining
     * lines become a muted body (whitespace preserved).  Returns the INNER markup
     * for a .rev-message container, or '' when there is no message so the caller
     * can rely on :empty to hide the host.  All values are escaped.
     */
    function commitMessage(msg) {
        if (!msg)
            return '';
        const text = String(msg).replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
        if (!text)
            return '';
        const lines = text.split('\n');
        const subject = lines[0].trim();
        const body = lines.slice(1).join('\n').replace(/^\n+/, '').trim();
        let html = '<p class="rev-msg-subject">' + esc(subject) + '</p>';
        if (body)
            html += '<div class="rev-msg-body">' + esc(body) + '</div>';
        return html;
    }

    const AVATARS = ['#1f5d57', '#809cc9', '#5768a4', '#6b2c4e', '#3a4f86', '#c08a1a', '#2c7a72'];

    /** Small inline busy indicator (spinner + label). */
    function spinner(label) {
        return '<div class="busy"><span class="busy-spin" aria-hidden="true"></span><span>' +
            esc(label || 'Loading…') + '</span></div>';
    }

    function readStoredArray(key) {
        if (!key)
            return null;
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw)
                return null;
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : null;
        } catch (e) {
            return null;
        }
    }

    function writeStoredArray(key, arr) {
        if (!key)
            return;
        try {
            window.localStorage.setItem(key, JSON.stringify(arr || []));
        } catch (e) {
            // Storage is optional; section state still works for this page view.
        }
    }

    function initExpandableSections(opts) {
        opts = opts || {};
        const root = opts.root || document;
        const sectionSelector = opts.sectionSelector || '.ins-section';
        const headSelector = opts.headSelector || '.ins-section-head';
        const bodySelector = opts.bodySelector || '.ins-section-body';
        const keyAttribute = opts.keyAttribute || 'data-section';
        const storageKey = opts.storageKey || null;
        const durationMs = opts.durationMs || 230;
        const onExpanded = typeof opts.onExpanded === 'function' ? opts.onExpanded : null;

        const sections = Array.prototype.slice.call(root.querySelectorAll(sectionSelector));
        const savedCollapsed = readStoredArray(storageKey);

        function persist() {
            if (!storageKey)
                return;
            const collapsed = [];
            sections.forEach((section) => {
                const key = section.getAttribute(keyAttribute);
                if (key && section.classList.contains('collapsed'))
                    collapsed.push(key);
            });
            writeStoredArray(storageKey, collapsed);
        }

        function finishSectionAnimation(section, body, expanded) {
            if (body._insDone)
                body.removeEventListener('transitionend', body._insDone);
            window.clearTimeout(body._insTimer);
            body._insDone = null;
            body._insTimer = null;
            section.classList.remove('animating');
            if (expanded) {
                body.style.height = '';
                if (onExpanded)
                    onExpanded(section, body);
            } else {
                body.style.height = '0px';
            }
        }

        function prepareSectionAnimation(section, body) {
            if (body._insDone)
                body.removeEventListener('transitionend', body._insDone);
            window.clearTimeout(body._insTimer);
            const currentHeight = body.getBoundingClientRect().height;
            section.classList.add('animating');
            body.style.height = currentHeight + 'px';
            body.offsetHeight;
        }

        sections.forEach((section) => {
            const btn = section.querySelector(headSelector);
            const body = section.querySelector(bodySelector);
            if (!btn || !body || btn._expandableSectionInit)
                return;
            btn._expandableSectionInit = true;

            const key = section.getAttribute(keyAttribute);
            const shouldCollapse = savedCollapsed && key && savedCollapsed.indexOf(key) !== -1;
            if (shouldCollapse)
                section.classList.add('collapsed');

            const expanded = !section.classList.contains('collapsed');
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            body.inert = !expanded;
            body.style.height = expanded ? '' : '0px';

            btn.addEventListener('click', () => {
                const expand = section.classList.contains('collapsed');

                prepareSectionAnimation(section, body);
                body._insDone = (e) => {
                    if (e.target === body && e.propertyName === 'height')
                        finishSectionAnimation(section, body, expand);
                };
                body.addEventListener('transitionend', body._insDone);

                if (expand) {
                    section.classList.remove('collapsed');
                    body.inert = false;
                    btn.setAttribute('aria-expanded', 'true');
                    window.requestAnimationFrame(() => {
                        body.style.height = body.scrollHeight + 'px';
                        if (onExpanded)
                            window.setTimeout(() => onExpanded(section, body), 80);
                    });
                } else {
                    section.classList.add('collapsed');
                    body.inert = true;
                    btn.setAttribute('aria-expanded', 'false');
                    window.requestAnimationFrame(() => {
                        body.style.height = '0px';
                    });
                }

                body._insTimer = window.setTimeout(() => {
                    finishSectionAnimation(section, body, expand);
                }, durationMs + 80);
                persist();
            });
        });
    }

    /* ---------------------------------------------------------------
       Unified-diff rendering.
       Diff2Html on a large diff blocks the main thread for seconds and
       produces enormous DOM. Instead the diff is split per file; every
       file becomes a collapsible section whose rich diff is only built
       when it is (auto-)expanded, yielding to the event loop between
       files. Extremely large files fall back to a plain <pre>.
       --------------------------------------------------------------- */
    function splitUnifiedDiff(text) {
        const lines = String(text).split('\n');
        const files = [];
        let cur = null;
        function push() {
            if (cur && (cur.lines.length > 1 || (cur.lines[0] || '').trim() !== ''))
                files.push(cur);
        }
        function nameFromBoundary(line) {
            if (line.startsWith('Index: '))
                return line.substring(7).trim();
            const m = /^diff --git a\/(.*?) b\//.exec(line);
            return m ? m[1] : '';
        }
        for (const line of lines) {
            if (line.startsWith('Index: ') || line.startsWith('diff --git ')) {
                push();
                cur = {name: nameFromBoundary(line), lines: [line], adds: 0, dels: 0};
                continue;
            }
            if (!cur)
                cur = {name: '', lines: [], adds: 0, dels: 0};
            cur.lines.push(line);
            if (!cur.name && (line.startsWith('+++ ') || line.startsWith('--- ')))
                cur.name = line.substring(4).replace(/\t.*$/, '').replace(/\s+\(.*\)$/, '').trim();
            if (line.charAt(0) === '+' && !line.startsWith('+++'))
                cur.adds++;
            else if (line.charAt(0) === '-' && !line.startsWith('---'))
                cur.dels++;
        }
        push();
        return files;
    }

    /**
     * Render a unified diff into `host` with per-file lazy expansion.
     * Small files expand automatically (within a total budget) so typical
     * commits appear fully rendered; big diffs stay responsive.
     */
    function renderUnifiedDiff(host, diffText) {
        if (!host)
            return;
        if (!diffText || !String(diffText).trim()) {
            host.innerHTML = '<p class="muted" style="margin:0;">(no differences)</p>';
            return;
        }
        const files = splitUnifiedDiff(diffText);
        if (!files.length) {
            host.innerHTML = '<p class="muted" style="margin:0;">(no differences)</p>';
            return;
        }
        const AUTO_EXPAND_LINES = 400;    // a file this small may auto-expand…
        const EAGER_LINE_BUDGET = 1500;   // …until this many total lines are rendered
        const PLAIN_FALLBACK_LINES = 8000; // beyond this a file renders as plain text

        let html = '<div class="diff-files">';
        files.forEach((f, i) => {
            html += '<section class="diff-file" data-df="' + i + '">' +
                '<button type="button" class="diff-file-head">' +
                    '<span class="diff-file-caret" aria-hidden="true"></span>' +
                    '<span class="diff-file-name mono">' + esc(f.name || '(unnamed file)') + '</span>' +
                    '<span class="diff-file-stats">' +
                        (f.adds ? '<span class="add">+' + f.adds + '</span>' : '') +
                        (f.dels ? '<span class="del">&minus;' + f.dels + '</span>' : '') +
                        '<span class="ln">' + f.lines.length + ' lines</span>' +
                    '</span>' +
                '</button>' +
                '<div class="diff-file-body" hidden></div>' +
            '</section>';
        });
        html += '</div>';
        host.innerHTML = html;
        const sections = host.querySelectorAll('.diff-file');

        function renderBody(i) {
            const body = sections[i].querySelector('.diff-file-body');
            if (body.dataset.rendered)
                return;
            body.dataset.rendered = '1';
            const f = files[i];
            const text = f.lines.join('\n');
            if (f.lines.length > PLAIN_FALLBACK_LINES || typeof Diff2Html === 'undefined') {
                body.innerHTML = '<p class="muted diff-plain-note">Large file — showing plain diff.</p>' +
                    '<pre class="diff-plain">' + esc(text) + '</pre>';
                return;
            }
            body.innerHTML = Diff2Html.html(text,
                {drawFileList: false, matching: 'lines', outputFormat: 'line-by-line'});
        }

        host.querySelector('.diff-files').addEventListener('click', (e) => {
            const head = e.target.closest('.diff-file-head');
            if (!head)
                return;
            const sec = head.closest('.diff-file');
            const i = Number(sec.getAttribute('data-df'));
            const body = sec.querySelector('.diff-file-body');
            if (body.hidden) {
                body.hidden = false;
                sec.classList.add('open');
                if (!body.dataset.rendered) {
                    body.innerHTML = spinner('Rendering…');
                    setTimeout(() => renderBody(i), 15);   // paint the spinner first
                }
            } else {
                body.hidden = true;
                sec.classList.remove('open');
            }
        });

        // Auto-expand small files one at a time, yielding between each so the
        // page stays interactive even when there are many files.
        let budget = EAGER_LINE_BUDGET;
        let idx = 0;
        (function step() {
            while (idx < files.length) {
                const f = files[idx];
                if (f.lines.length <= AUTO_EXPAND_LINES && budget > 0) {
                    const i = idx++;
                    budget -= f.lines.length;
                    const sec = sections[i];
                    sec.querySelector('.diff-file-body').hidden = false;
                    sec.classList.add('open');
                    renderBody(i);
                    setTimeout(step, 0);
                    return;
                }
                idx++;
            }
        })();
    }

    /** Two-letter initials for a person (first + last token). */
    function personInitials(name) {
        const parts = ('' + (name || '?')).trim().split(/[\s._-]+/).filter(Boolean);
        if (!parts.length)
            return '?';
        return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
    }

    /**
     * Horizontal "top contributors" bars. rows: [{userName, handle, commits}].
     * Returns HTML; shared by the Insights page and the repo About view.
     */
    function contributorBars(rows) {
        if (!rows || !rows.length)
            return '<p class="muted" style="padding:8px 2px;">No contributor activity in this range.</p>';
        const max = Math.max(1, ...rows.map((r) => Number(r.commits) || 0));
        return rows.map((r, i) => {
            const commits = Number(r.commits) || 0;
            const w = Math.max(4, Math.round((commits / max) * 100));
            const handle = (r.handle && r.handle !== 'Unknown user' && r.handle !== '(anonymous)') ? r.handle : '';
            const avStyle = 'background:' + AVATARS[i % AVATARS.length];
            const avText = esc(personInitials(r.handle || r.userName));
            const avatar = handle
                ? '<button type="button" class="contrib-av contrib-person-link" data-contributor-handle="' + esc(handle) + '" style="' + avStyle + '" aria-label="Open ' + esc(r.userName) + '">' + avText + '</button>'
                : '<span class="contrib-av" style="' + avStyle + '">' + avText + '</span>';
            const name = handle
                ? '<button type="button" class="contrib-name contrib-name-link contrib-person-link" data-contributor-handle="' + esc(handle) + '">' + esc(r.userName) + '</button>'
                : '<span class="contrib-name">' + esc(r.userName) + '</span>';
            return '<div class="contrib-row">' +
                avatar +
                '<div class="contrib-body">' +
                    '<div class="contrib-top">' + name +
                    '<span class="contrib-count mono">' + commits + ' <span class="muted">rev</span></span></div>' +
                    '<div class="contrib-bar"><span style="width:' + w + '%"></span></div>' +
                '</div></div>';
        }).join('');
    }

    return {esc: esc, initials: initials, personInitials: personInitials, tone: tone, fmtDate: fmtDate,
        relTime: relTime, repoCard: repoCard, statBlock: statBlock, contributorBars: contributorBars,
        weeklySpark: weeklySpark, topReposList: topReposList, commitMessage: commitMessage,
        spinner: spinner, initExpandableSections: initExpandableSections, renderUnifiedDiff: renderUnifiedDiff,
        openRepo: openRepo, openPerson: openPerson, goBack: goBack, routeTarget: routeTarget};
})();
