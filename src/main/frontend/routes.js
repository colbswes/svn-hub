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

    //  Public (pre-authentication) pages — full-body.  ("Why Subversion?" is an
    //  in-page modal (why-modal.js) opened from the login card, not a route.)
    Router.add('/login',    { page: loginPage,  auth: false });
    Router.add('/register', { page: 'register', auth: false });
    Router.add('/forgot',   { page: 'forgot',   auth: false });

    //  Post-login gate pages (authenticated, full-body)
    Router.add('/verify',   { page: 'verify' });   // email-verification gate
    Router.add('/setpw',    { page: 'setpw' });    // forced password change after a reset-code login

    //  Main shell (nav + app-screen-area).  Public (auth:false) so anonymous visitors
    //  can browse: Framework.js lands guests on Discover and signed-in users on Dashboard.
    Router.add('/', { page: homePage, auth: false });

    //  Public sub-screens — anonymous/guest browsing of public repositories and people.
    //  A "guest" is any visitor without a session (see Framework.js); the back end still
    //  scopes what a guest may see, and private data requires signing in.
    Router.add('/discover',         { page: 'screens/Discover/Discover',               tag: 'app-screen-area', auth: false });
    Router.add('/repository',       { page: 'screens/Repository/Repository',           tag: 'app-screen-area', auth: false });
    Router.add('/issues',           { page: 'screens/Issues/Issues',                   tag: 'app-screen-area', auth: false });
    Router.add('/merge-requests',   { page: 'screens/MergeRequests/MergeRequests',     tag: 'app-screen-area', auth: false });
    Router.add('/person',           { page: 'screens/Person/Person',                   tag: 'app-screen-area', auth: false });
    Router.add('/landing',          { page: 'screens/Landing/Landing',                 tag: 'app-screen-area', auth: false });
    Router.add('/help',             { page: 'screens/Help/Help',                       tag: 'app-screen-area', auth: false });
    Router.add('/about-subversion', { page: 'screens/AboutSubversion/AboutSubversion', tag: 'app-screen-area', auth: false });

    //  Authenticated sub-screens (require a session)
    Router.add('/dashboard',        { page: 'screens/Dashboard/Dashboard',             tag: 'app-screen-area' });
    Router.add('/insights',         { page: 'screens/Insights/Insights',               tag: 'app-screen-area' });
    Router.add('/users',            { page: 'screens/Users/Users',                     tag: 'app-screen-area' });

    //  File-based fallback: any URL that matches none of the routes above is loaded as a
    //  screen under 'screens', into the shell's content region — so #/Export/Export loads
    //  screens/Export/Export without needing its own Router.add().  A ?tag= on the URL
    //  (or Router.go(path, tag)) overrides the region.
    Router.setScreenRoot('screens', { shell: '/', tag: 'app-screen-area' });

})();
