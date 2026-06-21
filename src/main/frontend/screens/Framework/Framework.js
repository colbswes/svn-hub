
/* global $$, Utils, Server */

'use strict';

(async function () {

    const screenArea = 'app-screen-area';

    $$('repositories').onclick(function () {
        Utils.cleanup();
        Utils.loadPage('screens/Repositories/Repositories', screenArea);
    });

    $$('discover').onclick(function () {
        Utils.cleanup();
        Utils.loadPage('screens/Discover/Discover', screenArea);
    });

    $$('insights').onclick(function () {
        Utils.cleanup();
        Utils.loadPage('screens/Insights/Insights', screenArea);
    });

    $$('users').onclick(function () {
        Utils.cleanup();
        Utils.loadPage('screens/Users/Users', screenArea);
    });

    $$('logout').onclick(function () {
        Server.logout();
    });

    // Account area: show the signed-in handle and offer a password change.
    $$('acct-name').setValue(Utils.getData('handle') || '');

    $$('change-pw').onclick(function () {
        $$('cpw-current').clear();
        $$('cpw-new').clear();
        $$('cpw-confirm').clear();
        Utils.popup_open('change-pw-popup', 'cpw-current');

        $$('cpw-ok').onclick(async function () {
            if ($$('cpw-current').isError('Current password'))
                return;
            if ($$('cpw-new').isError('New password'))
                return;
            const next = $$('cpw-new').getValue();
            if (next.length < 6) {
                Utils.showMessage('Error', 'Your new password must be at least 6 characters.');
                return;
            }
            if (next !== $$('cpw-confirm').getValue()) {
                Utils.showMessage('Error', 'The new passwords do not match.');
                return;
            }
            const res = await Server.call('services/AccountService', 'changePassword', {
                currentPassword: $$('cpw-current').getValue(),
                newPassword: next
            });
            if (res._Success) {
                Utils.popup_close();
                // The session still holds the old credential, so sign out and have
                // them sign back in with the new password (also used for svn).
                await Utils.showMessage('Password changed',
                    'Your password has been updated (web UI and svn). Please sign in again with your new password.');
                Server.logout();
            }
        });
        $$('cpw-cancel').onclick(() => Utils.popup_close());
    });

    // User administration is admin-only; hide it for regular users.
    if (Utils.getData('isAdmin') !== true)
        $$('users').hide();

    // Land on the repository list by default.
    Utils.cleanup();
    Utils.loadPage('screens/Repositories/Repositories', screenArea);

})();
