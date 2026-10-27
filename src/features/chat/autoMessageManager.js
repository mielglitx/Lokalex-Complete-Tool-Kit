// src/features/chat/autoMessageManager.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { isAdmin, canManageRoster, isCustomerMatch } from '../roster/rosterUtils.js';
import { sendRiderToCustomerChat } from './chatEngine/chatSending.js';

/**
 * ============================================================================
 * LOKALEX CUSTOMIZABLE AUTOMATED MESSAGES SYSTEM (ADMIN-MANAGED)
 * ============================================================================
 * 
 * Centralized automated message configuration managed STRICTLY by Admin:
 * - Only Admin can turn on/off and customize the message templates.
 * - Synced in real-time across all riders via Firebase RTDB (`settings/autoMessage`).
 * 
 * Scenarios:
 * 1. SCENARIO 1 (Marked "Being Catered"):
 *    - Dispatches introductory greeting when catering starts.
 *    - Controlled by Admin (`caterEnabled`, `caterTemplate`).
 * 
 * 2. SCENARIO 2 (Marked "Done" - STRICTLY WITH CREATED RECEIPT):
 *    - Dispatches delivery completion & receipt total breakdown.
 *    - MUST ONLY trigger upon completing an active catering order with a verified receipt.
 *    - Single-use receipt consumption prevents re-sending if a customer messages again
 *      or is marked done without being actively catered.
 *    - Controlled by Admin (`doneEnabled`, `doneTemplate`).
 * 
 * Name Display Formats:
 * - Customer Name: First Name Only | Last Name Only | Full Name
 * - Rider Name: First Name Only | Last Name Only | Full Name
 * - Supports direct smart tags: {customerFirstName}, {customerLastName}, {customerFullName},
 *   {riderFirstName}, {riderLastName}, {riderFullName}, and format-respecting {customerName}, {riderName}.
 * ============================================================================
 */

export const DEFAULT_AUTO_MSG_CATER = "Hello {customerName}! I am {riderName}, your Lokalex delivery rider. I am now catering your order and will assist you with your request. Thank you! 🛵💨";
export const DEFAULT_AUTO_MSG_DONE = "Hi {customerName}! Your order has been completed and marked as Done. Thank you for choosing Lokalex! Total: {receiptTotal}. Have a great day! 🙏✨";

export const autoMessageState = {
    caterEnabled: true,
    caterTemplate: DEFAULT_AUTO_MSG_CATER,
    doneEnabled: true,
    doneTemplate: DEFAULT_AUTO_MSG_DONE,
    customerNameFormat: "firstName", // "firstName" | "lastName" | "fullName"
    riderNameFormat: "firstName",    // "firstName" | "lastName" | "fullName"
    updatedBy: "Admin",
    updatedAt: 0
};

// Initialize cached state from localStorage on startup
try {
    const cached = localStorage.getItem('lokalex_automsg_settings');
    if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
            if (typeof parsed.caterEnabled === 'boolean') autoMessageState.caterEnabled = parsed.caterEnabled;
            if (parsed.caterTemplate && typeof parsed.caterTemplate === 'string') autoMessageState.caterTemplate = parsed.caterTemplate;
            if (typeof parsed.doneEnabled === 'boolean') autoMessageState.doneEnabled = parsed.doneEnabled;
            if (parsed.doneTemplate && typeof parsed.doneTemplate === 'string') autoMessageState.doneTemplate = parsed.doneTemplate;
            if (parsed.customerNameFormat) autoMessageState.customerNameFormat = parsed.customerNameFormat;
            if (parsed.riderNameFormat) autoMessageState.riderNameFormat = parsed.riderNameFormat;
            if (parsed.updatedBy) autoMessageState.updatedBy = parsed.updatedBy;
            if (parsed.updatedAt) autoMessageState.updatedAt = parsed.updatedAt;
        }
    }
} catch (_) {}

let isAutoMessageListening = false;
const recentAutoCaterDispatches = new Map();
const recentAutoDoneDispatches = new Map();

/**
 * Extracts first name, last name, and full name from a raw name string.
 */
export function extractNameParts(rawName) {
    if (!rawName) return { firstName: "", lastName: "", fullName: "" };
    let clean = String(rawName).trim().replace(/\s+/g, ' ');
    if (!clean) return { firstName: "", lastName: "", fullName: "" };

    const parts = clean.split(' ');
    if (parts.length === 1) {
        return {
            firstName: parts[0],
            lastName: parts[0],
            fullName: parts[0]
        };
    }

    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');

    return {
        firstName,
        lastName,
        fullName: clean
    };
}

