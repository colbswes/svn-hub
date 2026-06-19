
/* global $$, Utils */

'use strict';

(function () {

    function backToLogin() {
        Utils.loadPage('login');
    }

    $$('why-back').onclick(backToLogin);
    $$('why-back-2').onclick(backToLogin);

})();
