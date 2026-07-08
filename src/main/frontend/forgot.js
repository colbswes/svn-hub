
/* global $$, Server, Utils, Router */

'use strict';

(function () {

    const WS = 'services/PasswordResetService';

    async function sendCode() {
        if ($$('email').isError('Email'))
            return;
        const email = $$('email').getValue().trim().toLowerCase();
        const res = await Server.call(WS, 'requestReset', {email: email});
        if (res._Success) {
            // The server always reports success (it never reveals whether the
            // account exists), so the message is deliberately conditional.
            $$('sent-msg').setValue('If an account exists for that email, a code has been sent. ' +
                'Go to the sign-in page and enter that code in place of your password.');
            $$('send-code').disable();
        }
    }

    $$('send-code').onclick(sendCode);
    $$('email').onEnter(sendCode);
    $$('to-login').onclick(function () {
        Router.go('/login');
    });

    $$('email').focus();

})();