/**
 * Checks whether the current user possesses administrative authority to manage auto-messages.
 */
export function canManageAutoMessage() {
    if (typeof isAdmin === 'function' && isAdmin()) return true;
    if (typeof canManageRoster === 'function' && canManageRoster()) return true;
    if (typeof window !== 'undefined' && window.isAdmin && window.isAdmin()) return true;
    const myType = (appState.userType || localStorage.getItem('userType') || '').toLowerCase().trim();
    if (['admin', 'owner', 'manager', 'administrator'].includes(myType)) return true;
    if (globalState.adminControlsEnabled || (typeof localStorage !== 'undefined' && localStorage.getItem('adminControlsEnabled') === 'true')) return true;
    return false;
}

/**
 * Subscribes to real-time changes of `settings/autoMessage` in Firebase RTDB.
 */
export function initAutoMessageListener() {
    if (isAutoMessageListening || !db) return;
    isAutoMessageListening = true;

    db.ref('settings/autoMessage').on('value', (snap) => {
        const val = snap.val();
        if (val && typeof val === 'object') {
            autoMessageState.caterEnabled = val.caterEnabled !== false;
            if (val.caterTemplate && typeof val.caterTemplate === 'string') {
                autoMessageState.caterTemplate = val.caterTemplate;
            }
            autoMessageState.doneEnabled = val.doneEnabled !== false;
            if (val.doneTemplate && typeof val.doneTemplate === 'string') {
                autoMessageState.doneTemplate = val.doneTemplate;
            }
            if (val.customerNameFormat) autoMessageState.customerNameFormat = val.customerNameFormat;
            if (val.riderNameFormat) autoMessageState.riderNameFormat = val.riderNameFormat;
            autoMessageState.updatedBy = val.updatedBy || 'Admin';
            autoMessageState.updatedAt = val.updatedAt || 0;
        }

        try {
            localStorage.setItem('lokalex_automsg_settings', JSON.stringify(autoMessageState));
        } catch (_) {}

        updateAutoMessageUI();
    }, (err) => {
        console.warn('[AutoMessage] Realtime listener error:', err);
    });
}

/**
 * Retrieves the current auto-message settings.
 */
export function getAutoMessageConfig() {
    return {
        caterEnabled: autoMessageState.caterEnabled,
        caterTemplate: autoMessageState.caterTemplate || DEFAULT_AUTO_MSG_CATER,
        doneEnabled: autoMessageState.doneEnabled,
        doneTemplate: autoMessageState.doneTemplate || DEFAULT_AUTO_MSG_DONE,
        customerNameFormat: autoMessageState.customerNameFormat || "firstName",
        riderNameFormat: autoMessageState.riderNameFormat || "firstName",
        updatedBy: autoMessageState.updatedBy || 'Admin',
        updatedAt: autoMessageState.updatedAt || 0
    };
}

/**
 * Saves updated auto-message settings to Firebase RTDB (Admin only).
 */
export async function saveAutoMessageConfig(config) {
    if (!canManageAutoMessage()) {
        showToast("⚠️ Unauthorized: Only Admin can configure Auto-Messages.");
        return false;
    }
    if (!config) return false;

    const adminName = (appState.riderName || localStorage.getItem('riderName') || 'Admin').trim();
    const payload = {
        caterEnabled: Boolean(config.caterEnabled),
        caterTemplate: (config.caterTemplate || '').trim() || DEFAULT_AUTO_MSG_CATER,
        doneEnabled: Boolean(config.doneEnabled),
        doneTemplate: (config.doneTemplate || '').trim() || DEFAULT_AUTO_MSG_DONE,
        customerNameFormat: config.customerNameFormat || "firstName",
        riderNameFormat: config.riderNameFormat || "firstName",
        updatedBy: adminName,
        updatedAt: Date.now()
    };

    Object.assign(autoMessageState, payload);
    try {
        localStorage.setItem('lokalex_automsg_settings', JSON.stringify(payload));
    } catch (_) {}

    if (db) {
        try {
            await db.ref('settings/autoMessage').set(payload);
        } catch (err) {
            console.warn('[AutoMessage] Failed to sync settings to Firebase:', err);
            showToast("⚠️ Settings saved locally, but failed to sync to cloud.");
            return true;
        }
    }

    return true;
}

/**
 * Manages persistent set of receipt keys that already triggered Done auto-messages.
 * This guarantees a receipt will NEVER trigger a Done auto-message more than once.
 */
