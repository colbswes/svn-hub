
/* global $$, Server, Utils */

'use strict';

(function () {

    // The reset code the user just signed in with authorizes the change.
    const code = Utils.getData('resetCredential') || '';

    async function setPassword() {
        if ($$('password').isError('New password'))
            return;
        if ($$('password2').isError('Confirm'))
            return;
        const pw = $$('password').getValue();
        if (pw.length < 6) {
            Utils.showMessage('Error', 'Your new password must be at least 6 characters.');
            return;
        }
        if (pw !== $$('password2').getValue()) {
            Utils.showMessage('Error', 'The passwords do not match.');
            return;
        }
        const res = await Server.call('services/AccountService', 'changePassword', {
            currentPassword: code,
            newPassword: pw
        });
        if (res._Success) {
            Utils.saveData('resetCredential', null);
            Utils.toast.success('Password set');
            await Utils.showMessage('Password set', 'Your new password is ready. Please sign in.');
            Server.logout();   // clears the temporary session; returns to the login page
        }
    }

    $$('set').onclick(setPassword);
    $$('password2').onEnter(setPassword);
    $$('cancel').onclick(function () {
        Utils.saveData('resetCredential', null);
        Server.logout();
    });

    $$('password').focus();

})();
