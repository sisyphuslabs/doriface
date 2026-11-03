const bridge = window.doriface;
const shell = document.getElementById("shell");
if (bridge !== undefined && shell !== null) {
  shell.textContent = `doriface desktop ${bridge.version} on ${bridge.platform}`;
  document.getElementById("root")?.setAttribute("data-bridge", "ready");
}