function getConsumedReceiptKeys() {
    try {
        const stored = localStorage.getItem('lokalex_automsg_consumed_receipts');
        if (stored) {
            const arr = JSON.parse(stored);
            if (Array.isArray(arr)) return new Set(arr);
        }
    } catch (_) {}
    return new Set();
}

function markReceiptConsumed(receiptKey) {
    if (!receiptKey) return;
    try {
        const set = getConsumedReceiptKeys();
        set.add(String(receiptKey).trim());
        const arr = Array.from(set).slice(-300);
        localStorage.setItem('lokalex_automsg_consumed_receipts', JSON.stringify(arr));
    } catch (_) {}
}

/**
 * Replaces dynamic variables in the message template.
 */
export function formatAutoMessage(template, params = {}) {
    if (!template) return "";

    const rawCustName = (params.customerName || "Customer").trim();
    const rawRiderName = (params.riderName || appState.riderName || localStorage.getItem('riderName') || "Lokalex Rider").trim();

    const custParts = extractNameParts(rawCustName);
    const riderParts = extractNameParts(rawRiderName);

    const config = getAutoMessageConfig();
    const custFormat = config.customerNameFormat || 'firstName';
    const riderFormat = config.riderNameFormat || 'firstName';

    let resolvedCustName = custParts.fullName;
    if (custFormat === 'firstName' && custParts.firstName) resolvedCustName = custParts.firstName;
    else if (custFormat === 'lastName' && custParts.lastName) resolvedCustName = custParts.lastName;

    let resolvedRiderName = riderParts.fullName;
    if (riderFormat === 'firstName' && riderParts.firstName) resolvedRiderName = riderParts.firstName;
    else if (riderFormat === 'lastName' && riderParts.lastName) resolvedRiderName = riderParts.lastName;

    const receiptTotal = params.receiptTotal || (params.receipt ? formatReceiptTotal(params.receipt) : "₱0.00");
    const receiptNumber = params.receiptNumber || params.receipt?.transactionId || params.receipt?.id || "N/A";
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

    let msg = template
        // Specific name tags
        .replace(/\{customerFirstName\}/gi, custParts.firstName || custParts.fullName)
        .replace(/\{customerLastName\}/gi, custParts.lastName || custParts.fullName)
        .replace(/\{customerFullName\}/gi, custParts.fullName)
        .replace(/\{riderFirstName\}/gi, riderParts.firstName || riderParts.fullName)
        .replace(/\{riderLastName\}/gi, riderParts.lastName || riderParts.fullName)
        .replace(/\{riderFullName\}/gi, riderParts.fullName)
        // General tags (respect name format setting)
        .replace(/\{customerName\}/gi, resolvedCustName)
        .replace(/\{riderName\}/gi, resolvedRiderName)
        .replace(/\{receiptTotal\}/gi, receiptTotal)
        .replace(/\{receiptNumber\}/gi, receiptNumber)
        .replace(/\{time\}/gi, time);

    return msg.trim();
}

/**
 * Formats receipt total amount cleanly.
 */
function formatReceiptTotal(receipt) {
    if (!receipt) return "₱0.00";
    const val = receipt.grandTotal || receipt.total || receipt.totalAmount || receipt.finalTotal || "";
    if (val) {
        const num = parseFloat(String(val).replace(/[^0-9.]/g, ''));
        return !isNaN(num) ? `₱${num.toFixed(2)}` : String(val);
    }
    return "₱0.00";
}

/**
 * Finds matching daily receipt for a customer, strictly excluding already consumed receipts.
 */
export function findCustomerReceiptForAutoMsg(custName, riderName = "", riderId = "") {
    if (!custName) return null;
    const cleanCust = custName.trim().toLowerCase();
    const consumed = getConsumedReceiptKeys();
    const receipts = globalState.globalDailyReceipts || [];

    // Search backwards (most recent receipt first)
    for (let i = receipts.length - 1; i >= 0; i--) {
        const rc = receipts[i];
        if (!rc || rc.status === 'voided' || rc.voided || rc.isVoided) continue;
        const rcKey = String(rc.transactionId || rc.id || rc.receiptNumber || "").trim();
        if (rcKey && consumed.has(rcKey)) {
            // Already sent an auto-message for this receipt; skip
            continue;
        }

        const rcName = (rc.customerName || "").trim().toLowerCase();
        if (rcName && (rcName === cleanCust || isCustomerMatch(rcName, cleanCust) || rcName.includes(cleanCust) || cleanCust.includes(rcName))) {
            return rc;
        }
    }

    // Secondary search: check active roster fees if member record is available
    const rosterMembers = globalState.rosterMembers || [];
    const myId = (riderId || appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (riderName || appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();
    
    const member = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").trim().toLowerCase();
        return (myId && mId === myId) || (myName && mName === myName);
    });

    if (member?.customerFees && typeof member.customerFees === 'object') {
        for (const [k, v] of Object.entries(member.customerFees)) {
            if (!v || v.status === 'voided' || v.voided) continue;
            const vKey = String(v.transactionId || v.id || "").trim();
            if (vKey && consumed.has(vKey)) continue;

            const cfName = (v.customerName || k || "").trim().toLowerCase();
            if (cfName === cleanCust || isCustomerMatch(cfName, cleanCust)) {
                if (v.transactionId) {
                    const matchedRc = receipts.find(r => (r.transactionId || r.id) === v.transactionId);
                    if (matchedRc && matchedRc.status !== 'voided') {
                        const matchedKey = String(matchedRc.transactionId || matchedRc.id || "").trim();
                        if (matchedKey && !consumed.has(matchedKey)) return matchedRc;
                    }
                }
                return {
                    transactionId: v.transactionId || "N/A",
                    total: v.total || v.totalFees || v.gross || "₱0.00"
                };
            }
        }
    }

    return null;
}

