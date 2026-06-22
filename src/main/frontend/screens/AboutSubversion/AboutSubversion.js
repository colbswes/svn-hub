
/* global $$, Utils */

'use strict';

(async function () {

    const screenArea = 'app-screen-area';

    $$('as-back').onclick(function () {
        Utils.cleanup();
        Utils.loadPage('screens/Help/Help', screenArea);
    });

})();
