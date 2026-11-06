// Applies a theme pinned with the page's switch before first paint, so the page never flashes the other palette.
(() => {
  document.documentElement.classList.remove("no-js");
  const pinned = localStorage.getItem("doriterm-theme");
  if (pinned === "light" || pinned === "dark") document.documentElement.dataset.theme = pinned;
})();