/**
 * ============================================================================
 * SCENARIO 1 TRIGGER: BEING CATERED AUTO-MESSAGE
 * ============================================================================
 * Triggered when a thread is marked as being catered by the current rider.
 */
export async function triggerAutoMessageOnCater(custId, custName, riderName) {
    if (!custId) return;
    const config = getAutoMessageConfig();
    if (!config.caterEnabled) {
        console.log(`[AutoMessage] Cater auto-message disabled by Admin. Skipping for ${custName}`);
        return;
    }

    const cleanCustId = custId.toString().trim();
    const now = Date.now();
    const lastSent = recentAutoCaterDispatches.get(cleanCustId) || 0;
    if (now - lastSent < 120000) {
        console.log(`[AutoMessage] Cater auto-message debounced (< 2min) for ${cleanCustId}`);
        return;
    }
    recentAutoCaterDispatches.set(cleanCustId, now);

    const resolvedRiderName = (riderName || appState.riderName || localStorage.getItem('riderName') || "Lokalex Rider").trim();
    const text = formatAutoMessage(config.caterTemplate, {
        customerName: custName,
        riderName: resolvedRiderName
    });

    if (!text) return;

    try {
        console.log(`[AutoMessage] Sending Being-Catered auto-message to ${cleanCustId}...`);
        if (typeof sendRiderToCustomerChat === 'function') {
            await sendRiderToCustomerChat(text, null, null, cleanCustId);
        } else if (typeof window.sendRiderToCustomerChat === 'function') {
            await window.sendRiderToCustomerChat(text, null, null, cleanCustId);
        }
        showToast(`🤖 Auto-message sent to ${custName || 'customer'}!`);
    } catch(err) {
        console.warn('[AutoMessage] Error sending cater auto-message:', err);
    }
}

/**
 * ============================================================================
 * SCENARIO 2 TRIGGER: MARK DONE AUTO-MESSAGE (STRICTLY WITH CREATED RECEIPT)
 * ============================================================================
 * Triggered ONLY when completing an active catering order with a verified receipt.
 */
export async function triggerAutoMessageOnDone(custId, custName, riderName, riderId, explicitReceipt = null) {
    if (!custId) return;
    const config = getAutoMessageConfig();
    if (!config.doneEnabled) {
        console.log(`[AutoMessage] Done auto-message disabled by Admin. Skipping for ${custName}`);
        return;
    }

    // STRICT CHECK: ONLY send if the order has a verified, un-consumed receipt!
    const receipt = explicitReceipt || findCustomerReceiptForAutoMsg(custName, riderName, riderId);
    if (!receipt) {
        console.log(`[AutoMessage] Done auto-message skipped for ${custName}: No active/un-consumed created receipt found.`);
        return;
    }

    const receiptKey = String(receipt.transactionId || receipt.id || receipt.receiptNumber || "").trim();
    const consumed = getConsumedReceiptKeys();
    if (receiptKey && consumed.has(receiptKey)) {
        console.log(`[AutoMessage] Done auto-message skipped: Receipt ${receiptKey} was already consumed for an earlier Done message.`);
        return;
    }

    const cleanCustId = custId.toString().trim();
    const now = Date.now();
    const lastSent = recentAutoDoneDispatches.get(cleanCustId) || 0;
    if (now - lastSent < 120000) {
        console.log(`[AutoMessage] Done auto-message debounced (< 2min) for ${cleanCustId}`);
        return;
    }
    recentAutoDoneDispatches.set(cleanCustId, now);

    const resolvedRiderName = (riderName || appState.riderName || localStorage.getItem('riderName') || "Lokalex Rider").trim();
    const receiptTotal = formatReceiptTotal(receipt);
    const receiptNumber = receipt?.transactionId || receipt?.id || "N/A";

    const text = formatAutoMessage(config.doneTemplate, {
        customerName: custName,
        riderName: resolvedRiderName,
        receipt,
        receiptTotal,
        receiptNumber
    });

    if (!text) return;

    try {
        console.log(`[AutoMessage] Sending Done auto-message to ${cleanCustId} (Receipt: ${receiptNumber}, Total: ${receiptTotal})...`);
        if (typeof sendRiderToCustomerChat === 'function') {
            await sendRiderToCustomerChat(text, null, null, cleanCustId);
        } else if (typeof window.sendRiderToCustomerChat === 'function') {
            await window.sendRiderToCustomerChat(text, null, null, cleanCustId);
        }

        // Mark receipt as consumed so it can NEVER trigger another Done message
        if (receiptKey) {
            markReceiptConsumed(receiptKey);
        }

        showToast(`🤖 Order completed auto-message sent to ${custName || 'customer'}!`);
    } catch(err) {
        console.warn('[AutoMessage] Error sending done auto-message:', err);
    }
}

