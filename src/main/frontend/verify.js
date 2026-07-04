
/* global $$, Server, Utils, Router */

'use strict';

(function () {

    const WS = 'services/AccountService';

    const email = Utils.getData('email');
    if (email)
        $$('verify-email').setValue(email);

    async function verify() {
        if ($$('code').isError('Code'))
            return;
        const res = await Server.call(WS, 'verifyEmail', {code: $$('code').getValue().trim()});
        if (res._Success) {
            Utils.saveData('emailVerified', true);
            await Utils.showMessage('Verified', 'Your email address has been verified.');
            Router.go('/');
        } else {
            $$('code').clear().focus();
        }
    }

    $$('verify').onclick(verify);
    $$('code').onEnter(verify);

    $$('resend').onclick(async function () {
        const res = await Server.call(WS, 'resendVerification', {});
        if (res._Success) {
            if (res.alreadyVerified === true) {
                Utils.saveData('emailVerified', true);
                Router.go('/');
                return;
            }
            Utils.showMessage('Code sent', 'A new verification code has been sent to your email address.');
        }
    });

    $$('logout').onclick(function () {
        Server.logout();
    });

    $$('code').focus();

})();
