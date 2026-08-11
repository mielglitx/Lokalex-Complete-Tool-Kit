// src/ui/router.js
import { showToast } from './notifications.js';

let backPressCount = 0;
let backPressTimer = null;

export function switchView(targetViewId, isBackwards = false, replace = false) {
    if (replace) {
        history.replaceState({ view: targetViewId }, '', '#' + targetViewId);
    } else if (!isBackwards) {
        history.pushState({ view: targetViewId }, '', '#' + targetViewId);
    }
    renderViewUI(targetViewId);
}

export function renderViewUI(targetViewId) {
    document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
    const targetEl = document.getElementById(targetViewId);
    if (targetEl) targetEl.classList.remove('hidden');

    const appHeader = document.getElementById('app-header');
    const backBtn = document.getElementById('back-btn');
    const headerSpacer = document.getElementById('header-spacer');
    const headerTitle = document.getElementById('header-title');

    if (targetViewId === 'view-home' || targetViewId === 'view-login' || targetViewId === 'view-customer-home') {
        if (appHeader) appHeader.classList.remove('hidden');
        if (backBtn) backBtn.classList.add('hidden');
        if (headerSpacer) headerSpacer.classList.remove('hidden');

        if (targetViewId === 'view-home' && headerTitle) {
            headerTitle.innerHTML = `L<i class="fa-solid fa-location-dot text-red-500"></i>kalex Hub`;
        } else if (targetViewId === 'view-customer-home' && headerTitle) {
            headerTitle.innerHTML = `L<i class="fa-solid fa-location-dot text-red-500"></i>kalex Customer Portal`;
        }

        if (targetViewId === 'view-login' && appHeader) appHeader.classList.add('hidden');
    } else {
        if (appHeader) appHeader.classList.remove('hidden');
        if (backBtn) backBtn.classList.remove('hidden');
        if (headerSpacer) headerSpacer.classList.add('hidden');
    }

    window.dispatchEvent(new CustomEvent('viewChanged', { detail: targetViewId }));
}

export function goBack() {
    const currentView = document.querySelector('main > section:not(.hidden)')?.id;
    
    if (currentView === 'view-receipt-final') {
        switchView('view-wizard', true);
        return;
    }

    if (window.history.length > 1) {
        history.back();
    } else {
        const isCustomer = !!localStorage.getItem('lokalex_customer_fb_id');
        switchView(isCustomer ? 'view-customer-home' : 'view-home', true);
    }
}

window.addEventListener('popstate', function(event) {
    const currentView = document.querySelector('main > section:not(.hidden)')?.id;

    if (currentView === 'view-home' || currentView === 'view-login' || currentView === 'view-customer-home') {
        backPressCount++;
        if (backPressCount < 3) {
            history.pushState({ view: currentView }, '', '#' + currentView);
            showToast(`Press/Swipe Back ${3 - backPressCount} more time(s) to exit`);
            if (backPressTimer) clearTimeout(backPressTimer);
            backPressTimer = setTimeout(() => { backPressCount = 0; }, 3000);
        } else {
            backPressCount = 0;
        }
    } else {
        backPressCount = 0;
        if (event.state && event.state.view) {
            renderViewUI(event.state.view);
        } else {
            const isCustomer = !!localStorage.getItem('lokalex_customer_fb_id');
            renderViewUI(isCustomer ? 'view-customer-home' : 'view-home');
        }
    }
});

if (typeof window !== 'undefined') {
    window.switchView = switchView;
    window.renderViewUI = renderViewUI;
    window.goBack = goBack;
}