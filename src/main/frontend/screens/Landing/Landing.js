/* global $$, Utils, SvnHubWhyModal */
'use strict';

(function () {

    if (Utils.setAppNavActive)
        Utils.setAppNavActive(null);

    // Dispatch through the shell's real nav buttons so routing, active-state,
    // and guest handling all stay in one place (Framework.js).
    function navClick(id) {
        const btn = $$(id);
        if (btn && btn.element)
            btn.element.click();
    }

    function showWhyPage() {
        SvnHubWhyModal.open();
    }

    function openSignUp() {
        try {
            sessionStorage.setItem('svnhub.authMode', 'register');
        } catch (err) {
            // If sessionStorage is unavailable, the normal sign-in page still works.
        }
        navClick('signin');
    }

    const guest = Utils.getData('guest') === true;
    if (guest)
        $$('home-create').setValue('Sign Up');

    const authScoped = document.querySelectorAll('.home [data-auth]');
    for (let i = 0; i < authScoped.length; i++) {
        const el = authScoped[i];
        const mode = el.getAttribute('data-auth');
        el.hidden = (mode === 'guest' && !guest) || (mode === 'signed-in' && guest);
    }

    $$('home-create').onclick(function () {
        if (guest) {
            openSignUp();
            return;
        }
        Utils.saveData('openNewRepo', true);
        navClick('repositories');
    });
    $$('home-explore').onclick(function () {
        navClick('discover');
    });

    const navMap = {
        discover: 'discover',
        home: 'repositories',
        repository: 'repositories',
        insights: 'insights',
        help: 'help',
        signin: 'signin',
        signup: 'signup',
        why: 'why'
    };

    function openHelpTopic(topic) {
        Utils.saveData('helpTopic', topic);
        navClick('help');
    }

    function followFooterLink(el) {
        const topic = el.getAttribute('data-help-topic');
        if (topic) {
            openHelpTopic(topic);
            return;
        }
        const target = navMap[el.getAttribute('data-nav')] || 'discover';
        if (target === 'why') {
            showWhyPage();
            return;
        }
        if (target === 'signup') {
            openSignUp();
            return;
        }
        navClick(target);
    }

    function initTilt(el) {
        const card = el.querySelector('.t-tilt-card');
        if (!card || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches))
            return;
        const maxTilt = 7;
        function update(e) {
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height)
                return;
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            const rx = (0.5 - y) * maxTilt;
            const ry = (x - 0.5) * maxTilt;
            card.style.setProperty('--tilt-rx', rx.toFixed(2) + 'deg');
            card.style.setProperty('--tilt-ry', ry.toFixed(2) + 'deg');
            card.style.setProperty('--tilt-gx', (x * 100).toFixed(1) + '%');
            card.style.setProperty('--tilt-gy', (y * 100).toFixed(1) + '%');
            el.classList.add('is-hover');
            card.classList.add('is-tilting');
        }
        function reset() {
            el.classList.remove('is-hover');
            card.classList.remove('is-tilting');
            card.style.setProperty('--tilt-rx', '0deg');
            card.style.setProperty('--tilt-ry', '0deg');
            card.style.setProperty('--tilt-gx', '50%');
            card.style.setProperty('--tilt-gy', '50%');
        }
        el.addEventListener('pointermove', update);
        el.addEventListener('pointerenter', update);
        el.addEventListener('pointerleave', reset);
        el.addEventListener('pointercancel', reset);
    }

    document.querySelectorAll('.home .artifact-tilt').forEach(initTilt);

    const links = document.querySelectorAll('.home [data-nav]');
    const topicLinks = document.querySelectorAll('.home [data-help-topic]');
    const allFooterLinks = Array.from(links).concat(Array.from(topicLinks));
    for (let i = 0; i < allFooterLinks.length; i++) {
        const el = allFooterLinks[i];
        el.addEventListener('click', function () {
            followFooterLink(el);
        });
        el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                followFooterLink(el);
            }
        });
    }

})();