/**
 * Updates UI elements based on current admin permissions and auto-message state.
 */
export function updateAutoMessageUI() {
    const canManage = canManageAutoMessage();

    // Rider Chat header button
    const chatBtn = document.getElementById('chat-automsg-admin-btn') || document.getElementById('chat-automsg-btn');
    if (chatBtn) {
        if (canManage) chatBtn.classList.remove('hidden');
        else chatBtn.classList.add('hidden');
    }

    // Profile Settings card
    const profileCard = document.getElementById('profile-automsg-settings-card');
    if (profileCard) {
        if (canManage) profileCard.classList.remove('hidden');
        else profileCard.classList.add('hidden');
    }

    // Dashboard chat feed button
    const dashFeedBtn = document.getElementById('admin-automsg-settings-btn');
    if (dashFeedBtn) {
        if (canManage) dashFeedBtn.classList.remove('hidden');
        else dashFeedBtn.classList.add('hidden');
    }

    // Dashboard admin toolbar button
    const dashToolbarBtn = document.getElementById('admin-automsg-toolbar-btn');
    if (dashToolbarBtn) {
        const adminControlsActive = Boolean(globalState.adminControlsEnabled) || (typeof localStorage !== 'undefined' && localStorage.getItem('adminControlsEnabled') === 'true');
        if (canManage && adminControlsActive) dashToolbarBtn.classList.remove('hidden');
        else dashToolbarBtn.classList.add('hidden');
    }

    // If settings modal is open, sync its inputs
    const caterCheckbox = document.getElementById('automsg-cater-enabled');
    const doneCheckbox = document.getElementById('automsg-done-enabled');
    const custNameSelect = document.getElementById('automsg-cust-name-format');
    const riderNameSelect = document.getElementById('automsg-rider-name-format');

    if (caterCheckbox && document.activeElement !== caterCheckbox) {
        caterCheckbox.checked = autoMessageState.caterEnabled;
    }
    if (doneCheckbox && document.activeElement !== doneCheckbox) {
        doneCheckbox.checked = autoMessageState.doneEnabled;
    }
    if (custNameSelect && document.activeElement !== custNameSelect) {
        custNameSelect.value = autoMessageState.customerNameFormat || "firstName";
    }
    if (riderNameSelect && document.activeElement !== riderNameSelect) {
        riderNameSelect.value = autoMessageState.riderNameFormat || "firstName";
    }
}

/**
 * ============================================================================
 * ADMIN SETTINGS MODAL UI CONTROLLER
 * ============================================================================
 */
