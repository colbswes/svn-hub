
/* global $$, DOMUtils, Server, Utils */

'use strict';

(function () {

    async function login() {
        if ($$('username').isError('Email'))
            return;
        if ($$('password').isError('Password'))
            return;

        const data = {
            username: $$('username').getValue().toLowerCase(),
            password: $$('password').getValue()
        };
        const res = await Server.call('', 'Login', data);
        if (res._Success) {
            Server.setUUID(res.uuid);
            Utils.saveData('isAdmin', res.isAdmin === true);
            DOMUtils.preventNavigation(true, function() {
                Utils.yesNo('Confirm', 'Are you sure you want to logout?', function() {
                    Server.logout();
                });
            });
            Utils.loadPage('screens/Framework/Framework');
        } else {
            $$('password').clear().focus();
        }
    }

    $$('login').onclick(login);

    $$('why-button').onclick(function () {
        Utils.loadPage('why');
    });

    $$('to-register').onclick(function () {
        Utils.loadPage('register');
    });

    $$('username').onEnter(function () {
        $$('password').focus();
    });

    $$('password').onEnter(function () {
        login();
    });

    $$('username').focus();

})();
