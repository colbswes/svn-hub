
/* global $$, Server, Utils, Router, SvnHubWhyModal */

'use strict';

(function () {

    //  Reaching the login screen ends any existing session so a fresh login is required
    //  (e.g. when the user backs into it from inside the app).
    Server.clearSession();

    const RESET_SERVICE = 'services/PasswordResetService';
    const SLIDE_FOCUS_DELAY = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
    const SLIDE_EXIT_DELAY = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;

    const formWrap = document.getElementById('auth-form-wrap');
    const cardStage = document.querySelector('.auth-card-stage');
    const panels = Array.from(document.querySelectorAll('[data-auth-panel]'));
    let exitTimer = null;

    function setPanelControls(panel, disabled) {
        panel.querySelectorAll('input, button, select, textarea').forEach(function (control) {
            control.disabled = disabled;
        });
        panel.querySelectorAll('a').forEach(function (link) {
            if (disabled) {
                if (link.dataset.authTabIndex === undefined)
                    link.dataset.authTabIndex = link.getAttribute('tabindex') || '';
                link.setAttribute('tabindex', '-1');
            } else if (link.dataset.authTabIndex !== undefined) {
                if (link.dataset.authTabIndex)
                    link.setAttribute('tabindex', link.dataset.authTabIndex);
                else
                    link.removeAttribute('tabindex');
                delete link.dataset.authTabIndex;
            }
        });
    }

    function setPanelState(mode) {
        if (exitTimer) {
            window.clearTimeout(exitTimer);
            exitTimer = null;
        }
        formWrap.dataset.authMode = mode;
        panels.forEach(function (panel) {
            const active = panel.dataset.authPanel === mode;
            const slidePanel = panel.classList.contains('auth-slide-panel');
            panel.classList.toggle('is-active', active);
            panel.classList.remove('is-exiting');
            setPanelControls(panel, !active);
            if (active) {
                panel.removeAttribute('aria-hidden');
                panel.removeAttribute('inert');
                panel.inert = false;
            } else {
                panel.setAttribute('aria-hidden', 'true');
                if (slidePanel) {
                    panel.setAttribute('inert', '');
                    panel.inert = true;
                } else {
                    panel.removeAttribute('inert');
                    panel.inert = false;
                }
            }
        });
    }

    function finishSlideExit(panel) {
        panel.classList.remove('is-active', 'is-exiting');
        panel.setAttribute('aria-hidden', 'true');
        panel.setAttribute('inert', '');
        panel.inert = true;
    }

    function showSignInUnderlay() {
        const signInPanel = document.getElementById('signin-panel');
        signInPanel.classList.add('is-active');
        signInPanel.removeAttribute('aria-hidden');
        signInPanel.removeAttribute('inert');
        signInPanel.inert = false;
        setPanelControls(signInPanel, false);
    }

    function copyEmailTo(targetId) {
        const email = $$('username').getValue().trim().toLowerCase();
        if (email && !$$(targetId).getValue())
            $$(targetId).setValue(email);
    }

    function focusAfterSlide(controlId) {
        window.setTimeout(function () {
            const control = $$(controlId);
            if (cardStage)
                cardStage.scrollLeft = 0;
            if (control && control.element && control.element.focus)
                control.element.focus({preventScroll: true});
            else if (control)
                control.focus();
            if (cardStage)
                cardStage.scrollLeft = 0;
        }, SLIDE_FOCUS_DELAY);
    }

    function showSignIn() {
        const activeSlide = document.querySelector('.auth-slide-panel.is-active');
        if (!activeSlide) {
            setPanelState('signin');
            $$('username').focus();
            return;
        }

        if (exitTimer)
            window.clearTimeout(exitTimer);
        showSignInUnderlay();
        activeSlide.classList.add('is-exiting');
        exitTimer = window.setTimeout(function () {
            finishSlideExit(activeSlide);
            exitTimer = null;
            setPanelState('signin');
            $$('username').focus();
        }, SLIDE_EXIT_DELAY);
    }

    function showRegister() {
        copyEmailTo('reg-email');
        setPanelState('register');
        focusAfterSlide('reg-email');
    }

    function showForgot() {
        copyEmailTo('reset-email');
        $$('sent-msg').setValue('');
        $$('send-code').enable();
        setPanelState('forgot');
        focusAfterSlide('reset-email');
    }

    function consumeInitialAuthMode() {
        try {
            const mode = sessionStorage.getItem('svnhub.authMode');
            sessionStorage.removeItem('svnhub.authMode');
            return mode;
        } catch (err) {
            return '';
        }
    }

    function saveLoginState(res) {
        Server.setUUID(res.uuid);
        Server.setBootId(res._BootId);   //  record the server instance this session belongs to
        Utils.saveData('isAdmin', res.isAdmin === true);
        Utils.saveData('handle', res.handle);
        Utils.saveData('email', res.email);
        Utils.saveData('emailVerified', res.emailVerified === true);
    }

    function routeAfterLogin(res, resetCredential) {
        saveLoginState(res);
        if (res.usedResetCode === true) {
            // Signed in with an emailed reset code; carry it into the password-change page.
            Utils.saveData('resetCredential', resetCredential);
            Router.go('/setpw');
        } else if (res.emailVerified === true) {
            //  Go where the user was originally headed (deep link), else the home shell.
            Router.go(Router.returnTarget());
        } else {
            Router.go('/verify');
        }
    }

    async function login() {
        if ($$('username').isError('Email'))
            return;
        if ($$('password').isError('Password'))
            return;

        const data = {
            username: $$('username').getValue().toLowerCase(),
            password: $$('password').getValue()
        };
        const res = await Server.call('', 'Login', data);
        if (res._Success) {
            routeAfterLogin(res, data.password);
        } else {
            $$('password').clear().focus();
        }
    }

    async function doRegister() {
        if ($$('reg-email').isError('Email'))
            return;
        if ($$('reg-handle').isError('Username'))
            return;
        if ($$('reg-password').isError('Password'))
            return;
        if ($$('reg-password2').isError('Confirm'))
            return;

        const email = $$('reg-email').getValue().trim().toLowerCase();
        const handle = $$('reg-handle').getValue().trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(handle)) {
            await Utils.showMessage('Invalid username',
                'Your username may contain only letters, digits, dash and underscore (no spaces), ' +
                'must start with a letter or digit, and be at most 64 characters.');
            $$('reg-handle').focus();
            return;
        }

        const password = $$('reg-password').getValue();
        if (password !== $$('reg-password2').getValue()) {
            Utils.showMessage('Error', 'The passwords do not match.');
            $$('reg-password2').focus();
            return;
        }

        const res = await Server.call('services/Register', 'register', {
            email: email,
            handle: handle,
            password: password,
            fullName: $$('reg-full-name').getValue()
        });
        if (!res._Success)
            return;

        const loginRes = await Server.call('', 'Login', {username: email, password: password});
        if (loginRes._Success)
            routeAfterLogin(loginRes, password);
        else
            showSignIn();
    }

    async function sendCode() {
        if ($$('reset-email').isError('Email'))
            return;
        const email = $$('reset-email').getValue().trim().toLowerCase();
        const res = await Server.call(RESET_SERVICE, 'requestReset', {email: email});
        if (res._Success) {
            $$('sent-msg').setValue('If an account exists for that email, a code has been sent. ' +
                'Return to sign-in and enter that code in place of your password.');
            $$('send-code').disable();
        }
    }

    if (consumeInitialAuthMode() === 'register')
        showRegister();
    else
        setPanelState('signin');

    $$('login').onclick(login);

    $$('why-button').onclick(function () {
        SvnHubWhyModal.open();
    });

    $$('to-register').onclick(showRegister);

    $$('to-forgot').onclick(showForgot);

    $$('back-from-register').onclick(showSignIn);
    $$('back-from-forgot').onclick(showSignIn);
    $$('register').onclick(doRegister);
    $$('send-code').onclick(sendCode);

    $$('username').onEnter(function () {
        $$('password').focus();
    });

    $$('password').onEnter(function () {
        login();
    });

    $$('reg-email').onEnter(function () {
        $$('reg-handle').focus();
    });

    $$('reg-handle').onEnter(function () {
        $$('reg-full-name').focus();
    });

    $$('reg-full-name').onEnter(function () {
        $$('reg-password').focus();
    });

    $$('reg-password').onEnter(function () {
        $$('reg-password2').focus();
    });

    $$('reg-password2').onEnter(doRegister);
    $$('reset-email').onEnter(sendCode);

    $$('username').focus();

})();
