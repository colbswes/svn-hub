
/* global $$, Utils */

'use strict';

(async function () {

    const screenArea = 'app-screen-area';

    $$('about-subversion').onclick(function () {
        Utils.cleanup();
        Utils.loadPage('screens/AboutSubversion/AboutSubversion', screenArea);
    });

})();
