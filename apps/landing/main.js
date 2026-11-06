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

const LOCK_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const narrowMesh = matchMedia("(max-width: 860px)");
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/** A polyline's points with the fraction of its length at each point, for WAAPI keyframe offsets. */
function along(points) {
  const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
  let run = 0;
  return points.map((point, i) => {
    if (i > 0) run += lengths[i - 1];
    return { point, offset: run / total };
  });
}

/**
 * The hero: one terminal window tiled from four machines around the relay. Links form, each machine's key lights, and
 * packets leave a pane as plaintext, travel sealed, and open only in the pane they reach. Transform and opacity only.
 */
function setupMeshWindow() {
  const root = document.querySelector("[data-meshwin]");
  const body = root.querySelector(".meshwin__body");
  const linksLayer = root.querySelector("[data-links]");
  const packetLayer = root.querySelector("[data-packets]");
  const relay = root.querySelector("[data-relay]");
  const panes = new Map([...root.querySelectorAll("[data-pane]")].map((pane) => [pane.dataset.pane, pane]));
  const steps = new Map([...root.querySelectorAll("[data-step]")].map((line) => [line.dataset.step, line]));
  const routes = new Map();
  let formed = false;
  let introduced = false;

  const measure = () => {
    const box = body.getBoundingClientRect();
    const hub = relay.getBoundingClientRect();
    const center = [hub.left + hub.width / 2 - box.left, hub.top + hub.height / 2 - box.top];
    routes.clear();
    for (const [id, pane] of panes) {
      const rect = pane.getBoundingClientRect();
      const left = rect.left - box.left;
      const top = rect.top - box.top;
      if (narrowMesh.matches) {
        // A rail down the left edge: out of the pane's middle, along the rail to the relay.
        const middle = top + rect.height / 2;
        routes.set(id, [[left, middle], [center[0], middle], center]);
      } else {
        // Straight from the pane corner nearest the relay.
        const corner = [clamp(center[0], left, left + rect.width), clamp(center[1], top, top + rect.height)];
        routes.set(id, [corner, center]);
      }
    }
    linksLayer.replaceChildren(
      ...[...routes].flatMap(([id, points]) =>
        points.slice(1).map((end, i) => {
          const start = points[i];
          const link = document.createElement("i");
          link.className = "mlink";
          link.dataset.for = id;
          link.style.width = `${Math.hypot(end[0] - start[0], end[1] - start[1])}px`;
          link.dataset.base = `translate(${start[0]}px, ${start[1]}px) rotate(${Math.atan2(end[1] - start[1], end[0] - start[0])}rad)`;
          link.style.transform = `${link.dataset.base} scaleX(${formed ? 1 : 0})`;
          return link;
        }),
      ),
    );
  };

  const formLinks = async (signal) => {
    await sequence(
      [...panes.keys()].map((id, index) => async () => {
        for (const link of linksLayer.querySelectorAll(`[data-for="${id}"]`)) {
          link.animate(
            [{ transform: `${link.dataset.base} scaleX(0)` }, { transform: `${link.dataset.base} scaleX(1)` }],
            { duration: 700, easing: "cubic-bezier(0.1, 1, 0.1, 1)", fill: "forwards", delay: index * 40 },
          );
        }
        await sleep(260, signal);
        panes.get(id).classList.add("keyed");
      }),
    );
    formed = true;
    for (const link of linksLayer.children) link.style.transform = `${link.dataset.base} scaleX(1)`;
  };

  const packet = (plain, sealed) => {
    const element = document.createElement("span");
    element.className = "mpacket";
    element.innerHTML = `<span class="plain"></span><span class="sealed">${LOCK_ICON}<b></b></span>`;
    element.querySelector(".plain").textContent = plain;
    element.querySelector(".sealed b").textContent = sealed;
    packetLayer.append(element);
    return element;
  };

  const send = async (from, to, plain, signal) => {
    const path = along(packetRoute(from, to));
    const element = packet(plain, randomHex(4).replaceAll(" ", ""));
    const duration = 2000;
    const moves = [
      element.animate(
        path.map(({ point, offset }) => ({ offset, transform: `translate(${point[0]}px, ${point[1]}px)` })),
        { duration, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
      ),
      element.animate([{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.94 }, { opacity: 0 }], {
        duration,
      }),
      element
        .querySelector(".plain")
        .animate(
          [
            { opacity: 1 },
            { opacity: 1, offset: 0.14 },
            { opacity: 0, offset: 0.2 },
            { opacity: 0, offset: 0.8 },
            { opacity: 1, offset: 0.86 },
            { opacity: 1 },
          ],
          { duration },
        ),
      element
        .querySelector(".sealed")
        .animate(
          [
            { opacity: 0 },
            { opacity: 0, offset: 0.14 },
            { opacity: 1, offset: 0.2 },
            { opacity: 1, offset: 0.8 },
            { opacity: 0, offset: 0.86 },
            { opacity: 0 },
          ],
          { duration },
        ),
    ];
    // The relay pulses as the sealed record passes through it, and the receiving machine's key lights as it opens it.
    moves.push(
      relay.querySelector(".relay-node__ring").animate(
        [
          { opacity: 0.7, transform: "scale(1)" },
          { opacity: 0, transform: "scale(1.35, 1.6)" },
        ],
        { duration: 700, delay: duration * 0.45, easing: "cubic-bezier(0.1, 1, 0.1, 1)" },
      ),
      panes
        .get(to)
        .querySelector(".mpane__key")
        .animate([{ transform: "scale(1)" }, { transform: "scale(1.45)" }, { transform: "scale(1)" }], {
          duration: 500,
          delay: duration * 0.84,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }),
    );
    const stop = () => {
      for (const move of moves) move.cancel();
      element.remove();
    };
    signal.addEventListener("abort", stop, { once: true });
    await moves[0].finished;
    signal.removeEventListener("abort", stop);
    element.remove();
  };

  /** One leg of a packet's route: off the pane (a little past its corner, or from the rail), to the relay. */
  const leg = (id) => {
    const points = routes.get(id);
    if (narrowMesh.matches) return points.slice(1);
    const [[x, y], [cx, cy]] = points;
    const length = Math.hypot(cx - x, cy - y) || 1;
    return [
      [x + ((cx - x) / length) * 14, y + ((cy - y) / length) * 14],
      [cx, cy],
    ];
  };

  /** A packet's route: off the sending pane, through the relay, to just outside the receiving pane. */
  const packetRoute = (from, to) => [...leg(from), ...leg(to).toReversed().slice(1)];

  const show = (step, on = true) => steps.get(step)?.classList.toggle("shown", on);

  const still = () => {
    for (const element of packetLayer.querySelectorAll(".mpacket")) element.remove();
    formed = true;
    measure();
    for (const pane of panes.values()) pane.classList.add("keyed");
    for (const step of steps.keys()) show(step);
    // The still frame (reduced motion, or off screen) shows two records sealed halfway along their routes.
    for (const [from, to, plain] of [
      ["phone", "mini", "1"],
      ["cloud", "laptop", "healthy"],
    ]) {
      const points = along(packetRoute(from, to));
      const middle = points.find(({ offset }) => offset >= 0.3) ?? points[0];
      const element = packet(plain, randomHex(4).replaceAll(" ", ""));
      element.style.transform = `translate(${middle.point[0]}px, ${middle.point[1]}px)`;
      element.querySelector(".plain").style.opacity = "0";
    }
  };

  new ResizeObserver(() => measure()).observe(body);
  narrowMesh.addEventListener("change", measure);

  loopWhileVisible(
    root,
    async (signal) => {
      for (const element of packetLayer.querySelectorAll(".mpacket")) element.remove();
      for (const step of steps.keys()) show(step, false);
      if (!introduced) {
        // The first time the window is seen, the links form and each machine's key lights in turn.
        introduced = true;
        formed = false;
        for (const pane of panes.values()) pane.classList.remove("keyed");
        measure();
        await formLinks(signal);
      }
      await sleep(500, signal);
      show("p-answer");
      await Promise.all([
        send("phone", "mini", "1", signal),
        sleep(300, signal).then(() => send("laptop", "cloud", "tail -f", signal)),
      ]);
      show("m-applied");
      await sleep(600, signal);
      show("c-healthy");
      await Promise.all([send("cloud", "laptop", "healthy", signal), send("mini", "phone", "applied", signal)]);
      show("l-healthy");
      await sleep(2600, signal);
    },
    still,
  );
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
setupMeshWindow();
setupWire();
setupPipe();
setupPairing();
setupMesh();
setupCopy();
