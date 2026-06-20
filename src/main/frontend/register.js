
/* global $$, DOMUtils, Server, Utils */

'use strict';

(function () {

    async function doRegister() {
        if ($$('email').isError('Email'))
            return;
        if ($$('handle').isError('Username'))
            return;
        if ($$('password').isError('Password'))
            return;
        if ($$('password2').isError('Confirm'))
            return;
        const email = $$('email').getValue().trim().toLowerCase();
        const handle = $$('handle').getValue().trim().toLowerCase();
        // Same rule the server enforces: letters/digits/dash/underscore, no spaces,
        // starting with a letter or digit, 1-64 characters.
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(handle)) {
            await Utils.showMessage('Invalid username',
                'Your username may contain only letters, digits, dash and underscore (no spaces), ' +
                'must start with a letter or digit, and be at most 64 characters.');
            $$('handle').focus();
            return;
        }
        const password = $$('password').getValue();
        if (password !== $$('password2').getValue()) {
            Utils.showMessage('Error', 'The passwords do not match.');
            return;
        }

        const res = await Server.call('services/Register', 'register', {
            email: email,
            handle: handle,
            password: password,
            fullName: $$('full-name').getValue()
        });
        if (!res._Success)
            return;   // the framework already showed the error

        // GitHub-style: log the new user straight in.
        const login = await Server.call('', 'Login', {username: email, password: password});
        if (login._Success) {
            Server.setUUID(login.uuid);
            Utils.saveData('isAdmin', login.isAdmin === true);
            DOMUtils.preventNavigation(true, function () {
                Utils.yesNo('Confirm', 'Are you sure you want to logout?', function () {
                    Server.logout();
                });
            });
            Utils.loadPage('screens/Framework/Framework');
        } else {
            Utils.loadPage('login');
        }
    }

    $$('register').onclick(doRegister);
    $$('password2').onEnter(doRegister);
    $$('to-login').onclick(function () {
        Utils.loadPage('login');
    });
    $$('email').focus();

})();
