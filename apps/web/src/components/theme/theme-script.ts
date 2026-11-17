export const THEME_STORAGE_KEY = "yaropay-theme"

/**
 * Runs in <head> before first paint: applies the saved theme (or the system
 * preference) so dark mode never flashes light. Mirrors resolveTheme().
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.setAttribute("data-theme",d?"dark":"light");r.style.colorScheme=d?"dark":"light"}catch(e){}})()`
