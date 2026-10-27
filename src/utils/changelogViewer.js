// src/utils/changelogViewer.js
import changelogRaw from '../../ota-release/CHANGELOG.md?raw';
import { escapeHtml } from './helpers.js';

let cachedChangelogHtml = null;

/**
 * Parses simple markdown changelog format into styled HTML for display.
 */
export function parseChangelogToHtml(markdown) {
    if (!markdown) return '<p class="text-gray-400 italic text-center py-6">No change log available.</p>';

    const lines = markdown.split(/\r?\n/);
    let html = '';
    let inList = false;
    let isFirstVersion = true;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        if (!line) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            continue;
        }

        // Title: # Lokalex App Release Notes
        if (line.startsWith('# ')) {
            continue; // Handled in modal header
        }

        // Version Header: ## Version 1.0.60 (2026-10-25)
        if (line.startsWith('## ')) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            if (!isFirstVersion) {
                html += '</div></div>'; // Close previous version card
            }

            const verText = line.replace('## ', '').trim();
            const verMatch = verText.match(/Version\s+([\d\.]+)(?:\s*\((.*?)\))?/i);
            const verNum = verMatch ? verMatch[1] : verText;
            const verDate = verMatch && verMatch[2] ? verMatch[2] : '';

            html += `
            <div class="bg-gray-50 dark:bg-zinc-900/70 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs transition mb-4">
                <div class="flex items-center justify-between border-b border-gray-200 dark:border-zinc-800 pb-2.5 mb-3">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-1 rounded-xl text-xs font-black font-mono ${isFirstVersion ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}">
                            v${escapeHtml(verNum)}
                        </span>
                        ${isFirstVersion ? '<span class="text-[9px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-bold rounded-md uppercase tracking-wider">Latest</span>' : ''}
                    </div>
                    ${verDate ? `<span class="text-[10px] text-gray-400 dark:text-gray-500 font-medium font-mono">${escapeHtml(verDate)}</span>` : ''}
                </div>
                <div class="space-y-3">
            `;
            isFirstVersion = false;
            continue;
        }

        // Category Subheader: ### 1. Feature Name
        if (line.startsWith('### ')) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            const catTitle = line.replace('### ', '').trim();
            html += `
                <h4 class="text-xs font-black text-gray-900 dark:text-gray-100 flex items-center gap-1.5 pt-1 text-amber-600 dark:text-amber-400">
                    <i class="fa-solid fa-sparkles text-[10px]"></i>
                    ${escapeHtml(catTitle)}
                </h4>
            `;
            continue;
        }

        // Unordered list item: * or -
        if (line.startsWith('* ') || line.startsWith('- ')) {
            if (!inList) {
                html += '<ul class="space-y-1.5 text-xs text-gray-700 dark:text-gray-300 pl-1">';
                inList = true;
            }

            let content = line.substring(2).trim();

            // Format **bold title:**
            content = content.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-gray-900 dark:text-white">$1</strong>');
            // Format `code`
            content = content.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-gray-200 dark:bg-zinc-800 text-[11px] font-mono rounded text-amber-600 dark:text-amber-400">$1</code>');

            html += `
                <li class="flex items-start gap-2 leading-relaxed">
                    <span class="text-emerald-500 font-bold mt-0.5 text-[10px] shrink-0">•</span>
                    <span class="flex-1">${content}</span>
                </li>
            `;
            continue;
        }

        // Plain paragraph text
        if (inList) {
            html += '</ul>';
            inList = false;
        }
        let pText = line.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-gray-900 dark:text-white">$1</strong>');
        pText = pText.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-gray-200 dark:bg-zinc-800 text-[11px] font-mono rounded text-amber-600 dark:text-amber-400">$1</code>');
        html += `<p class="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">${pText}</p>`;
    }

    if (inList) {
        html += '</ul>';
    }
    if (!isFirstVersion) {
        html += '</div></div>';
    }

    return html;
}

/**
 * Creates or gets the floating Change Log Modal.
 */
