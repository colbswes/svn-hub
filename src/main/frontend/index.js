
/* global Utils, Server, SystemInfo */

'use strict';

function setBackendURL() {
    if (SystemInfo.backendUrl) {
        // explicit backend URL
        Server.setURL(SystemInfo.backendUrl);
    } else if (window.location.protocol === "file:") {
        //  electron desktop frontend
        Server.setURL('http://localhost:8080');
    } else if (window.location.protocol === "http:" && window.location.port >= 8000) {
        //  Development environment
        Server.setURL('http://' + window.location.hostname + ':8080');
    } else {
        //  Production environment with front-end & back-end as one unit
        let url = Utils.getAppUrl();
        Server.setURL(url);
    }
}

function saveAccountStatus(res) {
    Utils.saveData('guest', false);
    Utils.saveData('isAdmin', res.isAdmin === true);
    Utils.saveData('handle', res.handle);
    Utils.saveData('email', res.email);
    Utils.saveData('emailVerified', res.emailVerified === true);
}

function saveGuestStatus() {
    Server.clearUUID();
    Utils.saveData('guest', true);
    Utils.saveData('isAdmin', false);
    Utils.saveData('handle', 'public');
    Utils.saveData('email', '');
    Utils.saveData('emailVerified', false);
}

function pageFromHash() {
    if (!window.location.hash || window.location.hash.length < 2)
        return '';
    try {
        return decodeURIComponent(window.location.hash.substring(1));
    } catch (err) {
        return '';
    }
}

function isRepoScopedPage(page) {
    return page === 'screens/Repository/Repository' ||
        page === 'screens/Issues/Issues' ||
        page === 'screens/MergeRequests/MergeRequests';
}

function isPersonScopedPage(page) {
    return page === 'screens/Person/Person';
}

function isPublicPage(page) {
    return page === 'screens/Landing/Landing' ||
        page === 'screens/Discover/Discover' ||
        page === 'screens/Help/Help' ||
        page === 'screens/AboutSubversion/AboutSubversion' ||
        isPersonScopedPage(page) ||
        isRepoScopedPage(page);
}

function isRestorableAppRoute(route) {
    if (!route || !route.page || !route.page.startsWith('screens/'))
        return false;
    if (route.page === 'screens/Framework/Framework')
        return false;
    if (isRepoScopedPage(route.page))
        return !!(route.data && route.data.repoId);
    if (isPersonScopedPage(route.page))
        return !!(route.data && route.data.personHandle);
    return true;
}

function routeDataFromUrl() {
    const data = {};
    const params = new URLSearchParams(window.location.search || '');
    const repoSection = params.get('section') || '';
    const repoId = Number(params.get('repoId'));
    if (Number.isFinite(repoId) && repoId > 0)
        data.repoId = repoId;
    const repoKey = params.get('repoKey');
    if (repoKey)
        data.repoKey = repoKey;
    const repoName = params.get('repoName');
    if (repoName)
        data.repoName = repoName;
    const personHandle = params.get('personHandle');
    if (personHandle)
        data.personHandle = personHandle;
    const discoverQuery = params.get('q');
    if (discoverQuery)
        data.discoverQuery = discoverQuery;
    const repoPath = params.get('path') || '';
    if (repoSection === 'files' || (!repoSection && repoPath)) {
        if (repoPath) {
            data.repoSection = 'files';
            data.repoPath = repoPath;
            if (params.get('file') === '1' || params.get('view') === 'file')
                data.repoFile = true;
        }
    } else if (['history', 'issues', 'mrs', 'insights', 'readme'].includes(repoSection)) {
        data.repoSection = repoSection;
        const revision = Number(params.get('rev'));
        if (repoSection === 'history' && Number.isFinite(revision) && revision > 0)
            data.repoRevision = revision;
        const issue = params.get('issue') || '';
        if (repoSection === 'issues' && (issue === 'new' || /^\d+$/.test(issue)))
            data.repoIssue = issue;
        const mr = params.get('mr') || '';
        if (repoSection === 'mrs' && (mr === 'new' || /^\d+$/.test(mr)))
            data.repoMergeRequest = mr;
    }
    return data;
}

function isDiscoverScopedPage(page) {
    return page === 'screens/Discover/Discover';
}

