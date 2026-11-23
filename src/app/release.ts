/**
 * 1.2 features (the new styles and the filters) stay off the deployed website
 * until 1.2.0 ships: the app, the dev page, the harness and a local site
 * preview show them. Flip RELEASED_12 at the release.
 */
export const RELEASED_12 = false;

const onDeployedSite = typeof location !== 'undefined' && /(^|\.)sonoravisuals\.com$|\.vercel\.app$/.test(location.hostname);

/** Whether 1.2 features show here. */
export const SHOW_12 = RELEASED_12 || !onDeployedSite;

/**
 * Styles being reworked for 1.3 (Laser from Stage, Cymatics, Cover): only the
 * dev server shows them (the dev page, the harness, `tauri dev`); every build
 * (the app, the website) leaves them out until RELEASED_13.
 */
export const RELEASED_13 = false;
const devServer = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;
export const SHOW_13 = RELEASED_13 || devServer;
/** The styles held for 1.3. */
export const STYLES_13 = ['stage', 'cymatics', 'cover'] as const;
