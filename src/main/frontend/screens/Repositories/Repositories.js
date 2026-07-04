/* global $$, Utils, Server, AGGrid */
'use strict';

(async function () {

    const WS_REPO = 'services/RepositoryService';
    const WS_ACC = 'services/RepositoryAccessService';

    let isAdmin = Utils.getData('isAdmin') === true;
    let currentRepo = null;
    let accessRepoId = null;
    let accSelected = null;

    const repoCols = [
        {headerName: 'Owner', field: 'ownerDisplay', width: 150},
        {headerName: 'Name', field: 'name', flex: 2},
        {headerName: 'Visibility', field: 'visibility', width: 110},
        {headerName: 'HEAD', field: 'headRevision', width: 80}
    ];
    const repoGrid = new AGGrid('repo-grid', repoCols, 'repoId');
    repoGrid.show();

    function toRow(r) {
        return Object.assign({}, r, {ownerDisplay: (r.ownerHandle || '') + (r.owned ? ' (you)' : '')});
    }

    async function loadMine() {
        $$('repo-heading').setValue('My Repositories');
        repoGrid.clear();
        $$('repo-access').disable();
        $$('repo-checkout-url').clear();
        const res = await Server.call(WS_REPO, 'getRepositories');
        if (res._Success) {
            isAdmin = res.isAdmin;
            repoGrid.addRecords(res.rows.map(toRow));
        }
    }

    async function loadExplore() {
        $$('repo-heading').setValue('Explore Repositories');
        repoGrid.clear();
        $$('repo-access').disable();
        $$('repo-checkout-url').clear();
        const res = await Server.call(WS_REPO, 'searchRepositories', {query: $$('repo-search').getValue()});
        if (res._Success)
            repoGrid.addRecords(res.rows.map(toRow));
    }

    $$('mode-mine').onclick(loadMine);
    $$('mode-explore').onclick(loadExplore);
    $$('repo-search-go').onclick(loadExplore);
    $$('repo-search').onEnter(loadExplore);

    repoGrid.setOnSelectionChanged((rows) => {
        currentRepo = repoGrid.getSelectedRow();
        $$('repo-checkout-url').setValue(currentRepo ? (currentRepo.checkoutUrl || '') : '');
        // Manage access only for repos you own or administer.
        $$('repo-access').enable(rows && currentRepo && (isAdmin || currentRepo.owned));
    });
    repoGrid.setOnRowDoubleClicked(openRepo);

    function openRepo() {
        const row = repoGrid.getSelectedRow();
        if (!row)
            return;
        Utils.saveData('repoId', row.repoId);
        Utils.saveData('repoKey', row.repoKey);
        Utils.saveData('repoName', row.name);
        Router.go('/repository');
    }
    $$('repo-open').onclick(openRepo);

    // ---- create repository ----
    $$('repo-new').onclick(() => {
        $$('nr-key').clear();
        $$('nr-desc').clear();
        $$('nr-vis').setValue('private');
        $$('nr-layout').setValue(true);
        Utils.popup_open('new-repo-popup', 'nr-key');
    });
    $$('nr-cancel').onclick(() => Utils.popup_close());
    $$('nr-ok').onclick(async () => {
        if ($$('nr-key').isError('Repository Name'))
            return;
        const data = {
            repoKey: $$('nr-key').getValue().trim(),
            description: $$('nr-desc').getValue().trim(),
            visibility: $$('nr-vis').getValue(),
            standardLayout: $$('nr-layout').getValue()
        };
        const res = await Server.call(WS_REPO, 'createRepository', data);
        if (res._Success) {
            Utils.popup_close();
            await loadMine();
        }
    });

    // ---- scan disk (admin only) ----
    $$('repo-scan').onclick(async () => {
        const res = await Server.call(WS_REPO, 'scanRepositories');
        if (res._Success) {
            Utils.showMessage('Scan complete', 'Added ' + res.added + ' repository(ies).');
            await loadMine();
        }
    });
    // Scanning the disk is an admin-only action; hide the button for everyone else.
    if (!isAdmin)
        $$('repo-scan').hide();

    // ---- access management ----
    const accCols = [
        {headerName: 'User', field: 'userName', flex: 2},
        {headerName: 'Read', field: 'canRead', width: 75},
        {headerName: 'Write', field: 'canWrite', width: 80},
        {headerName: 'Admin', field: 'canAdmin', width: 80},
        {headerName: 'SVN pw', field: 'hasSvnPassword', width: 90}
    ];
    const accGrid = new AGGrid('access-grid', accCols, 'userId');
    accGrid.show();

    accGrid.setOnSelectionChanged((rows) => {
        accSelected = accGrid.getSelectedRow();
        $$('acc-revoke').enable(rows);
        if (accSelected) {
            $$('acc-user').setValue(String(accSelected.userId));
            $$('acc-read').setValue(accSelected.canRead === 'Y');
            $$('acc-write').setValue(accSelected.canWrite === 'Y');
            $$('acc-admin').setValue(accSelected.canAdmin === 'Y');
        }
    });

    async function loadAccess() {
        accGrid.clear();
        $$('acc-revoke').disable();
        const res = await Server.call(WS_ACC, 'getAccess', {repoId: accessRepoId});
        if (res._Success) {
            accGrid.addRecords(res.rows);
            $$('acc-user').clear();
            $$('acc-user').add('', '(select user)');
            for (const u of res.availableUsers)
                $$('acc-user').add(String(u.userId), u.userName + (u.fullName ? ' (' + u.fullName + ')' : ''));
        }
    }

    $$('repo-access').onclick(() => {
        if (!currentRepo)
            return;
        accessRepoId = currentRepo.repoId;
        $$('acc-title').setValue('Access — ' + currentRepo.name);
        $$('acc-read').setValue(true);
        $$('acc-write').setValue(false);
        $$('acc-admin').setValue(false);
        loadAccess();
        Utils.popup_open('access-popup');
    });
    $$('acc-close').onclick(() => Utils.popup_close());

    $$('acc-grant').onclick(async () => {
        const uid = $$('acc-user').getValue();
        if (!uid) {
            Utils.showMessage('Select a user', 'Choose a user to grant access to.');
            return;
        }
        const res = await Server.call(WS_ACC, 'grant', {
            repoId: accessRepoId,
            userId: parseInt(uid, 10),
            canRead: $$('acc-read').getValue(),
            canWrite: $$('acc-write').getValue(),
            canAdmin: $$('acc-admin').getValue()
        });
        if (res._Success)
            await loadAccess();
    });

    $$('acc-revoke').onclick(() => {
        if (!accSelected)
            return;
        Utils.yesNo('Revoke', 'Remove ' + accSelected.userName + "'s access?", async () => {
            const res = await Server.call(WS_ACC, 'revoke', {repoId: accessRepoId, userId: accSelected.userId});
            if (res._Success)
                await loadAccess();
        });
    });

    await loadMine();

})();
