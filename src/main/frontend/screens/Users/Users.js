
/* global $$, Utils, Server, AGGrid */

'use strict';

(async function () {

    const WS = 'services/Users';

    const columnDefs = [
        {headerName: 'User Name', field: 'userName', flex: 1},
        {headerName: 'Full Name', field: 'fullName', flex: 2},
        {headerName: 'Email', field: 'email', flex: 2},
        {headerName: 'Admin', field: 'isAdmin', width: 90},
        {headerName: 'SVN pw', field: 'hasSvnPassword', width: 90},
        {headerName: 'Active', field: 'userActive', width: 90}
    ];
    const grid = new AGGrid('users-grid', columnDefs, 'id');
    grid.show();

    $$('users-active').add('Y', 'Yes');
    $$('users-active').add('N', 'No');
    $$('users-admin').add('N', 'No');
    $$('users-admin').add('Y', 'Yes');

    async function updateGrid() {
        grid.clear();
        $$('users-edit').disable();
        $$('users-delete').disable();
        const res = await Server.call(WS, 'getRecords');
        if (res._Success) {
            if (res.nodb) {
                Utils.showMessage('Error', 'The Users function cannot be used without a database.');
                $$('users-new').disable();
                return;
            }
            grid.addRecords(res.rows);
        }
    }

    function gather(id) {
        return {
            id: id,
            userName: $$('users-user-name').getValue(),
            fullName: $$('users-full-name').getValue(),
            email: $$('users-email').getValue(),
            userPassword: $$('users-password').getValue(),
            svnPassword: $$('users-svn-password').getValue(),
            isAdmin: $$('users-admin').getValue(),
            userActive: $$('users-active').getValue()
        };
    }

    $$('users-new').onclick(() => {
        $$('users-popup-title').setValue('Add User');
        $$('users-user-name').clear();
        $$('users-full-name').clear();
        $$('users-email').clear();
        $$('users-password').clear();
        $$('users-svn-password').clear();
        $$('users-admin').setValue('N');
        $$('users-active').setValue('Y');
        Utils.popup_open('users-edit-popup', 'users-user-name');

        $$('users-ok').onclick(async () => {
            if ($$('users-user-name').isError('User Name'))
                return;
            if ($$('users-password').isError('Login Password'))
                return;
            const res = await Server.call(WS, 'addRecord', gather(null));
            if (res._Success) {
                Utils.popup_close();
                updateGrid();
            }
        });
        $$('users-cancel').onclick(() => Utils.popup_close());
    });

    function edit() {
        const row = grid.getSelectedRow();
        $$('users-popup-title').setValue('Edit User');
        $$('users-user-name').setValue(row.userName);
        $$('users-full-name').setValue(row.fullName);
        $$('users-email').setValue(row.email);
        // Passwords are never sent to the client; leave blank to keep existing.
        $$('users-password').clear();
        $$('users-svn-password').clear();
        $$('users-admin').setValue(row.isAdmin);
        $$('users-active').setValue(row.userActive);
        Utils.popup_open('users-edit-popup', 'users-user-name');

        $$('users-ok').onclick(async () => {
            if ($$('users-user-name').isError('User Name'))
                return;
            const res = await Server.call(WS, 'updateRecord', gather(row.id));
            if (res._Success) {
                Utils.popup_close();
                updateGrid();
            }
        });
        $$('users-cancel').onclick(() => Utils.popup_close());
    }

    $$('users-edit').onclick(edit);
    grid.setOnRowDoubleClicked(edit);

    grid.setOnSelectionChanged((rows) => {
        $$('users-edit').enable(rows);
        $$('users-delete').enable(rows);
    });

    $$('users-delete').onclick(() => {
        Utils.yesNo('Confirmation', 'Are you sure you want to delete the selected user?', async () => {
            const row = grid.getSelectedRow();
            const res = await Server.call(WS, 'deleteRecord', {id: row.id});
            if (res._Success)
                updateGrid();
        });
    });

    updateGrid();

})();
