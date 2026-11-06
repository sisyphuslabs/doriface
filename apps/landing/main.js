const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const SVG_NS = "http://www.w3.org/2000/svg";
const STORAGE_KEY = "doriterm-theme";

const randomHex = (bytes) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join(" ");

/** Runs `start` while `element` is on screen and motion is allowed; `stop` runs when either stops holding. */
function whileVisible(element, start, stop) {
  let visible = false;
  let running = false;
  const sync = () => {
    const should = visible && !reducedMotion.matches && document.visibilityState === "visible";
    element.classList.toggle("is-running", should);
    if (should && !running) start();
    if (!should && running) stop();
    running = should;
  };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }).observe(element);
  reducedMotion.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** Runs each step after the previous one settles; a rejected step (an aborted sleep) stops the rest. */
const sequence = (steps) => steps.reduce((chain, step) => chain.then(step), Promise.resolve());

const edgeKey = (a, b) => [a, b].toSorted().join("|");

/** Repeats an async scene while it is visible; leaving the screen aborts it mid-step and `reset` restores the still frame. */
function loopWhileVisible(element, scene, reset) {
  let controller;
  whileVisible(
    element,
    () => {
      controller = new AbortController();
      const { signal } = controller;
      const repeat = () => {
        if (!signal.aborted) scene(signal).then(repeat, () => {});
      };
      repeat();
    },
    () => {
      controller.abort();
      reset();
    },
  );
  reset();
}

/** Tells a live mockup which theme the page pins; "system" lets it follow prefers-color-scheme like the page. */
function postTheme(frame, choice) {
  frame.contentWindow?.postMessage({ theme: choice === "system" ? null : choice }, location.origin);
}

function setupLive() {
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.target;
      const width = Number(getComputedStyle(box).getPropertyValue("--w"));
      box.style.setProperty("--scale", String(entry.contentRect.width / width));
    }
  });
  // The mockups carry React and the app's stylesheet: start loading one only when it comes within a screen of view.
  const load = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const frame = entry.target.querySelector("iframe");
        frame.src = frame.dataset.src;
        load.unobserve(entry.target);
      }
    },
    { rootMargin: "50% 0px" },
  );
  for (const box of document.querySelectorAll(".live")) {
    resize.observe(box);
    load.observe(box);
    const frame = box.querySelector("iframe");
    frame.addEventListener("load", () => postTheme(frame, document.documentElement.dataset.theme ?? "system"));
  }
}

function setupTheme() {
  const buttons = [...document.querySelectorAll("[data-theme-choice]")];
  const apply = (choice) => {
    for (const frame of document.querySelectorAll(".live iframe")) postTheme(frame, choice);
    if (choice === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
    // Blocked site storage throws: the choice then lasts for this page only.
    try {
      if (choice === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, choice);
    } catch {}
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
  };
  apply(document.documentElement.dataset.theme ?? "system");
  for (const button of buttons) button.addEventListener("click", () => apply(button.dataset.themeChoice));
}

function setupReveal() {
  const items = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const item of items) observer.observe(item);
}

function setupHeroScene() {
  const scene = document.querySelector(".scene");
  const svgs = [...scene.querySelectorAll("svg")];
  const lines = [...scene.querySelectorAll("[data-hex]")];
  let timer;
  whileVisible(
    scene,
    () => {
      for (const svg of svgs) svg.unpauseAnimations();
      timer = setInterval(() => {
        const line = lines[Math.floor(Math.random() * lines.length)];
        line.textContent = randomHex(8);
      }, 140);
    },
    () => {
      for (const svg of svgs) svg.pauseAnimations();
      clearInterval(timer);
    },
  );
  for (const svg of svgs) svg.pauseAnimations();
}

function setupWire() {
  for (const stream of document.querySelectorAll("[data-stream]")) {
    const chunks = Array.from({ length: 10 }, () => randomHex(4 + Math.floor(Math.random() * 4)));
    for (const text of [...chunks, ...chunks]) {
      const span = document.createElement("span");
      span.textContent = text;
      stream.append(span);
    }
  }
}

const SESSIONS = [
  {
    command: "git status",
    output: `<span class="dim">On branch</span> main
<span class="dim">Your branch is up to date with</span> 'origin/main'.
<span class="ok">nothing to commit, working tree clean</span>`,
  },
  {
    command: "bun test",
    output: `<span class="dim">bun test v1.4.4</span>
<span class="ok">412 pass</span>
<span class="dim">0 fail</span>
<span class="dim">Ran 412 tests across 58 files.</span>`,
  },
  {
    command: "git log --oneline -3",
    output: `<span class="hl">a41c9e2</span> landing: relay and mesh sections
<span class="hl">7d0b3f1</span> pair: QR opens the web form
<span class="hl">c95e8aa</span> mesh: revoke closes sessions`,
  },
];

