// src/features/storeHub/ui/menu/storeMenuCategories.js
import * as categoryCore from './categoryCore.js';
import * as categoryModal from './categoryModal.js';
import * as categoryReorder from './categoryReorder.js';
import * as categoryPreview from './categoryPreview.js';

export * from './categoryCore.js';
export * from './categoryModal.js';
export * from './categoryReorder.js';
export * from './categoryPreview.js';

if (typeof window !== 'undefined') {
    const modules = [categoryCore, categoryModal, categoryReorder, categoryPreview];
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