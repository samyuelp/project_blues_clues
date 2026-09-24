/* ==================================================================
   Project Blue's Clues — frontend state machine (v2)

   Flow: loading → clue → video → question → vault → next → (advance)

   Everything is driven by /api/config, which is fetched once on load.
   Answers are validated server-side; this file never sees the correct
   answers, only { correct: true/false } responses.
   ================================================================== */

let CONFIG = null;
let stepIndex = 0;
let currentStep = null;

const $ = (id) => document.getElementById(id);
const screens = {
  loading:  $("screen-loading"),
  clue:     $("screen-clue"),
  video:    $("screen-video"),
  question: $("screen-question"),
  vault:    $("screen-vault"),
  next:     $("screen-next"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

/* ==================================================================
   Ambient background particles
   ================================================================== */
(function initBackground() {
  const canvas = $("bg-canvas");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0;
  const particles = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn() {
    return {
      x: Math.random() * W,
      y: H + Math.random() * 100,
      r: 0.6 + Math.random() * 1.8,
      vy: -(0.15 + Math.random() * 0.5),
      vx: (Math.random() - 0.5) * 0.15,
      alpha: 0.15 + Math.random() * 0.35,
      hue: Math.random() < 0.5 ? "122,168,255" : "240,180,41",
    };
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -20) particles[i] = spawn();
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.hue},${p.alpha})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(loop);
  }

  function start() {
    resize();
    particles.length = 0;
    const count = Math.min(60, Math.floor((W * H) / 22000));
    for (let i = 0; i < count; i++) particles.push(spawn());
    loop();
  }

  window.addEventListener("resize", resize);
  requestAnimationFrame(start);
})();

/* ==================================================================
   Boot
   ================================================================== */
async function init() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to load config");
    CONFIG = await res.json();
    stepIndex = 0;
    // small delay so the loader breathes
    setTimeout(startStep, 600);
  } catch (err) {
    console.error(err);
    screens.loading.innerHTML =
      `<p class="error">Failed to load config. Is the server running?</p>`;
  }
}

function startStep() {
  if (stepIndex >= CONFIG.steps.length) stepIndex = 0;
  currentStep = CONFIG.steps[stepIndex];
  showClueScreen();
}

/* ---------------- 1. Clue ---------------- */
function showClueScreen() {
  $("clue-prompt").textContent = currentStep.prompt || "";
  $("clue-input").value = "";
  $("clue-error").textContent = "";
  showScreen("clue");
  setTimeout(() => $("clue-input").focus(), 300);
}

async function submitClue() {
  const input = $("clue-input").value.trim();
  if (!input) return;

  const res = await fetch("/api/validate/clue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stepId: currentStep.id, input }),
  });
  const data = await res.json();

  if (data.correct) {
    showVideoScreen();
  } else {
    $("clue-error").textContent =
      CONFIG.settings.wrongAnswerMessage || "Not quite.";
    $("clue-input").value = "";
    $("clue-input").focus();
  }
}

/* ---------------- 2. Video ---------------- */
function showVideoScreen() {
  const video = $("video-player");
  const continueBtn = $("video-continue");
  const hint = $("video-hint");

  video.src = currentStep.video.src;
  video.currentTime = 0;
  continueBtn.disabled = true;
  hint.textContent = "Watch the whole video to continue.";
  showScreen("video");

  if (!currentStep.video.requireFullWatch) {
    continueBtn.disabled = false;
    hint.textContent = "";
  }

  video.play().catch(() => {});
}

function onVideoEnded() {
  $("video-continue").disabled = false;
  $("video-hint").textContent = "Nice. Now answer the question.";
}

function onVideoSeeking(e) {
  const video = e.target;
  if (currentStep.video.skippable === false) {
    if (video.currentTime > (video.lastTime || 0) + 0.5) {
      video.currentTime = video.lastTime || 0;
    }
  }
}

/* ---------------- 3. Question ---------------- */
function showQuestionScreen() {
  const q = currentStep.question;
  $("question-text").textContent = q.text;
  $("question-error").textContent = "";

  const container = $("question-options");
  container.innerHTML = "";

  let options = [...q.options];
  if (CONFIG.settings.shuffleOptions) {
    options = options.sort(() => Math.random() - 0.5);
  }

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.textContent = opt.label;
    btn.dataset.optionId = opt.id;
    btn.addEventListener("click", () => submitAnswer(opt.id, btn));
    container.appendChild(btn);
  });

  showScreen("question");
}

async function submitAnswer(optionId, btnEl) {
  document.querySelectorAll(".option-btn").forEach((b) => (b.disabled = true));

  const res = await fetch("/api/validate/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stepId: currentStep.id, optionId }),
  });
  const data = await res.json();

  if (data.correct) {
    btnEl.classList.add("correct");
    setTimeout(showVaultScreen, 800);
  } else {
    btnEl.classList.add("wrong");
    $("question-error").textContent =
      CONFIG.settings.wrongAnswerMessage || "Not quite.";
    setTimeout(() => {
      btnEl.classList.remove("wrong");
      document.querySelectorAll(".option-btn").forEach((b) => (b.disabled = false));
    }, 900);
  }
}