function hydrateRouteData(route) {
    if (!route)
        return route;
    route.data = Object.assign({}, route.data || {});
    if (isRepoScopedPage(route.page) && !route.data.repoId)
        route.data = Object.assign(route.data, routeDataFromUrl());
    if (isPersonScopedPage(route.page) && !route.data.personHandle)
        route.data = Object.assign(route.data, routeDataFromUrl());
    if (isDiscoverScopedPage(route.page) && !route.data.discoverQuery)
        route.data = Object.assign(route.data, routeDataFromUrl());
    return route;
}

function currentAppRoute() {
    if (history.state && history.state.__kissRoute === true) {
        const route = hydrateRouteData(Object.assign({}, history.state));
        if (isRestorableAppRoute(route))
            return route;
    }
    const page = pageFromHash();
    const route = {
        __kissRoute: true,
        page: page,
        tag: 'app-screen-area',
        initialFocus: null,
        argv: null,
        data: routeDataFromUrl()
    };
    return isRestorableAppRoute(route) ? route : null;
}

function isPublicAppRoute(route) {
    return isRestorableAppRoute(route) && isPublicPage(route.page);
}

async function restoreSession() {
    const uuid = Server.restoreUUID();
    if (!uuid)
        return false;
    const appRoute = currentAppRoute();
    try {
        const response = await fetch(Server.url + '/rest', {
            method: 'POST',
            cache: 'no-store',
            body: JSON.stringify({
                _uuid: uuid,
                _method: 'status',
                _class: 'services/AccountService'
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const res = await response.json();
        if (!res._Success) {
            if (res._ErrorCode === 2)
                Server.clearUUID();
            return false;
        }
        Server.setUUID(uuid);
        saveAccountStatus(res);
        if (res.usedResetCode === true)
            Utils.replacePage('setpw');
        else if (res.emailVerified === true) {
            if (appRoute)
                Utils.saveData('restoreAppRoute', appRoute);
            Utils.replacePage('screens/Framework/Framework');
        } else {
            Utils.replacePage('verify');
        }
        return true;
    } catch (err) {
        return false;
    }
}

async function restorePublicRoute() {
    const appRoute = currentAppRoute();
    if (!isPublicAppRoute(appRoute))
        return false;
    saveGuestStatus();
    Utils.saveData('restoreAppRoute', appRoute);
    Utils.replacePage('screens/Framework/Framework');
    return true;
}

Utils.afterComponentsLoaded(async function () {
    setBackendURL();

    // Modals/popups should not be draggable. makeDraggable is only ever called
    // by the framework's modal code (popup_open / yesNo / showMessage / waitMessage),
    // so neutralizing it here disables dragging app-wide without touching kiss/.
    Utils.makeDraggable = function () {};

    Utils.forceASCII = false;  // Force all text entry to ASCII (see Utils.forceASCII)

    if (await restoreSession())
        return;

    if (await restorePublicRoute())
        return;

    const screenPixels = screen.height * screen.width;
    if (screenPixels < 600000)
        Utils.replacePage("mobile/login");
    /*
    else if (screenPixels < 1000000)
        Utils.replacePage("tablet/login");
    */
    else
        Utils.replacePage('login');
});


(function () {
    Utils.useComponent('Popup');
    Utils.useComponent('Accordion');
    Utils.useComponent('Avatar');
    Utils.useComponent('Badge');
    Utils.useComponent('CheckBox');
    Utils.useComponent('DateInput');
    Utils.useComponent('DropDown');
    Utils.useComponent('DurationInput');
    Utils.useComponent('ListBox');
    Utils.useComponent('MenuButton');
    Utils.useComponent('NumericInput');
    Utils.useComponent('PanelCard');
    Utils.useComponent('PushButton');
    Utils.useComponent('RadioButton');
    Utils.useComponent('SearchInput');
    Utils.useComponent('SectionTitle');
    Utils.useComponent('SegmentedControl');
    Utils.useComponent('TextboxInput');
    Utils.useComponent('TextInput');
    Utils.useComponent('TextLabel');
    Utils.useComponent('TimeInput');
    Utils.useComponent('Toast');
    Utils.useComponent('FileUpload');
    Utils.useComponent('NativeDateInput');
    Utils.useComponent('Picture');
})();
