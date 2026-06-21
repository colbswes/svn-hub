
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
            Utils.saveData('handle', res.handle);
            Utils.saveData('email', res.email);
            Utils.saveData('emailVerified', res.emailVerified === true);
            if (res.usedResetCode === true) {
                // Signed in with an emailed reset code → must set a new password.
                // Carry the code so the (authenticated) change-password can use it.
                Utils.saveData('resetCredential', data.password);
                Utils.loadPage('setpw');
            } else if (res.emailVerified === true) {
                DOMUtils.preventNavigation(true, function() {
                    Utils.yesNo('Confirm', 'Are you sure you want to logout?', function() {
                        Server.logout();
                    });
                });
                Utils.loadPage('screens/Framework/Framework');
            } else {
                // Gate the app until the email address is verified.
                Utils.loadPage('verify');
            }
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

    $$('to-forgot').onclick(function () {
        Utils.loadPage('forgot');
    });

    $$('username').onEnter(function () {
        $$('password').focus();
    });

    $$('password').onEnter(function () {
        login();
    });

    $$('username').focus();

})();
