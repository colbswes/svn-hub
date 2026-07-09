/* global window, document */

'use strict';

(function () {

    let modal = null;
    let closeTimer = null;
    let openFrame = null;
    let lastFocus = null;
    let documentListenerBound = false;

    const modalHtml = `
<div class="why-modal-overlay" id="why-service-modal" hidden>
    <div class="why-modal-dialog t-modal" role="dialog" aria-modal="true" aria-labelledby="why-modal-title">
        <header class="why-modal-header">
            <div>
                <div class="eyebrow"><span class="tick">▍</span> Service explanation</div>
                <h1 id="why-modal-title">Why This Service Exists</h1>
            </div>
            <button type="button" class="why-modal-x" id="why-modal-x" aria-label="Close">&times;</button>
        </header>

        <div class="why-modal-body" tabindex="-1">
            <section class="why-modal-lede">
                <p>Modern source-code hosting has largely converged around one model: Git-based platforms controlled by large centralized providers.</p>
                <p>That model works well for many projects. But it is not the only useful model, and it is not always the best one.</p>
                <p>This service exists to provide a practical alternative: a modern, free, web-based development platform built around Subversion, clearer project governance, better repository visibility, and independence from large corporate control.</p>
                <p>It is not trying to be a clone of existing Git platforms.</p>
                <p>It is built for teams and projects that value simplicity, auditability, central authority, practical statistics, and long-term control.</p>
            </section>

            <section>
                <h2>A Better Fit for Many Projects</h2>
                <p>Git is powerful, flexible, and extremely successful. It is especially well suited to large open-source ecosystems, distributed teams, and fork-heavy contribution models.</p>
                <p>But many projects do not work that way.</p>
                <p>Internal business applications, client projects, regulated systems, small teams, centrally managed repositories, and many private software projects often benefit from a single authoritative source of truth.</p>
                <p>Subversion is a strong fit for that model.</p>
                <p>With Subversion, there is one canonical repository, one official project history, and a simple sequence of globally ordered revision numbers. Users update, make changes, and commit. The repository moves forward in a clear, understandable way.</p>
                <p>This creates a simpler mental model and a more predictable workflow.</p>
                <p>Git allows local history rewriting, rebasing, squashing, force pushes, and divergent local histories. Those features can be useful, but they also introduce complexity and opportunities for confusion. Subversion favors stable, append-only history and clear authority by design.</p>
                <p>For teams that care about audit trails, accountability, historical integrity, and straightforward reconstruction of prior system states, Subversion remains a rational and often superior choice.</p>
            </section>

            <section>
                <h2>Better Statistics and Visibility</h2>
                <p>A centralized repository model makes it possible to provide statistics that are difficult to produce accurately in a fully distributed system.</p>
                <p>This service is designed to offer improved visibility into how repositories are actually being used.</p>
                <p>That can include activity by user, repository history, revision progress, checkout and update behavior, working-copy freshness, and how far users may be behind the current repository state.</p>
                <p>These statistics are not just decorative. They help teams understand project activity, spot stale work, identify coordination problems, and manage repositories more effectively.</p>
                <p>Source hosting should not merely store code. It should help people understand what is happening in their projects.</p>
            </section>

            <section>
                <h2>Independent of Large Corporate Platforms</h2>
                <p>Much of modern software development depends on platforms controlled by large corporations.</p>
                <p>Those platforms can be useful and polished, but they also create dependency. Policies can change. Features can be added or removed. Pricing can shift. Accounts can be restricted. Workflows can become shaped by the business goals of the platform owner.</p>
                <p>This service exists as an independent alternative.</p>
                <p>It is designed for users who want control over their development infrastructure and do not want every project forced into the same corporate ecosystem.</p>
                <p>Independence matters because source code is not just another file type. It is the working memory of a project, a business, or a community.</p>
                <p>The tools that manage it should be trustworthy, understandable, and not unnecessarily dependent on a single dominant vendor.</p>
            </section>

            <section>
                <h2>Free to Use</h2>
                <p>This service is also intended to be free.</p>
                <p>A good source-code hosting system should be available to individuals, small teams, students, hobbyists, businesses, and organizations without imposing unnecessary barriers.</p>
                <p>Free access encourages experimentation, learning, collaboration, and long-term use.</p>
                <p>The goal is to provide a useful platform without forcing users into commercial lock-in or platform dependency.</p>
            </section>

            <section>
                <h2>Modern Web Features Around a Proven Version-Control System</h2>
                <p>Subversion is mature, stable, and proven. But many users expect the convenience of modern web-based development platforms.</p>
                <p>This service brings those ideas together.</p>
                <p>It provides a GitHub-like experience around SVN: repository browsing, history, diffs, issue tracking, merge requests, project visibility, and useful statistics, while preserving the core advantages of Subversion's centralized model.</p>
                <p>The result is not nostalgia for an older tool.</p>
                <p>It is a modern application built around a version-control model that still makes sense for many real-world projects.</p>
            </section>

            <section>
                <h2>The Principle</h2>
                <p>This service exists because one size does not fit all.</p>
                <p>Git is excellent for some workflows. Subversion is better for others.</p>
                <p>Corporate platforms are convenient for some users. Independent platforms are important for others.</p>
                <p>Maximum flexibility is valuable in some environments. Simplicity, governance, and stable history are more valuable in others.</p>
                <p>This service is for the projects and teams that want a clear, practical, free, and independent alternative.</p>
            </section>
        </div>

        <footer class="why-modal-footer">
            <button type="button" class="why-modal-close" id="why-modal-close">Close</button>
        </footer>
    </div>
</div>`;

    function modalCloseDuration() {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            return 0;
        const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur').trim();
        if (!raw)
            return 150;
        if (raw.endsWith('ms'))
            return parseFloat(raw) || 150;
        if (raw.endsWith('s'))
            return (parseFloat(raw) || 0.15) * 1000;
        return parseFloat(raw) || 150;
    }

    function ensureModal() {
        if (modal && document.body.contains(modal))
            return modal;
        modal = document.getElementById('why-service-modal');
        if (modal && document.body.contains(modal))
            return modal;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('why-service-modal');
        document.getElementById('why-modal-x').addEventListener('click', close);
        document.getElementById('why-modal-close').addEventListener('click', close);
        modal.addEventListener('click', function (e) {
            if (e.target === modal)
                close();
        });
        if (!documentListenerBound) {
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && modal && document.body.contains(modal) && !modal.hidden)
                    close();
            });
            documentListenerBound = true;
        }
        return modal;
    }

    function open() {
        const el = ensureModal();
        lastFocus = document.activeElement;
        if (closeTimer) {
            window.clearTimeout(closeTimer);
            closeTimer = null;
        }
        if (openFrame) {
            window.cancelAnimationFrame(openFrame);
            openFrame = null;
        }
        el.hidden = false;
        const dialog = el.querySelector('.why-modal-dialog');
        if (dialog)
            dialog.classList.remove('is-open', 'is-closing');
        document.body.classList.add('why-modal-open');
        openFrame = window.requestAnimationFrame(function () {
            openFrame = null;
            el.classList.add('open');
            if (dialog)
                dialog.classList.add('is-open');
            const body = el.querySelector('.why-modal-body');
            if (body)
                body.scrollTop = 0;
            document.getElementById('why-modal-x').focus();
        });
    }

    function close() {
        const el = ensureModal();
        if (closeTimer)
            return;
        const dialog = el.querySelector('.why-modal-dialog');
        if (openFrame) {
            window.cancelAnimationFrame(openFrame);
            openFrame = null;
        }
        el.classList.remove('open');
        if (dialog) {
            dialog.classList.remove('is-open');
            dialog.classList.add('is-closing');
        }
        document.body.classList.remove('why-modal-open');
        closeTimer = window.setTimeout(function () {
            if (dialog)
                dialog.classList.remove('is-closing');
            el.hidden = true;
            closeTimer = null;
            if (lastFocus && lastFocus.focus)
                lastFocus.focus();
        }, modalCloseDuration());
    }

    window.SvnHubWhyModal = {
        open: open,
        close: close
    };

})();