export function getOrCreateAutoMessageModal() {
    let modal = document.getElementById('auto-message-settings-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'auto-message-settings-modal';
        modal.className = 'hidden fixed inset-0 z-[1000045] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none animate-scaleUp';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <!-- Modal Header -->
            <div class="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-gray-200 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-900/80 shrink-0">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center text-sm shadow-xs border border-purple-500/30">
                        <i class="fa-solid fa-robot"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="font-black text-sm text-gray-900 dark:text-white leading-tight">Admin Auto-Message Controls</h3>
                            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800">Admin Only</span>
                        </div>
                        <p class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Global dispatch settings for all riders (Firebase Sync)</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeAutoMessageSettingsModal && window.closeAutoMessageSettingsModal()" class="w-7 h-7 rounded-full bg-gray-200/60 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-300 flex items-center justify-center text-xs transition active:scale-95 cursor-pointer">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <!-- Modal Body (Scrollable Settings Cards) -->
            <div class="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 select-text overscroll-contain">
                <!-- NAME DISPLAY FORMAT PREFERENCES -->
                <div class="bg-gray-50 dark:bg-zinc-900/70 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs transition">
                    <div class="flex items-center gap-2 border-b border-gray-200 dark:border-zinc-800 pb-2.5 mb-3">
                        <span class="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs">
                            <i class="fa-solid fa-signature"></i>
                        </span>
                        <div>
                            <h4 class="text-xs font-black text-gray-900 dark:text-white">Name Display Format</h4>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400">Choose First Name, Last Name, or Whole Name for {customerName} & {riderName}</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                            <label for="automsg-cust-name-format" class="text-[10.5px] font-bold text-gray-700 dark:text-gray-300 block mb-1">Customer Name Format:</label>
                            <select id="automsg-cust-name-format" class="w-full bg-white dark:bg-black/50 border border-gray-300 dark:border-zinc-700 rounded-xl px-2.5 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-indigo-500 font-bold">
                                <option value="firstName">First Name Only (e.g. Juan)</option>
                                <option value="lastName">Last Name Only (e.g. Dela Cruz)</option>
                                <option value="fullName">Whole Name (e.g. Juan Dela Cruz)</option>
                            </select>
                        </div>
                        <div>
                            <label for="automsg-rider-name-format" class="text-[10.5px] font-bold text-gray-700 dark:text-gray-300 block mb-1">Rider Name Format:</label>
                            <select id="automsg-rider-name-format" class="w-full bg-white dark:bg-black/50 border border-gray-300 dark:border-zinc-700 rounded-xl px-2.5 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-indigo-500 font-bold">
                                <option value="firstName">First Name Only (e.g. Amiel)</option>
                                <option value="lastName">Last Name Only (e.g. Garcia)</option>
                                <option value="fullName">Whole Name (e.g. Amiel Garcia)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- SCENARIO 1: BEING CATERED -->
                <div class="bg-gray-50 dark:bg-zinc-900/70 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs transition">
                    <div class="flex items-center justify-between border-b border-gray-200 dark:border-zinc-800 pb-2.5 mb-3">
                        <div class="flex items-center gap-2">
                            <span class="w-7 h-7 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs">
                                <i class="fa-solid fa-motorcycle"></i>
                            </span>
                            <div>
                                <h4 class="text-xs font-black text-gray-900 dark:text-white">1. When Marked "Being Catered"</h4>
                                <p class="text-[10px] text-gray-500 dark:text-gray-400">Triggered automatically when a rider begins catering</p>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="automsg-cater-enabled" class="sr-only peer">
                            <div class="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
                        </label>
                    </div>

                    <div class="space-y-2">
                        <label for="automsg-cater-text" class="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">Custom Message Template:</label>
                        <textarea id="automsg-cater-text" rows="3" placeholder="Enter message sent when a rider caters a customer..." class="w-full bg-white dark:bg-black/40 border border-gray-300 dark:border-zinc-700 rounded-xl p-3 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 transition shadow-inner resize-y"></textarea>
                        
                        <!-- Dynamic Variable Tags -->
                        <div class="flex items-center gap-1.5 flex-wrap pt-1">
                            <span class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Insert tag:</span>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-cater-text', '{customerName}')" class="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-800 text-[10px] font-mono font-bold hover:bg-teal-100 dark:hover:bg-teal-900/60 transition cursor-pointer">{customerName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-cater-text', '{customerFirstName}')" class="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-800 text-[10px] font-mono font-bold hover:bg-teal-100 dark:hover:bg-teal-900/60 transition cursor-pointer">{customerFirstName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-cater-text', '{customerLastName}')" class="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-800 text-[10px] font-mono font-bold hover:bg-teal-100 dark:hover:bg-teal-900/60 transition cursor-pointer">{customerLastName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-cater-text', '{riderName}')" class="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-800 text-[10px] font-mono font-bold hover:bg-teal-100 dark:hover:bg-teal-900/60 transition cursor-pointer">{riderName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-cater-text', '{riderFirstName}')" class="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-800 text-[10px] font-mono font-bold hover:bg-teal-100 dark:hover:bg-teal-900/60 transition cursor-pointer">{riderFirstName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-cater-text', '{time}')" class="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-800 text-[10px] font-mono font-bold hover:bg-teal-100 dark:hover:bg-teal-900/60 transition cursor-pointer">{time}</button>
                        </div>
                    </div>
                </div>

                <!-- SCENARIO 2: MARK DONE (REQUIRES RECEIPT) -->
                <div class="bg-gray-50 dark:bg-zinc-900/70 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs transition">
                    <div class="flex items-center justify-between border-b border-gray-200 dark:border-zinc-800 pb-2.5 mb-2">
                        <div class="flex items-center gap-2">
                            <span class="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs">
                                <i class="fa-solid fa-circle-check"></i>
                            </span>
                            <div>
                                <h4 class="text-xs font-black text-gray-900 dark:text-white">2. When Marked "Done"</h4>
                                <p class="text-[10px] text-gray-500 dark:text-gray-400">Triggered upon delivery completion with receipt</p>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="automsg-done-enabled" class="sr-only peer">
                            <div class="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>

                    <!-- Explicit Receipt Rule Badge -->
                    <div class="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-800 dark:text-amber-300 text-[10px] flex items-center gap-2 font-bold">
                        <i class="fa-solid fa-receipt text-xs shrink-0 text-amber-500"></i>
                        <span>Receipt Condition: Only dispatches if order has a created receipt. Single-use consumption prevents duplicate sends.</span>
                    </div>

                    <div class="space-y-2">
                        <label for="automsg-done-text" class="text-[11px] font-bold text-gray-700 dark:text-gray-300 block">Custom Message Template:</label>
                        <textarea id="automsg-done-text" rows="3" placeholder="Enter message sent when order is marked Done with receipt..." class="w-full bg-white dark:bg-black/40 border border-gray-300 dark:border-zinc-700 rounded-xl p-3 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-500 transition shadow-inner resize-y"></textarea>
                        
                        <!-- Dynamic Variable Tags -->
                        <div class="flex items-center gap-1.5 flex-wrap pt-1">
                            <span class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Insert tag:</span>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-done-text', '{customerName}')" class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-mono font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer">{customerName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-done-text', '{customerFirstName}')" class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-mono font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer">{customerFirstName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-done-text', '{customerLastName}')" class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-mono font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer">{customerLastName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-done-text', '{riderName}')" class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-mono font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer">{riderName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-done-text', '{riderFirstName}')" class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-mono font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer">{riderFirstName}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-done-text', '{receiptTotal}')" class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-mono font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer">{receiptTotal}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-done-text', '{receiptNumber}')" class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-mono font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer">{receiptNumber}</button>
                            <button type="button" onclick="window.insertAutoMessagePlaceholder && window.insertAutoMessagePlaceholder('automsg-done-text', '{time}')" class="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-mono font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer">{time}</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Modal Footer -->
            <div class="px-4 py-3 border-t border-gray-200 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-900/80 flex items-center justify-between shrink-0">
                <button type="button" onclick="window.resetAutoMessageSettingsToDefault && window.resetAutoMessageSettingsToDefault()" class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline font-medium transition cursor-pointer">
                    Reset Defaults
                </button>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="window.closeAutoMessageSettingsModal && window.closeAutoMessageSettingsModal()" class="px-3.5 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-gray-300 font-bold text-xs hover:bg-gray-100 dark:hover:bg-zinc-800 transition active:scale-95 cursor-pointer">
                        Cancel
                    </button>
                    <button type="button" onclick="window.saveAutoMessageSettingsFromUI && window.saveAutoMessageSettingsFromUI()" class="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs transition active:scale-95 shadow-md flex items-center gap-1.5 cursor-pointer">
                        <i class="fa-solid fa-floppy-disk"></i> Save as Admin
                    </button>
                </div>
            </div>
        </div>
        `;
        document.body.appendChild(modal);
    }
    return modal;
}

export function openAutoMessageSettingsModal() {
    if (!canManageAutoMessage()) {
        showToast("⚠️ Unauthorized: Only Admin can configure Auto-Messages.");
        return;
    }

    const modal = getOrCreateAutoMessageModal();
    const config = getAutoMessageConfig();

    const caterCheckbox = document.getElementById('automsg-cater-enabled');
    const caterTextarea = document.getElementById('automsg-cater-text');
    const doneCheckbox = document.getElementById('automsg-done-enabled');
    const doneTextarea = document.getElementById('automsg-done-text');
    const custNameSelect = document.getElementById('automsg-cust-name-format');
    const riderNameSelect = document.getElementById('automsg-rider-name-format');

    if (caterCheckbox) caterCheckbox.checked = config.caterEnabled;
    if (caterTextarea) caterTextarea.value = config.caterTemplate;
    if (doneCheckbox) doneCheckbox.checked = config.doneEnabled;
    if (doneTextarea) doneTextarea.value = config.doneTemplate;
    if (custNameSelect) custNameSelect.value = config.customerNameFormat || "firstName";
    if (riderNameSelect) riderNameSelect.value = config.riderNameFormat || "firstName";

    modal.classList.remove('hidden');
}

export function closeAutoMessageSettingsModal() {
    const modal = document.getElementById('auto-message-settings-modal');
    if (modal) modal.classList.add('hidden');
}

export async function saveAutoMessageSettingsFromUI() {
    if (!canManageAutoMessage()) {
        showToast("⚠️ Unauthorized: Only Admin can save Auto-Message settings.");
        return;
    }

    const caterCheckbox = document.getElementById('automsg-cater-enabled');
    const caterTextarea = document.getElementById('automsg-cater-text');
    const doneCheckbox = document.getElementById('automsg-done-enabled');
    const doneTextarea = document.getElementById('automsg-done-text');
    const custNameSelect = document.getElementById('automsg-cust-name-format');
    const riderNameSelect = document.getElementById('automsg-rider-name-format');

    const config = {
        caterEnabled: caterCheckbox ? caterCheckbox.checked : true,
        caterTemplate: caterTextarea ? caterTextarea.value : DEFAULT_AUTO_MSG_CATER,
        doneEnabled: doneCheckbox ? doneCheckbox.checked : true,
        doneTemplate: doneTextarea ? doneTextarea.value : DEFAULT_AUTO_MSG_DONE,
        customerNameFormat: custNameSelect ? custNameSelect.value : "firstName",
        riderNameFormat: riderNameSelect ? riderNameSelect.value : "firstName"
    };

    const success = await saveAutoMessageConfig(config);
    if (success) {
        showToast("✅ Auto-Message settings saved to cloud!");
        closeAutoMessageSettingsModal();
    }
}

export function resetAutoMessageSettingsToDefault() {
    if (!canManageAutoMessage()) {
        showToast("⚠️ Unauthorized: Only Admin can reset Auto-Message settings.");
        return;
    }

    const caterCheckbox = document.getElementById('automsg-cater-enabled');
    const caterTextarea = document.getElementById('automsg-cater-text');
    const doneCheckbox = document.getElementById('automsg-done-enabled');
    const doneTextarea = document.getElementById('automsg-done-text');
    const custNameSelect = document.getElementById('automsg-cust-name-format');
    const riderNameSelect = document.getElementById('automsg-rider-name-format');

    if (caterCheckbox) caterCheckbox.checked = true;
    if (caterTextarea) caterTextarea.value = DEFAULT_AUTO_MSG_CATER;
    if (doneCheckbox) doneCheckbox.checked = true;
    if (doneTextarea) doneTextarea.value = DEFAULT_AUTO_MSG_DONE;
    if (custNameSelect) custNameSelect.value = "firstName";
    if (riderNameSelect) riderNameSelect.value = "firstName";

    showToast("🔄 Reset to defaults. Tap 'Save as Admin' to apply to all riders.");
}

export function insertAutoMessagePlaceholder(textareaId, tag) {
    const textarea = document.getElementById(textareaId);
    if (!textarea || !tag) return;

    const start = textarea.selectionStart || textarea.value.length;
    const end = textarea.selectionEnd || textarea.value.length;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + tag + text.substring(end);
    textarea.focus();
    const newPos = start + tag.length;
    textarea.setSelectionRange(newPos, newPos);
}

// Window attachment for inline HTML event handlers & global access
if (typeof window !== 'undefined') {
    window.canManageAutoMessage = canManageAutoMessage;
    window.initAutoMessageListener = initAutoMessageListener;
    window.updateAutoMessageUI = updateAutoMessageUI;
    window.getAutoMessageConfig = getAutoMessageConfig;
    window.saveAutoMessageConfig = saveAutoMessageConfig;
    window.formatAutoMessage = formatAutoMessage;
    window.extractNameParts = extractNameParts;
    window.triggerAutoMessageOnCater = triggerAutoMessageOnCater;
    window.triggerAutoMessageOnDone = triggerAutoMessageOnDone;
    window.openAutoMessageSettingsModal = openAutoMessageSettingsModal;
    window.closeAutoMessageSettingsModal = closeAutoMessageSettingsModal;
    window.saveAutoMessageSettingsFromUI = saveAutoMessageSettingsFromUI;
    window.resetAutoMessageSettingsToDefault = resetAutoMessageSettingsToDefault;
    window.insertAutoMessagePlaceholder = insertAutoMessagePlaceholder;
}
