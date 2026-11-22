/**
 * 1.2 features (the new styles and the filters) stay off the deployed website
 * until 1.2.0 ships: the app, the dev page, the harness and a local site
 * preview show them. Flip RELEASED_12 at the release.
 */
export const RELEASED_12 = false;

const onDeployedSite = typeof location !== 'undefined' && /(^|\.)sonoravisuals\.com$|\.vercel\.app$/.test(location.hostname);

/** Whether 1.2 features show here. */
export const SHOW_12 = RELEASED_12 || !onDeployedSite;