/* ---------------- 4. Vault ---------------- */
function showVaultScreen() {
  showScreen("vault");

  const scene    = $("vault-scene");
  const door     = $("vault-door");
  const handle   = $("vault-handle");
  const bolts    = document.querySelectorAll(".door-bolts span");
  const rays     = $("vault-rays");
  const hint     = $("vault-hint");

  // Reset
  scene.classList.remove("zoom");
  door.classList.remove("open");
  handle.classList.remove("spin");
  rays.classList.remove("on");
  hint.textContent = "Unlocking…";
  clearCanvas("dust-canvas");
  clearCanvas("sparkle-canvas");
  if (sparkleAnimId) { cancelAnimationFrame(sparkleAnimId); sparkleAnimId = null; }
  if (dustAnimId)    { cancelAnimationFrame(dustAnimId);    dustAnimId = null; }

  // Phase 1 — handle spins (0.2s → 1.3s)
  setTimeout(() => {
    handle.classList.add("spin");
  }, 200);

  // Phase 2 — bolts retract (1.4s)
  setTimeout(() => {
    bolts.forEach((b) => {
      const t = b.style.transform;
      b.dataset.orig = t;
      b.style.transform = t + " scale(0.6)";
    });
  }, 1400);

  // Phase 3 — door swings open, dust puffs, rays turn on (2.0s)
  setTimeout(() => {
    door.classList.add("open");
    rays.classList.add("on");
    scene.classList.add("zoom");
    fireDust();
    hint.textContent = "It's open!";
  }, 2000);

  // Phase 4 — sparkles fire as the interior is revealed (2.8s)
  setTimeout(() => {
    fireSparkles();
  }, 2800);

  // Phase 5 — show the next clue (after the vault animation settles)
  const ms = currentStep.vault?.animationMs || 3500;
  setTimeout(showNextScreen, 2000 + ms);
}

/* ---------------- 5. Next clue ---------------- */
function showNextScreen() {
  const clue = currentStep.nextClue || {};
  $("next-text").textContent = clue.text || "";

  // Support both new ("images": [...]) and old ("image": "...") shapes
  let images = [];
  if (Array.isArray(clue.images)) {
    images = clue.images.filter(Boolean);
  } else if (clue.image) {
    images = [clue.image];
  }

  const container = $("next-images");
  container.innerHTML = "";
  container.classList.toggle("two-up", images.length === 2);

  images.forEach((src, i) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = `Clue image ${i + 1}`;
    // Tap to open full-size in a new tab (browser zoom, no leaving the flow)
    img.addEventListener("click", () => window.open(src, "_blank"));
    container.appendChild(img);
  });

  showScreen("next");
}

/* ---------------- 6. Advance ---------------- */
function advance() {
  stepIndex += 1;
  startStep();
}

/* ==================================================================
   Canvas helpers
   ================================================================== */
function clearCanvas(id) {
  const c = $(id);
  if (!c) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
}

function sizeCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

/* ==================================================================
   Dust puff (fires when the door opens)
   ================================================================== */
let dustAnimId = null;

function fireDust() {
  const canvas = $("dust-canvas");
  const { ctx, w, h } = sizeCanvas(canvas);
  const cx = w / 2;
  const cy = h / 2;

  const particles = [];
  const COUNT = 46;
  for (let i = 0; i < COUNT; i++) {
    // Bias angles to the left side (where the door opens)
    const angle = (Math.PI * 0.3) + Math.random() * Math.PI * 1.4;
    const speed = 0.5 + Math.random() * 2.2;
    const r = 10 + Math.random() * 30;
    const life = 70 + Math.random() * 60;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.3,
      r, life, maxLife: life,
    });
  }

  let frame = 0;

  function tick() {
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.r *= 1.01;
      p.life -= 1;
      if (p.life > 0) {
        alive++;
        const a = (p.life / p.maxLife) * 0.35;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        grad.addColorStop(0, `rgba(220,200,160,${a})`);
        grad.addColorStop(1, `rgba(220,200,160,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    frame++;
    if (alive > 0 && frame < 200) {
      dustAnimId = requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, w, h);
      dustAnimId = null;
    }
  }
  tick();
}

/* ==================================================================
   Sparkle burst (fires as the interior is revealed)
   ================================================================== */
let sparkleAnimId = null;

function fireSparkles() {
  const canvas = $("sparkle-canvas");
  const { ctx, w, h } = sizeCanvas(canvas);
  const cx = w / 2;
  const cy = h / 2;

  const palette = ["#ffe9a8", "#f0b429", "#fff4d0", "#ffffff"];
  const particles = [];
  const COUNT = 110;
  for (let i = 0; i < COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.4 + Math.random() * 5;
    const size  = 2 + Math.random() * 4;
    const life  = 70 + Math.random() * 60;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size, life, maxLife: life,
      color: palette[(Math.random() * palette.length) | 0],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.35,
    });
  }

  let frame = 0;

  function tick() {
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.vy += 0.04;
      p.life -= 1;
      p.rotation += p.spin;
      if (p.life > 0) {
        alive++;
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        const s = p.size;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.3, -s * 0.3);
        ctx.lineTo(s, 0);
        ctx.lineTo(s * 0.3, s * 0.3);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.3, s * 0.3);
        ctx.lineTo(-s, 0);
        ctx.lineTo(-s * 0.3, -s * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    frame++;
    if (alive > 0 && frame < 200) {
      sparkleAnimId = requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, w, h);
      sparkleAnimId = null;
    }
  }
  tick();
}

/* ---------------- Wiring ---------------- */
$("clue-submit").addEventListener("click", submitClue);
$("clue-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitClue();
});

const videoEl = $("video-player");
videoEl.addEventListener("ended", onVideoEnded);
videoEl.addEventListener("seeking", onVideoSeeking);
videoEl.addEventListener("timeupdate", (e) => {
  e.target.lastTime = e.target.currentTime;
});

$("video-continue").addEventListener("click", showQuestionScreen);
$("next-done").addEventListener("click", advance);

init();