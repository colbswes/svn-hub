
/* global $$, Utils */

'use strict';

(async function () {

    const screenArea = 'app-screen-area';

    $$('as-back').onclick(function () {
        Utils.routePage('screens/Help/Help', screenArea);
    });

    if (Utils.setAppNavActive)
        Utils.setAppNavActive('help');

})();
