
/* global $$, Utils, Router */

'use strict';

(async function () {

    $$('as-back').onclick(function () {
        Router.go('/help');
    });

    if (Utils.setAppNavActive)
        Utils.setAppNavActive('help');

})();
