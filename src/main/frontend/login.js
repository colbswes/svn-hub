
/* global $$, Server, Utils, Router */

'use strict';

(function () {

    //  Reaching the login screen ends any existing session so a fresh login is required
    //  (e.g. when the user backs into it from inside the app).
    Server.clearSession();

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
            Server.setBootId(res._BootId);   //  record the server instance this session belongs to
            Utils.saveData('isAdmin', res.isAdmin === true);
            Utils.saveData('handle', res.handle);
            Utils.saveData('email', res.email);
            Utils.saveData('emailVerified', res.emailVerified === true);
            if (res.usedResetCode === true) {
                // Signed in with an emailed reset code → must set a new password.
                // Carry the code so the (authenticated) change-password can use it.
                Utils.saveData('resetCredential', data.password);
                Router.go('/setpw');
            } else if (res.emailVerified === true) {
                //  Go where the user was originally headed (deep link), else the home shell.
                Router.go(Router.returnTarget());
            } else {
                // Gate the app until the email address is verified.
                Router.go('/verify');
            }
        } else {
            $$('password').clear().focus();
        }
    }

    $$('login').onclick(login);

    $$('why-button').onclick(function () {
        Router.go('/why');
    });

    $$('to-register').onclick(function () {
        Router.go('/register');
    });

    $$('to-forgot').onclick(function () {
        Router.go('/forgot');
    });

    $$('username').onEnter(function () {
        $$('password').focus();
    });

    $$('password').onEnter(function () {
        login();
    });

    $$('username').focus();

})();
