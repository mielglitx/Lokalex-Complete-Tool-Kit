// src/features/cart.js
import * as cartStateMod from './cart/cartState.js';
import * as cartGesturesMod from './cart/cartGestures.js';
import * as cartSukliMod from './cart/cartSukli.js';
import * as cartUIMod from './cart/cartUI.js';
import * as cartOperationsMod from './cart/cartOperations.js';

export * from './cart/cartState.js';
export * from './cart/cartGestures.js';
export * from './cart/cartSukli.js';
export * from './cart/cartUI.js';
export * from './cart/cartOperations.js';

cartStateMod.loadCartState();

setTimeout(() => {
    cartUIMod.renderCartTabs();
    cartUIMod.renderCartItems();
}, 50);

if (typeof window !== 'undefined') {
    const modules = [
        cartStateMod,
        cartGesturesMod,
        cartSukliMod,
        cartUIMod,
        cartOperationsMod
    ];

    modules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(fn => {
                if (typeof mod[fn] === 'function') {
                    window[fn] = mod[fn];
                }
            });
        }
    });
}

window.addEventListener('rosterUpdated', cartUIMod.renderCartCustomerSelector);
window.addEventListener('cateredUpdated', cartUIMod.renderCartCustomerSelector);