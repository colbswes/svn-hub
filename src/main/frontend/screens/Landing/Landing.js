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
        repositories: 'repositories',
        repository: 'repositories',
        insights: 'insights',
        help: 'help',
        why: 'why'
    };

    const links = document.querySelectorAll('.home [data-nav]');
    for (let i = 0; i < links.length; i++) {
        const el = links[i];
        const target = navMap[el.getAttribute('data-nav')] || 'discover';
        el.addEventListener('click', function () {
            if (target === 'why') {
                showWhyPage();
                return;
            }
            navClick(target);
        });
        el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (target === 'why') {
                    showWhyPage();
                    return;
                }
                navClick(target);
            }
        });
    }

})();
