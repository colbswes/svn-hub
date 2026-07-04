/* global Router */

'use strict';

/**
 * SvnHub route table.
 *
 * This file is owned by the application — add a route here for each addressable
 * screen.  See kiss/Router.js for the route-definition format.  Routes are
 * registered at load; index.js calls Router.start() once components are ready.
 */

(function () {

    //  Device-aware page selection (mirrors the old screen-size logic in index.js).
    function loginPage() {
        return (screen.height * screen.width < 600000) ? 'mobile/login' : 'login';
    }
    function homePage() {
        return (screen.height * screen.width < 600000) ? 'mobile/page1' : 'screens/Framework/Framework';
    }

    //  Public (pre-authentication) pages — full-body
    Router.add('/login',    { page: loginPage,  auth: false });
    Router.add('/why',      { page: 'why',      auth: false });
    Router.add('/register', { page: 'register', auth: false });
    Router.add('/forgot',   { page: 'forgot',   auth: false });

    //  Post-login gate pages (authenticated, full-body)
    Router.add('/verify',   { page: 'verify' });   // email-verification gate
    Router.add('/setpw',    { page: 'setpw' });    // forced password change after a reset-code login

    //  Main shell (nav + app-screen-area).  Framework.js lands on the repository
    //  list by default when the shell route itself is the destination.
    Router.add('/', { page: homePage });

    //  Sub-screens loaded into the shell's content region
    Router.add('/repositories',     { page: 'screens/Repositories/Repositories',       tag: 'app-screen-area' });
    Router.add('/repository',       { page: 'screens/Repository/Repository',           tag: 'app-screen-area' });
    Router.add('/issues',           { page: 'screens/Issues/Issues',                   tag: 'app-screen-area' });
    Router.add('/merge-requests',   { page: 'screens/MergeRequests/MergeRequests',     tag: 'app-screen-area' });
    Router.add('/discover',         { page: 'screens/Discover/Discover',               tag: 'app-screen-area' });
    Router.add('/insights',         { page: 'screens/Insights/Insights',               tag: 'app-screen-area' });
    Router.add('/users',            { page: 'screens/Users/Users',                     tag: 'app-screen-area' });
    Router.add('/help',             { page: 'screens/Help/Help',                       tag: 'app-screen-area' });
    Router.add('/about-subversion', { page: 'screens/AboutSubversion/AboutSubversion', tag: 'app-screen-area' });

    //  File-based fallback: any URL that matches none of the routes above is loaded as a
    //  screen under 'screens', into the shell's content region — so #/Export/Export loads
    //  screens/Export/Export without needing its own Router.add().  A ?tag= on the URL
    //  (or Router.go(path, tag)) overrides the region.
    Router.setScreenRoot('screens', { shell: '/', tag: 'app-screen-area' });

})();
