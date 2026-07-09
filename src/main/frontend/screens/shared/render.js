/* global DateTimeUtils, Utils, Diff2Html, Router */
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

    //  Map a screen page path to its Router route (declared in routes.js).  Screen
    //  data is passed via Utils.saveData before navigating, so routes carry no params.
    const PAGE_ROUTES = {
        'screens/Dashboard/Dashboard': '/dashboard',
        'screens/Discover/Discover': '/discover',
        'screens/Insights/Insights': '/insights',
        'screens/Users/Users': '/users',
        'screens/Help/Help': '/help',
        'screens/AboutSubversion/AboutSubversion': '/about-subversion',
        'screens/Repository/Repository': '/repository',
        'screens/Person/Person': '/person',
        'screens/Landing/Landing': '/landing'
    };
    function pageRoute(page) {
        return PAGE_ROUTES[page] || '/';
    }

    function routeTarget(target) {
        if (!target || !target.page || typeof Utils === 'undefined')
            return false;
        saveDataMap(target.data || {});
        if (Object.prototype.hasOwnProperty.call(target, 'nav') && Utils.setAppNavActive)
            Utils.setAppNavActive(target.nav);
        Router.go(pageRoute(target.page));
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
        Router.go('/repository');
    }

    function openPerson(handle, returnTo) {
        if (!handle || typeof Utils === 'undefined')
            return;
        Utils.saveData('personHandle', handle);
        if (returnTo)
            Utils.saveData('personReturnTo', returnTo);
        else
            clearData('personReturnTo');
        Router.go('/person');
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

    function createDebouncedRunner(run, delay) {
        delay = delay == null ? 200 : Number(delay);
        let timer = 0;
        let token = 0;
        function cancel() {
            window.clearTimeout(timer);
            token++;
            return token;
        }
        function runNow() {
            const current = cancel();
            run(current);
            return current;
        }
        function schedule() {
            const current = cancel();
            timer = window.setTimeout(() => run(current), delay);
            return current;
        }
        return {
            cancel: cancel,
            runNow: runNow,
            schedule: schedule,
            current: () => token,
            isCurrent: (candidate) => candidate === token
        };
    }

    function elementFrom(ref) {
        if (!ref)
            return null;
        if (typeof ref === 'string')
            return document.getElementById(ref) || document.querySelector(ref);
        return ref;
    }

    function cssTimeMs(name, fallback) {
        const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        if (!raw)
            return fallback;
        if (raw.endsWith('ms'))
            return parseFloat(raw) || fallback;
        if (raw.endsWith('s'))
            return (parseFloat(raw) || fallback / 1000) * 1000;
        return parseFloat(raw) || fallback;
    }

    function reducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function pageSlideDurationMs() {
        return Math.max(cssTimeMs('--page-slide-dur', 250), cssTimeMs('--page-fade-dur', 250)) + 40;
    }

    function pageDirectionSign(direction) {
        if (direction === 'back' || direction === 'left' || direction === -1 || direction === '-1')
            return -1;
        return 1;
    }

    function pageOffset(sign) {
        return sign < 0 ? 'calc(var(--page-slide-distance) * -1)' : 'var(--page-slide-distance)';
    }

    function pageSlidePages(root) {
        return Array.from(root.children).filter((el) => el.classList && el.classList.contains('t-page'));
    }

    function pageId(page) {
        return page ? String(page.getAttribute('data-page-id') || '') : '';
    }

    function setPageActive(page, active) {
        page.classList.toggle('is-active', active);
        page.setAttribute('aria-hidden', active ? 'false' : 'true');
        page.inert = !active;
    }

    function initPageSlide(root, initialPage) {
        root = elementFrom(root);
        if (!root)
            return null;
        root.classList.add('t-page-slide');
        if (root.dataset.pageSlideReady === 'true')
            return root;

        const pages = pageSlidePages(root);
        if (!pages.length)
            return root;
        let activeId = initialPage || root.getAttribute('data-page') || '';
        if (!activeId) {
            const visible = pages.find((page) => window.getComputedStyle(page).display !== 'none');
            activeId = pageId(visible || pages[0]);
        }

        pages.forEach((page, index) => {
            page.classList.add('t-page');
            page.hidden = false;
            if (page.style.display === 'none')
                page.style.display = '';
            page.style.setProperty('--t-page-from-x', pageOffset(index === 0 ? -1 : 1));
            setPageActive(page, pageId(page) === String(activeId));
        });
        root.dataset.page = String(activeId);
        root.dataset.pageSlideReady = 'true';
        root.style.removeProperty('height');
        root.classList.remove('is-animating');
        return root;
    }

    function refreshPageSlide(root) {
        root = elementFrom(root);
        if (!root)
            return;
        const active = pageSlidePages(root).find((page) => page.classList.contains('is-active'));
        if (active && root.classList.contains('is-animating'))
            root.style.height = Math.max(active.scrollHeight, active.getBoundingClientRect().height) + 'px';
    }

    function setPageSlidePage(root, nextPage, opts) {
        opts = opts || {};
        root = initPageSlide(root, nextPage);
        if (!root)
            return;
        const pages = pageSlidePages(root);
        const nextId = String(nextPage || '');
        const next = pages.find((page) => pageId(page) === nextId);
        if (!next)
            return;
        const currentId = root.dataset.page || pageId(pages.find((page) => page.classList.contains('is-active'))) || pageId(pages[0]);
        const current = pages.find((page) => pageId(page) === currentId);
        if (currentId === nextId) {
            refreshPageSlide(root);
            return;
        }

        const oldIndex = Math.max(0, pages.indexOf(current));
        const newIndex = Math.max(0, pages.indexOf(next));
        const direction = opts.direction == null
            ? (newIndex >= oldIndex ? 1 : -1)
            : pageDirectionSign(opts.direction);
        const animate = !reducedMotion() && root.dataset.pageSlideReady === 'true';

        if (root.__pageSlideTimer) {
            window.clearTimeout(root.__pageSlideTimer);
            root.__pageSlideTimer = null;
        }
        if (animate) {
            root.style.height = Math.max(root.getBoundingClientRect().height, 1) + 'px';
            root.classList.add('is-animating');
            root.offsetHeight;
        }

        pages.forEach((page, index) => {
            let sign = index < newIndex ? -1 : 1;
            if (page === next)
                sign = direction;
            else if (page === current)
                sign = -direction;
            page.style.setProperty('--t-page-from-x', pageOffset(sign));
        });

        root.dataset.page = nextId;
        pages.forEach((page) => setPageActive(page, page === next));

        if (!animate) {
            root.classList.remove('is-animating');
            root.style.removeProperty('height');
            return;
        }

        root.style.height = Math.max(next.scrollHeight, next.getBoundingClientRect().height) + 'px';
        root.__pageSlideTimer = window.setTimeout(() => {
            root.__pageSlideTimer = null;
            root.classList.remove('is-animating');
            if (root.dataset.page === nextId)
                root.style.removeProperty('height');
        }, pageSlideDurationMs());
    }

    function animateContentIn(el, opts) {
        el = elementFrom(el);
        if (!el || reducedMotion())
            return;
        opts = opts || {};
        const direction = pageDirectionSign(opts.direction);
        if (el.__contentInFrame) {
            window.cancelAnimationFrame(el.__contentInFrame);
            el.__contentInFrame = null;
        }
        if (el.__contentInTimer) {
            window.clearTimeout(el.__contentInTimer);
            el.__contentInTimer = null;
        }
        el.classList.remove('t-content-enter', 'is-entering');
        el.style.setProperty('--t-page-from-x', pageOffset(direction));
        el.offsetHeight;
        el.classList.add('t-content-enter');
        el.__contentInFrame = window.requestAnimationFrame(() => {
            el.__contentInFrame = null;
            el.classList.add('is-entering');
        });
        el.__contentInTimer = window.setTimeout(() => {
            el.__contentInTimer = null;
            el.classList.remove('t-content-enter', 'is-entering');
            el.style.removeProperty('--t-page-from-x');
        }, pageSlideDurationMs());
    }

    function initTooltips() {
        if (document.documentElement.dataset.svnhubTooltips === 'true')
            return;
        document.documentElement.dataset.svnhubTooltips = 'true';

        let tooltip = null;
        let label = null;
        let arrow = null;
        let activeTarget = null;
        let pendingTarget = null;
        let showTimer = 0;
        let hideTimer = 0;

        function ensureTooltip() {
            if (tooltip)
                return;
            tooltip = document.createElement('div');
            tooltip.id = 'svnhub-tooltip';
            tooltip.className = 'app-tooltip app-tooltip--top';
            tooltip.setAttribute('role', 'tooltip');
            tooltip.setAttribute('aria-hidden', 'true');
            label = document.createElement('div');
            label.className = 'app-tooltip-label';
            arrow = document.createElement('div');
            arrow.className = 'app-tooltip-arrow';
            arrow.setAttribute('aria-hidden', 'true');
            tooltip.append(label, arrow);
            document.body.appendChild(tooltip);
        }

        function tooltipText(target) {
            if (!target)
                return '';
            let text = '';
            const targetId = target.getAttribute('data-tooltip-target');
            if (targetId) {
                const source = document.getElementById(targetId);
                if (source && source.textContent.trim())
                    text = source.textContent.trim();
            }
            if (!text) {
                const explicit = target.getAttribute('data-tooltip');
                if (explicit)
                    text = explicit;
            }
            if (!text) {
                const title = target.getAttribute('title');
                if (title) {
                    target.setAttribute('data-tooltip', title);
                    target.setAttribute('data-tooltip-original-title', title);
                    target.removeAttribute('title');
                    text = title;
                }
            }
            return isDuplicateVisibleTooltip(target, text) ? '' : text;
        }

        function normalizeTooltipText(text) {
            return String(text || '').replace(/\s+/g, ' ').trim();
        }

        function visibleTargetText(target) {
            const parts = [];
            const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (!normalizeTooltipText(node.nodeValue))
                        return NodeFilter.FILTER_REJECT;
                    let el = node.parentElement;
                    while (el && el !== target) {
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden')
                            return NodeFilter.FILTER_REJECT;
                        el = el.parentElement;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            let node;
            while ((node = walker.nextNode()))
                parts.push(node.nodeValue);
            return normalizeTooltipText(parts.join(' '));
        }

        function isDuplicateVisibleTooltip(target, text) {
            const tip = normalizeTooltipText(text).toLowerCase();
            const visible = visibleTargetText(target).toLowerCase();
            return !!tip && !!visible && tip === visible;
        }

        function tooltipTarget(node) {
            if (!node || node === document || node === window || !node.closest)
                return null;
            const target = node.closest('[data-tooltip], [data-tooltip-target], [title]');
            if (!target || target.hasAttribute('data-tooltip-disabled'))
                return null;
            const text = tooltipText(target);
            return text ? target : null;
        }

        function clamp(value, min, max) {
            return Math.min(Math.max(value, min), max);
        }

        function placements(preferred) {
            const ordered = [preferred || 'top', 'top', 'bottom', 'right', 'left'];
            return ordered.filter((item, index) => item && ordered.indexOf(item) === index);
        }

        function choosePlacement(preferred, rect, width, height) {
            const gap = 10;
            const pad = 8;
            for (const p of placements(preferred)) {
                if (p === 'top' && rect.top >= height + gap + pad)
                    return p;
                if (p === 'bottom' && window.innerHeight - rect.bottom >= height + gap + pad)
                    return p;
                if (p === 'right' && window.innerWidth - rect.right >= width + gap + pad)
                    return p;
                if (p === 'left' && rect.left >= width + gap + pad)
                    return p;
            }
            return preferred || 'top';
        }

        function targetInViewport(rect) {
            return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        }

        function positionTooltip() {
            if (!activeTarget || !tooltip)
                return;
            const rect = activeTarget.getBoundingClientRect();
            if (!targetInViewport(rect)) {
                hide();
                return;
            }
            const width = tooltip.offsetWidth;
            const height = tooltip.offsetHeight;
            const pad = 8;
            const gap = 10;
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const placement = choosePlacement(activeTarget.getAttribute('data-tooltip-placement'), rect, width, height);
            let left = centerX - width / 2;
            let top = rect.top - height - gap;

            if (placement === 'bottom')
                top = rect.bottom + gap;
            else if (placement === 'right') {
                left = rect.right + gap;
                top = centerY - height / 2;
            } else if (placement === 'left') {
                left = rect.left - width - gap;
                top = centerY - height / 2;
            }

            left = clamp(left, pad, Math.max(pad, window.innerWidth - width - pad));
            top = clamp(top, pad, Math.max(pad, window.innerHeight - height - pad));
            tooltip.className = 'app-tooltip app-tooltip--' + placement + (tooltip.classList.contains('is-open') ? ' is-open' : '');
            tooltip.style.left = Math.round(left) + 'px';
            tooltip.style.top = Math.round(top) + 'px';
            tooltip.style.setProperty('--tooltip-arrow-x', Math.round(clamp(centerX - left, 14, width - 14)) + 'px');
            tooltip.style.setProperty('--tooltip-arrow-y', Math.round(clamp(centerY - top, 14, height - 14)) + 'px');
        }

        function describeTarget(target) {
            if (target.hasAttribute('data-tooltip-prev-describedby'))
                return;
            const current = target.getAttribute('aria-describedby') || '';
            target.setAttribute('data-tooltip-prev-describedby', current);
            if (!current.split(/\s+/).includes('svnhub-tooltip'))
                target.setAttribute('aria-describedby', (current + ' svnhub-tooltip').trim());
        }

        function undescribeTarget(target) {
            if (!target)
                return;
            const previous = target.getAttribute('data-tooltip-prev-describedby');
            target.removeAttribute('data-tooltip-prev-describedby');
            if (previous)
                target.setAttribute('aria-describedby', previous);
            else
                target.removeAttribute('aria-describedby');
        }

        function show(target) {
            const text = tooltipText(target);
            if (!text)
                return;
            window.clearTimeout(hideTimer);
            ensureTooltip();
            if (activeTarget && activeTarget !== target)
                undescribeTarget(activeTarget);
            activeTarget = target;
            pendingTarget = null;
            label.textContent = text;
            tooltip.setAttribute('aria-hidden', 'false');
            describeTarget(target);
            positionTooltip();
            window.requestAnimationFrame(() => {
                if (!activeTarget)
                    return;
                positionTooltip();
                tooltip.classList.add('is-open');
            });
        }

        function scheduleShow(target, delay) {
            window.clearTimeout(showTimer);
            window.clearTimeout(hideTimer);
            pendingTarget = target;
            showTimer = window.setTimeout(() => show(target), delay);
        }

        function hide() {
            window.clearTimeout(showTimer);
            pendingTarget = null;
            if (!tooltip)
                return;
            undescribeTarget(activeTarget);
            activeTarget = null;
            tooltip.classList.remove('is-open');
            tooltip.setAttribute('aria-hidden', 'true');
            window.clearTimeout(hideTimer);
            hideTimer = window.setTimeout(() => {
                if (!activeTarget && label)
                    label.textContent = '';
            }, 70);
        }

        document.addEventListener('pointerover', (e) => {
            if (e.pointerType === 'touch')
                return;
            const target = tooltipTarget(e.target);
            if (target && target !== activeTarget)
                scheduleShow(target, 0);
        });
        document.addEventListener('pointerout', (e) => {
            const target = activeTarget || pendingTarget;
            if (!target || target.contains(e.relatedTarget))
                return;
            hide();
        });
        document.addEventListener('focusin', (e) => {
            const target = tooltipTarget(e.target);
            if (target)
                scheduleShow(target, 0);
        });
        document.addEventListener('focusout', (e) => {
            if (activeTarget && activeTarget === e.target)
                hide();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape')
                hide();
        });
        window.addEventListener('scroll', positionTooltip, true);
        window.addEventListener('resize', positionTooltip);
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

    const DIFF_FILE_PARAM = 'diffFile';
    const DIFF_ROWS_PARAM = 'diffRows';

    function parseDiffRows(value) {
        const rows = new Set();
        String(value || '').split(',').forEach((part) => {
            const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
            if (!m)
                return;
            const a = Number(m[1]);
            const b = Number(m[2] || m[1]);
            const lo = Math.max(1, Math.min(a, b));
            const hi = Math.max(1, Math.max(a, b));
            for (let i = lo; i <= hi && rows.size < 500; i++)
                rows.add(i);
        });
        return rows;
    }

    function formatDiffRows(rows) {
        const vals = Array.from(rows || []).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
        if (!vals.length)
            return '';
        const parts = [];
        let start = vals[0];
        let prev = vals[0];
        for (let i = 1; i <= vals.length; i++) {
            const n = vals[i];
            if (n === prev + 1) {
                prev = n;
                continue;
            }
            parts.push(start === prev ? String(start) : start + '-' + prev);
            start = n;
            prev = n;
        }
        return parts.join(',');
    }

    function diffFileToken(file, index) {
        return (file && file.name) ? file.name : String(index + 1);
    }

    function findDiffFileIndex(files, token) {
        if (!token)
            return -1;
        let idx = files.findIndex((f, i) => diffFileToken(f, i) === token);
        if (idx >= 0)
            return idx;
        if (/^\d+$/.test(token)) {
            idx = Number(token) - 1;
            if (idx >= 0 && idx < files.length)
                return idx;
        }
        return -1;
    }

    function readDiffSelection(files) {
        const params = new URLSearchParams(location.search || '');
        const fileToken = params.get(DIFF_FILE_PARAM) || '';
        const rows = parseDiffRows(params.get(DIFF_ROWS_PARAM) || '');
        const fileIndex = findDiffFileIndex(files, fileToken);
        if (fileIndex < 0 || !rows.size)
            return null;
        return {
            fileIndex: fileIndex,
            fileToken: diffFileToken(files[fileIndex], fileIndex),
            rows: rows,
            anchor: Math.min(...rows),
            pendingScroll: true
        };
    }

    function writeDiffSelection(selection) {
        try {
            const url = new URL(location.href);
            const rows = selection ? formatDiffRows(selection.rows) : '';
            if (selection && selection.fileToken && rows) {
                url.searchParams.set(DIFF_FILE_PARAM, selection.fileToken);
                url.searchParams.set(DIFF_ROWS_PARAM, rows);
            } else {
                url.searchParams.delete(DIFF_FILE_PARAM);
                url.searchParams.delete(DIFF_ROWS_PARAM);
            }
            const target = url.pathname + url.search + url.hash;
            const currentUrl = location.pathname + location.search + location.hash;
            if (target === currentUrl)
                return;
            const state = Object.assign({}, history.state || {}, {
                diffFile: selection && selection.fileToken ? selection.fileToken : '',
                diffRows: rows
            });
            history.replaceState(state, '', target);
        } catch (e) { /* history may be unavailable */ }
    }

    function diffRowElements(section) {
        return Array.from(section.querySelectorAll('tr[data-diff-row]'));
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
        host.__diffSelection = readDiffSelection(files);

        function syncDiffSelectionClasses() {
            sections.forEach((sec, i) => {
                const selection = host.__diffSelection;
                const active = selection && selection.fileIndex === i;
                sec.classList.toggle('has-line-selection', !!active);
                diffRowElements(sec).forEach((row) => {
                    const n = Number(row.getAttribute('data-diff-row'));
                    row.classList.toggle('diff-row-selected', !!active && selection.rows.has(n));
                });
            });
        }

        function scrollSelectedRowsIntoView(i, body) {
            const selection = host.__diffSelection;
            if (!selection || !selection.pendingScroll || selection.fileIndex !== i)
                return;
            const row = body.querySelector('tr.diff-row-selected');
            if (!row)
                return;
            selection.pendingScroll = false;
            setTimeout(() => {
                if (document.body.contains(row))
                    row.scrollIntoView({block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth'});
            }, 30);
        }

        function prepareSelectableRows(i, body) {
            let rowNo = 0;
            body.querySelectorAll('tr').forEach((row) => {
                const lineNo = row.querySelector('.d2h-code-linenumber, .d2h-code-side-linenumber');
                if (!lineNo || !/\d/.test(lineNo.textContent || ''))
                    return;
                rowNo++;
                row.classList.add('diff-selectable-row');
                row.setAttribute('data-diff-row', String(rowNo));
                lineNo.setAttribute('data-diff-row', String(rowNo));
                lineNo.setAttribute('role', 'button');
                lineNo.setAttribute('tabindex', '0');
                lineNo.setAttribute('aria-label', 'Select diff row ' + rowNo);
            });
            syncDiffSelectionClasses();
            scrollSelectedRowsIntoView(i, body);
        }

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
                scrollSelectedRowsIntoView(i, body);
                return;
            }
            body.innerHTML = Diff2Html.html(text,
                {drawFileList: false, matching: 'lines', outputFormat: 'line-by-line'});
            prepareSelectableRows(i, body);
        }

        function expandFile(i, delayed) {
            const sec = sections[i];
            if (!sec)
                return null;
            const body = sec.querySelector('.diff-file-body');
            body.hidden = false;
            sec.classList.add('open');
            if (!body.dataset.rendered) {
                if (delayed) {
                    body.innerHTML = spinner('Rendering…');
                    setTimeout(() => renderBody(i), 15);
                } else {
                    renderBody(i);
                }
            } else {
                syncDiffSelectionClasses();
                scrollSelectedRowsIntoView(i, body);
            }
            return body;
        }

        function selectDiffRow(lineNo, event) {
            const sec = lineNo.closest('.diff-file');
            const row = lineNo.closest('tr[data-diff-row]');
            if (!sec || !row)
                return;
            const fileIndex = Number(sec.getAttribute('data-df'));
            const rowNo = Number(row.getAttribute('data-diff-row'));
            if (!Number.isFinite(fileIndex) || !rowNo)
                return;
            const current = host.__diffSelection;
            const sameFile = current && current.fileIndex === fileIndex;
            let rows = new Set();
            let anchor = rowNo;

            if (event.shiftKey && sameFile && current.anchor) {
                const lo = Math.min(current.anchor, rowNo);
                const hi = Math.max(current.anchor, rowNo);
                rows = (event.metaKey || event.ctrlKey) ? new Set(current.rows) : new Set();
                for (let i = lo; i <= hi; i++)
                    rows.add(i);
                anchor = current.anchor;
            } else if ((event.metaKey || event.ctrlKey) && sameFile) {
                rows = new Set(current.rows);
                if (rows.has(rowNo))
                    rows.delete(rowNo);
                else
                    rows.add(rowNo);
            } else {
                rows.add(rowNo);
            }

            host.__diffSelection = rows.size ? {
                fileIndex: fileIndex,
                fileToken: diffFileToken(files[fileIndex], fileIndex),
                rows: rows,
                anchor: anchor,
                pendingScroll: false
            } : null;
            syncDiffSelectionClasses();
            writeDiffSelection(host.__diffSelection);
        }

        host.querySelector('.diff-files').addEventListener('click', (e) => {
            const lineNo = e.target.closest('.d2h-code-linenumber, .d2h-code-side-linenumber');
            if (lineNo) {
                e.preventDefault();
                e.stopPropagation();
                selectDiffRow(lineNo, e);
                return;
            }
            const head = e.target.closest('.diff-file-head');
            if (!head)
                return;
            const sec = head.closest('.diff-file');
            const i = Number(sec.getAttribute('data-df'));
            const body = sec.querySelector('.diff-file-body');
            if (body.hidden) {
                expandFile(i, true);
            } else {
                body.hidden = true;
                sec.classList.remove('open');
            }
        });
        host.querySelector('.diff-files').addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ')
                return;
            const lineNo = e.target.closest('.d2h-code-linenumber, .d2h-code-side-linenumber');
            if (!lineNo)
                return;
            e.preventDefault();
            selectDiffRow(lineNo, e);
        });

        if (host.__diffSelection)
            expandFile(host.__diffSelection.fileIndex, false);

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

    initTooltips();

    return {esc: esc, initials: initials, personInitials: personInitials, tone: tone, fmtDate: fmtDate,
        relTime: relTime, repoCard: repoCard, statBlock: statBlock, contributorBars: contributorBars,
        weeklySpark: weeklySpark, topReposList: topReposList, commitMessage: commitMessage,
        spinner: spinner, createDebouncedRunner: createDebouncedRunner,
        initTooltips: initTooltips, initExpandableSections: initExpandableSections,
        initPageSlide: initPageSlide, setPageSlidePage: setPageSlidePage,
        refreshPageSlide: refreshPageSlide, animateContentIn: animateContentIn,
        renderUnifiedDiff: renderUnifiedDiff,
        openRepo: openRepo, openPerson: openPerson, goBack: goBack, routeTarget: routeTarget};
})();
