// Runs before first paint: light is the default for every new visitor,
// regardless of OS preference. A returning user who explicitly chose dark
// via the toggle never sees a light-theme flash first.
//
// Was inline in index.html until this file -- pulled out specifically so
// script-src can be 'self' only in the CSP (app.ts), with no inline-script
// allowance needed anywhere.
(function () {
  try {
    var saved = localStorage.getItem('pms-theme');
    var theme = saved === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    /* private mode — the default in the markup stands */
  }
})();