function setupPipe() {
  const root = document.querySelector("[data-pipe]");
  const typed = root.querySelector("[data-type]");
  const host = root.querySelector("[data-host]");
  const still = host.innerHTML;
  const prompt = '<span class="prompt">~/app $</span> ';
  loopWhileVisible(
    root,
    (signal) =>
      sequence(
        SESSIONS.flatMap((session) => [
          () => {
            typed.textContent = "";
            host.innerHTML = prompt;
            return sleep(500, signal);
          },
          ...[...session.command].map((char) => () => {
            typed.textContent += char;
            return sleep(55 + Math.random() * 60, signal);
          }),
          () => sleep(650, signal),
          () => {
            host.innerHTML = `${prompt}${session.command}`;
            return sleep(350, signal);
          },
          () => {
            host.innerHTML = `${prompt}${session.command}\n${session.output}`;
            return sleep(2600, signal);
          },
        ]),
      ),
    () => {
      typed.textContent = SESSIONS[0].command;
      host.innerHTML = still;
    },
  );
}

function setupPairing() {
  const root = document.querySelector("[data-pair]");
  const groups = [...root.querySelectorAll("[data-fp] span")];
  const fingerprint = root.querySelector("[data-fp]");
  const chip = root.querySelector("[data-pair-state]");
  const label = chip.lastChild;
  const show = (matched) => {
    fingerprint.classList.toggle("match", matched);
    label.textContent = matched ? "fingerprint matches" : "comparing fingerprint";
    chip.style.opacity = matched ? "1" : "0.7";
  };
  loopWhileVisible(
    root,
    async (signal) => {
      show(false);
      for (const group of groups) group.style.background = "";
      await sleep(1700, signal);
      await sequence(
        groups.map((group) => () => {
          group.style.background = "var(--accent-wash)";
          return sleep(120, signal);
        }),
      );
      show(true);
      for (const group of groups) group.style.background = "";
      await sleep(3000, signal);
    },
    () => show(true),
  );
}

const SERVER_ICON = "M-11 -10h22v8h-22zM-11 2h22v8h-22zM-7 -6h.01M-7 6h.01";
const MESH_HOSTS = [
  { id: "laptop", icon: "M-11 -6h22v13h-22zM-15 10h30" },
  { id: "studio", icon: "M-12 -9h24v15h-24zM-5 11h10M0 6v5" },
  { id: "build-box", icon: SERVER_ICON },
  { id: "vps", icon: SERVER_ICON },
  { id: "pi", icon: "M-9 -9h18v18h-18zM-4 -4h8v8h-8zM-13 -4h4M-13 4h4M9 -4h4M9 4h4" },
];
/** Host positions per stage shape: a wide stage beside the step list, a tall one on phones so labels stay legible. */
const MESH_LAYOUTS = {
  wide: {
    viewBox: "0 0 720 420",
    at: { laptop: [150, 140], studio: [360, 82], "build-box": [575, 150], vps: [530, 330], pi: [220, 332] },
  },
  tall: {
    viewBox: "0 0 360 440",
    at: { laptop: [80, 90], studio: [270, 70], "build-box": [295, 250], vps: [205, 370], pi: [70, 300] },
  },
};
const narrowStage = matchMedia("(max-width: 640px)");
const MEMBERS = ["laptop", "studio", "build-box", "vps"];

