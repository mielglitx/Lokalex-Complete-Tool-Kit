// src/features/storeHub/ui/menu/categoryModal.js
import { appState } from '../../../../store/state.js';
import { showToast } from '../../../../ui/notifications.js';
import { openSlideDeleteModal } from '../../../../ui/modals.js';
import { 
    isAddonCategoryName, 
    saveStoreCategory, 
    deleteStoreCategory 
} from '../../storeMenu.js';
import { cleanFirebasePathKey } from '../storeHubState.js';
import { getSortedCategoriesList } from './categoryCore.js';

let categoryBeingEdited = null;

export function toggleCategoryAddonRulesVisibility() {
    const isAddonCheckbox = document.getElementById('cat-input-is-addon');
    const rulesContainer = document.getElementById('cat-addon-rules-container');
    if (!rulesContainer) return;

    if (isAddonCheckbox?.checked) {
        rulesContainer.classList.remove('hidden');
    } else {
        rulesContainer.classList.add('hidden');
        const reqInput = document.getElementById('cat-input-is-required');
        const singleInput = document.getElementById('cat-input-is-single');
        if (reqInput) reqInput.checked = false;
        if (singleInput) singleInput.checked = false;
    }
}

export function openAddCategoryModal(catId = null, catName = '') {
    const modal = document.getElementById('store-category-modal');
    const title = document.getElementById('cat-modal-title');
    const input = document.getElementById('cat-input-name');
    const editIdInput = document.getElementById('cat-edit-id');
    const isAddonCheckbox = document.getElementById('cat-input-is-addon');
    const reqCheckbox = document.getElementById('cat-input-is-required');
    const singleCheckbox = document.getElementById('cat-input-is-single');

    const cleanCatId = (catId && catId !== 'undefined' && catId !== 'null') ? catId : null;
    const categories = getSortedCategoriesList();
    const existingCat = cleanCatId ? categories.find(c => c.id === cleanCatId || c.name === catName) : null;
    const isAddon = existingCat ? (existingCat.isAddonCategory || isAddonCategoryName(existingCat.name)) : isAddonCategoryName(catName);

    categoryBeingEdited = cleanCatId ? { 
        id: cleanCatId, 
        name: catName, 
        isAddonCategory: isAddon,
        isRequired: !!existingCat?.isRequired,
        isSingleChoice: !!existingCat?.isSingleChoice
    } : null;

    if (title) title.innerText = cleanCatId ? "Edit Category Name" : "Add New Category";
    if (editIdInput) editIdInput.value = cleanCatId || '';
    if (input) input.value = catName || '';

    if (isAddonCheckbox) {
        isAddonCheckbox.checked = isAddon;
        isAddonCheckbox.onchange = toggleCategoryAddonRulesVisibility;
    }
    if (reqCheckbox) reqCheckbox.checked = !!existingCat?.isRequired;
    if (singleCheckbox) singleCheckbox.checked = !!existingCat?.isSingleChoice;

    toggleCategoryAddonRulesVisibility();

    if (modal) modal.classList.remove('hidden');
    if (input) setTimeout(() => input.focus(), 100);
}

export function closeAddCategoryModal() {
    const modal = document.getElementById('store-category-modal');
    categoryBeingEdited = null;
    if (modal) modal.classList.add('hidden');
}

export function editCategoryModal(catId, catName) {
    openAddCategoryModal(catId, catName);
}

export function promptAddNewCategory() {
    openAddCategoryModal();
}

export async function submitAddCategory() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const input = document.getElementById('cat-input-name');
    const editIdInput = document.getElementById('cat-edit-id');
    const isAddonCheckbox = document.getElementById('cat-input-is-addon');
    const reqCheckbox = document.getElementById('cat-input-is-required');
    const singleCheckbox = document.getElementById('cat-input-is-single');

    const catName = (input?.value || '').trim();
    let editId = (editIdInput?.value || '').trim();

    if (editId === 'undefined' || editId === 'null' || editId === 'CAT_RESERVED_ADDONS') {
        editId = '';
    }

    const isAddon = !!isAddonCheckbox?.checked || isAddonCategoryName(catName);
    const isRequired = isAddon && !!reqCheckbox?.checked;
    const isSingleChoice = isAddon && !!singleCheckbox?.checked;

    if (!catName) {
        return showToast("⚠️ I-enter ang pangalan ng Kategorya!");
    }

    if (!storeId) {
        return showToast("⚠️ Store session not found. Please log in again.");
    }

    const saveBtn = document.getElementById('cat-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        const oldName = categoryBeingEdited ? categoryBeingEdited.name : null;
        await saveStoreCategory(storeId, catName, editId || null, oldName, isAddon, isRequired, isSingleChoice);
        closeAddCategoryModal();
    } catch (err) {
        console.error("Save category error:", err);
        showToast("❌ Failed to save category.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-plus-circle"></i> SAVE CATEGORY`;
        }
    }
}

export function promptDeleteCategory(catId, catName) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    openSlideDeleteModal(
        `Delete Category?`,
        `Sigurado ka bang nais burahin ang kategoryang [${catName}]? Ang mga paninda rito ay ililipat sa 'General'.`,
        async () => {
            await deleteStoreCategory(storeId, catId, catName);
        }
    );
}