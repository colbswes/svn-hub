
/* global $$, Utils, Server, AGGrid */

'use strict';

(async function () {

    const WS = 'services/Users';
    const adminLead = document.getElementById('admin-lead');
    const scanResult = document.getElementById('admin-scan-result');
    const userFilterSummary = document.getElementById('users-filter-summary');
    const passwordRequiredMark = document.getElementById('users-password-required');
    const userFilterLabels = {
        all: 'Showing all users.',
        active: 'Showing active users.',
        admins: 'Showing administrators.',
        svn: 'Showing users with SVN passwords.'
    };
    let userRows = [];
    let userFilter = 'all';

    function yn(value) {
        return value === 'Y' ? 'Yes' : 'No';
    }

    function setAdminPanel(panel) {
        const userMode = panel === 'users';
        document.getElementById('admin-users-panel').style.display = userMode ? '' : 'none';
        document.getElementById('admin-scan-panel').style.display = userMode ? 'none' : '';
        document.getElementById('users-toolbar').style.display = userMode ? '' : 'none';
        $$('admin-tab-users').element.classList.toggle('active', userMode);
        $$('admin-tab-scan').element.classList.toggle('active', !userMode);
        adminLead.textContent = userMode
            ? 'Manage logins, SVN credentials, account status, and administrator access.'
            : 'Import server-side SVN repositories that already exist on disk.';
    }

    $$('admin-tab-users').onclick(() => setAdminPanel('users'));
    $$('admin-tab-scan').onclick(() => setAdminPanel('scan'));
    $$('admin-scan-run').onclick(async () => {
        scanResult.textContent = 'Scanning repository root...';
        $$('admin-scan-run').disable();
        const res = await Server.call('services/RepositoryService', 'scanRepositories');
        $$('admin-scan-run').enable();
        if (res._Success) {
            scanResult.textContent = 'Scan complete. Added ' + res.added + ' repository(ies).';
            Utils.toast.success('Repository scan complete');
        } else {
            scanResult.textContent = 'Scan did not complete.';
        }
    });

    const columnDefs = [
        {headerName: 'Username', field: 'handle', width: 140},
        {headerName: 'Login ID', field: 'userName', flex: 1},
        {headerName: 'Full Name', field: 'fullName', flex: 2},
        {headerName: 'Email', field: 'email', flex: 2},
        {headerName: 'Admin', field: 'adminDisplay', width: 90},
        {headerName: 'SVN pw', field: 'svnDisplay', width: 90},
        {headerName: 'Active', field: 'activeDisplay', width: 90}
    ];
    const grid = new AGGrid('users-grid', columnDefs, 'id');
    grid.show();

    function filteredUserRows() {
        if (userFilter === 'active')
            return userRows.filter((r) => r.userActive === 'Y');
        if (userFilter === 'admins')
            return userRows.filter((r) => r.isAdmin === 'Y');
        if (userFilter === 'svn')
            return userRows.filter((r) => r.hasSvnPassword === 'Y');
        return userRows;
    }

    function renderUserFilter() {
        document.querySelectorAll('.admin-filter-card').forEach((card) => {
            const selected = card.getAttribute('data-user-filter') === userFilter;
            card.classList.toggle('active', selected);
            card.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        userFilterSummary.textContent = userFilterLabels[userFilter];
        grid.setRowData(filteredUserRows());
        grid.clearSelection();
        $$('users-edit').disable();
        $$('users-delete').disable();
    }

    function setUserFilter(filter) {
        userFilter = filter;
        renderUserFilter();
    }

    document.querySelectorAll('.admin-filter-card').forEach((card) => {
        card.addEventListener('click', () => setUserFilter(card.getAttribute('data-user-filter')));
    });

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
            userRows = res.rows.map((r) => Object.assign({}, r, {
                adminDisplay: yn(r.isAdmin),
                activeDisplay: yn(r.userActive),
                svnDisplay: yn(r.hasSvnPassword)
            }));
            $$('users-total').setValue(String(userRows.length));
            $$('users-active-total').setValue(String(userRows.filter((r) => r.userActive === 'Y').length));
            $$('users-admin-total').setValue(String(userRows.filter((r) => r.isAdmin === 'Y').length));
            $$('users-svn-total').setValue(String(userRows.filter((r) => r.hasSvnPassword === 'Y').length));
            renderUserFilter();
        }
    }

    function gather(id) {
        return {
            id: id,
            userName: $$('users-user-name').getValue(),
            handle: $$('users-handle').getValue(),
            fullName: $$('users-full-name').getValue(),
            email: $$('users-email').getValue(),
            userPassword: $$('users-password').getValue(),
            svnPassword: $$('users-svn-password').getValue(),
            isAdmin: $$('users-admin').getValue() ? 'Y' : 'N',
            userActive: $$('users-active').getValue() ? 'Y' : 'N'
        };
    }

    const editRequiredFields = [
        {id: 'users-user-name', label: 'Login ID'},
        {id: 'users-handle', label: 'Username'}
    ];
    const addRequiredFields = editRequiredFields.concat([
        {id: 'users-password', label: 'Login Password'}
    ]);
    let currentRequiredFields = editRequiredFields;

    function hasRequiredValue(field) {
        return !!$$(field.id).getValue();
    }

    function updateSaveState() {
        $$('users-ok').enable(currentRequiredFields.every(hasRequiredValue));
    }

    function validateRequiredFields() {
        for (const field of currentRequiredFields) {
            if (hasRequiredValue(field))
                continue;
            Utils.showMessage('Error', field.label + ' is required.').then(() => $$(field.id).focus());
            updateSaveState();
            return false;
        }
        return true;
    }

    function setUserModalMode(mode) {
        const adding = mode === 'add';
        currentRequiredFields = adding ? addRequiredFields : editRequiredFields;
        if (passwordRequiredMark)
            passwordRequiredMark.style.display = adding ? '' : 'none';
        updateSaveState();
    }

    addRequiredFields.forEach((field) => {
        $$(field.id).element.addEventListener('input', updateSaveState);
        $$(field.id).element.addEventListener('change', updateSaveState);
    });

    $$('users-new').onclick(() => {
        $$('users-popup-title').setValue('Add User');
        $$('users-user-name').clear();
        $$('users-handle').clear();
        $$('users-full-name').clear();
        $$('users-email').clear();
        $$('users-password').clear();
        $$('users-svn-password').clear();
        $$('users-admin').setValue(false);
        $$('users-active').setValue(true);
        setUserModalMode('add');
        Utils.popup_open('users-edit-popup', 'users-user-name');

        $$('users-ok').onclick(async () => {
            if (!validateRequiredFields())
                return;
            if ($$('users-user-name').isError('Login ID'))
                return;
            if ($$('users-handle').isError('Username'))
                return;
            const res = await Server.call(WS, 'addRecord', gather(null));
            if (res._Success) {
                Utils.popup_close();
                Utils.toast.success('User saved');
                updateGrid();
            }
        });
        $$('users-cancel').onclick(() => Utils.popup_close());
    });

    function edit() {
        const row = grid.getSelectedRow();
        $$('users-popup-title').setValue('Edit User');
        $$('users-user-name').setValue(row.userName);
        $$('users-handle').setValue(row.handle);
        $$('users-full-name').setValue(row.fullName);
        $$('users-email').setValue(row.email);
        // Passwords are never sent to the client; leave blank to keep existing.
        $$('users-password').clear();
        $$('users-svn-password').clear();
        $$('users-admin').setValue(row.isAdmin === 'Y');
        $$('users-active').setValue(row.userActive === 'Y');
        setUserModalMode('edit');
        Utils.popup_open('users-edit-popup', 'users-user-name');

        $$('users-ok').onclick(async () => {
            if (!validateRequiredFields())
                return;
            if ($$('users-user-name').isError('Login ID'))
                return;
            if ($$('users-handle').isError('Username'))
                return;
            const res = await Server.call(WS, 'updateRecord', gather(row.id));
            if (res._Success) {
                Utils.popup_close();
                Utils.toast.success('User saved');
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

    if (Utils.setAppNavActive)
        Utils.setAppNavActive('users');
    setAdminPanel('users');
    updateGrid();

})();