export function getOrCreateChangelogModal() {
    let modal = document.getElementById('changelog-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'changelog-modal';
        modal.className = 'hidden fixed inset-0 z-[1000040] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-scaleUp';
        modal.innerHTML = `
            <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
                <!-- Modal Header -->
                <div class="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-gray-200 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-900/80 shrink-0">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-sm shadow-xs">
                            <i class="fa-solid fa-scroll"></i>
                        </div>
                        <div>
                            <h3 class="font-black text-sm text-gray-900 dark:text-white leading-tight">Lokalex Change Log</h3>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Release notes & system improvements</p>
                        </div>
                    </div>
                    <button type="button" onclick="window.closeChangelogModal && window.closeChangelogModal()" class="w-7 h-7 rounded-full bg-gray-200/60 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-300 flex items-center justify-center text-xs transition active:scale-95 cursor-pointer">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- Modal Body (Scrollable List) -->
                <div id="changelog-modal-body" class="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2 select-text overscroll-contain">
                    <div class="text-center text-gray-400 py-6 text-xs flex flex-col items-center gap-2">
                        <i class="fa-solid fa-spinner fa-spin text-emerald-500 text-base"></i>
                        <span>Loading release notes...</span>
                    </div>
                </div>

                <!-- Modal Footer -->
                <div class="px-4 py-3 border-t border-gray-200 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-900/80 flex items-center justify-between shrink-0">
                    <span class="text-[10px] text-gray-400 dark:text-gray-500">Auto-synchronized with OTA releases</span>
                    <button type="button" onclick="window.closeChangelogModal && window.closeChangelogModal()" class="px-4 py-1.5 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-800 dark:text-gray-200 font-bold text-xs transition active:scale-95 cursor-pointer">
                        Close
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    return modal;
}

/**
 * Opens the Change Log modal and displays what CHANGELOG.md has.
 */
export async function openChangelogModal() {
    const modal = getOrCreateChangelogModal();
    modal.classList.remove('hidden');

    const bodyEl = document.getElementById('changelog-modal-body');
    if (!bodyEl) return;

    if (!cachedChangelogHtml) {
        cachedChangelogHtml = parseChangelogToHtml(changelogRaw);
    }
    bodyEl.innerHTML = cachedChangelogHtml;

    // Optionally check if remote has an updated CHANGELOG.md (silent background enhancement)
    try {
        const res = await fetch(`https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/CHANGELOG.md?t=${Date.now()}`);
        if (res.ok) {
            const remoteMarkdown = await res.text();
            if (remoteMarkdown && remoteMarkdown.length > 50) {
                cachedChangelogHtml = parseChangelogToHtml(remoteMarkdown);
                if (!modal.classList.contains('hidden')) {
                    bodyEl.innerHTML = cachedChangelogHtml;
                }
            }
        }
    } catch (_) {}
}

export function closeChangelogModal() {
    const modal = document.getElementById('changelog-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Toggles inline change log expandable view on home dashboard.
 */
export function toggleInlineChangelog() {
    const container = document.getElementById('inline-changelog-container');
    const chevron = document.getElementById('inline-changelog-chevron');
    if (!container) return;

    if (container.classList.contains('hidden')) {
        if (!cachedChangelogHtml) {
            cachedChangelogHtml = parseChangelogToHtml(changelogRaw);
        }
        container.innerHTML = cachedChangelogHtml;
        container.classList.remove('hidden');
        if (chevron) chevron.className = 'fa-solid fa-chevron-up text-[9px] transition-transform';
    } else {
        container.classList.add('hidden');
        if (chevron) chevron.className = 'fa-solid fa-chevron-down text-[9px] transition-transform';
    }
}

// Attach to window for onclick handlers
if (typeof window !== 'undefined') {
    window.openChangelogModal = openChangelogModal;
    window.closeChangelogModal = closeChangelogModal;
    window.toggleInlineChangelog = toggleInlineChangelog;
}

