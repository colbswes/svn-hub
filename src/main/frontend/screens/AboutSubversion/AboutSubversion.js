
/* global $$, Router */

'use strict';

(async function () {

    $$('as-back').onclick(function () {
        Router.go('/help');
    });

})();