function setupMesh() {
  const root = document.querySelector("[data-mesh]");
  const svg = root.querySelector("svg");
  const edgeLayer = svg.querySelector("[data-edges]");
  const sparkLayer = svg.querySelector("[data-sparks]");
  const hostLayer = svg.querySelector("[data-hosts]");
  const steps = [...root.querySelectorAll("[data-step]")];
  const hosts = new Map();
  const edges = new Map();
  let at = MESH_LAYOUTS.wide.at;
  const pos = (id) => at[id];

  for (let i = 0; i < MESH_HOSTS.length; i++) {
    for (let j = i + 1; j < MESH_HOSTS.length; j++) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", "edge off");
      edgeLayer.append(path);
      edges.set(edgeKey(MESH_HOSTS[i].id, MESH_HOSTS[j].id), path);
    }
  }

  for (const host of MESH_HOSTS) {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "host");
    group.innerHTML = `<circle class="ring" r="30"/><path class="icon" d="${host.icon}"/><text y="50">${host.id}</text><text class="tag" y="65"></text>`;
    hostLayer.append(group);
    hosts.set(host.id, group);
  }

  const layout = () => {
    const shape = MESH_LAYOUTS[narrowStage.matches ? "tall" : "wide"];
    at = shape.at;
    svg.setAttribute("viewBox", shape.viewBox);
    root.style.setProperty("--stage-ratio", shape.viewBox.split(" ").slice(2).join(" / "));
    for (const [id, group] of hosts) group.setAttribute("transform", `translate(${pos(id)[0]} ${pos(id)[1]})`);
    for (const [key, path] of edges) {
      const [a, b] = key.split("|").map(pos);
      path.setAttribute("d", `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`);
      path.style.setProperty("--len", String(Math.ceil(path.getTotalLength())));
    }
  };
  layout();
  narrowStage.addEventListener("change", layout);

  const setTag = (id, text) => {
    hosts.get(id).querySelector(".tag").textContent = text;
  };

  const spark = (from, to) => {
    const [ax, ay] = pos(from);
    const [bx, by] = pos(to);
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("class", "spark");
    dot.setAttribute("r", "3.5");
    const motion = document.createElementNS(SVG_NS, "animateMotion");
    motion.setAttribute("dur", "0.9s");
    motion.setAttribute("fill", "freeze");
    motion.setAttribute("begin", "indefinite");
    motion.setAttribute("calcMode", "spline");
    motion.setAttribute("keyTimes", "0;1");
    motion.setAttribute("keyPoints", "0;1");
    motion.setAttribute("keySplines", "0.2 0 0 1");
    motion.setAttribute("path", `M${ax} ${ay} L${bx} ${by}`);
    dot.append(motion);
    sparkLayer.append(dot);
    motion.beginElement();
    setTimeout(() => dot.remove(), 950);
  };

  const highlight = (index) => {
    steps.forEach((step, i) => step.classList.toggle("on", i === index));
  };

  const state = (members, { pending = [], revoked = [] } = {}) => {
    const present = new Set([...members, ...pending, ...revoked]);
    for (const [id, group] of hosts) {
      group.classList.toggle("away", !present.has(id));
      group.classList.toggle("pending", pending.includes(id));
      group.classList.toggle("revoked", revoked.includes(id));
      setTag(id, pending.includes(id) ? "asks to join" : revoked.includes(id) ? "revoked" : "");
    }
    for (const [key, path] of edges) {
      const [a, b] = key.split("|");
      const linked = members.includes(a) && members.includes(b);
      const cut = revoked.includes(a) || revoked.includes(b);
      path.classList.toggle("off", !linked && !cut);
      path.classList.toggle("cut", cut && (members.includes(a) || members.includes(b)));
    }
  };

  const still = () => {
    highlight(-1);
    state([...MEMBERS, "pi"]);
  };

  loopWhileVisible(
    root,
    async (signal) => {
      highlight(0);
      state(MEMBERS);
      await sleep(2800, signal);

      highlight(1);
      state(MEMBERS, { pending: ["pi"] });
      spark("pi", "laptop");
      await sleep(2800, signal);

      highlight(2);
      state([...MEMBERS, "pi"]);
      for (const member of MEMBERS) spark("laptop", member === "laptop" ? "pi" : member);
      await sleep(900, signal);
      for (const member of MEMBERS) spark(member, "pi");
      await sleep(2600, signal);

      highlight(3);
      state(["laptop", "studio", "build-box", "pi"], { revoked: ["vps"] });
      await sleep(3200, signal);
      state(["laptop", "studio", "build-box", "pi"]);
      await sleep(900, signal);
    },
    still,
  );
}

function setupCopy() {
  const button = document.querySelector("[data-copy]");
  const label = button.querySelector("[data-copy-label]");
  const source = document.querySelector("[data-copy-source]");
  button.addEventListener("click", async () => {
    const commands = source.textContent
      .split("\n")
      .map((line) => line.replace(/^\$ /, "").replace(/\s+#.*$/, ""))
      .join("\n");
    try {
      await navigator.clipboard.writeText(commands);
      label.textContent = "Copied";
    } catch {
      label.textContent = "Select and copy";
    }
    setTimeout(() => (label.textContent = "Copy"), 1600);
  });
}

setupReveal();
setupTheme();
setupLive();
setupHeroScene();
setupWire();
setupPipe();
setupPairing();
setupMesh();
setupCopy();
