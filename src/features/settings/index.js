// src/features/settings/index.js
/**
 * Settings Feature Module
 * 
 * Provides configuration and user preference controls for the Lokalex application:
 * - fontSettings: Configures global app font scaling and individual module sizing (Chat, System UI, Roster).
 */

export {
    getFontScales,
    applyFontScales,
    setFontScale,
    resetFontScales,
    syncFontSettingsUI,
    initFontSettings
} from './fontSettings.js';

