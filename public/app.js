/* ==================================================================
   Project Blue's Clues — frontend state machine (v3)

   Flow:
     loading → clue → [gate 1: video → question]
                    → [gate 2: video → question]
                    → ... (as many gates as config defines)
                    → vault → next clue → (advance / reset)
   ================================================================== */

let CONFIG = null;
let stepIndex = 0;
let currentStep = null;
let gateIndex = 0;

const $ = (id) => document.getElementById(id);
const screens = {
  loading:       $("screen-loading"),
  clue:          $("screen-clue"),
  video:         $("screen-video"),
  question:      $("screen-question"),
  textQuestion:  $("screen-text-question"),
  vault:         $("screen-vault"),
  next:          $("screen-next"),
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
  gateIndex = 0;
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
    gateIndex = 0;
    startGate();
  } else {
    $("clue-error").textContent =
      CONFIG.settings.wrongAnswerMessage || "Not quite.";
    $("clue-input").value = "";
    $("clue-input").focus();
  }
}

/* ==================================================================
   Gate flow — each gate is video → question
   ================================================================== */
function startGate() {
  if (gateIndex >= currentStep.gates.length) {
    showVaultScreen();
    return;
  }
  showVideoScreen();
}

function currentGate() {
  return currentStep.gates[gateIndex];
}

/* ---------------- Gate: Video ---------------- */
function showVideoScreen() {
  const gate = currentGate();
  const video = $("video-player");
  const continueBtn = $("video-continue");
  const hint = $("video-hint");

  video.src = gate.video.src;
  video.currentTime = 0;
  video.lastTime = 0;
  continueBtn.disabled = true;
  hint.textContent = "Watch the whole video to continue.";
  showScreen("video");

  if (!gate.video.requireFullWatch) {
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
  const gate = currentGate();
  const video = e.target;
  if (gate.video.skippable === false) {
    if (video.currentTime > (video.lastTime || 0) + 0.5) {
      video.currentTime = video.lastTime || 0;
    }
  }
}

function replayVideo() {
  const video = $("video-player");
  const continueBtn = $("video-continue");
  const hint = $("video-hint");

  video.currentTime = 0;
  video.lastTime = 0;
  continueBtn.disabled = true;
  hint.textContent = "Watch the whole video to continue.";
  video.play().catch(() => {});
}

/* ---------------- Gate: Question ---------------- */
function showQuestionScreen() {
  const q = currentGate().question;
  if (q.type === "mcq") {
    showMcqQuestion(q);
  } else {
    showTextQuestion(q);
  }
}

/* --- MCQ --- */
function showMcqQuestion(q) {
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
    btn.addEventListener("click", () => submitMcqAnswer(opt.id, btn));
    container.appendChild(btn);
  });

  showScreen("question");
}

async function submitMcqAnswer(optionId, btnEl) {
  document.querySelectorAll(".option-btn").forEach((b) => (b.disabled = true));

  const correct = await validateGate({ optionId });

  if (correct) {
    btnEl.classList.add("correct");
    setTimeout(advanceGate, 800);
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

/* --- Text --- */
function showTextQuestion(q) {
  $("text-question-text").textContent = q.text;
  $("text-answer-input").value = "";
  $("text-question-error").textContent = "";
  showScreen("textQuestion");
  setTimeout(() => $("text-answer-input").focus(), 300);
}

async function submitTextAnswer() {
  const input = $("text-answer-input").value.trim();
  if (!input) return;

  const btn = $("text-question-submit");
  btn.disabled = true;

  const correct = await validateGate({ input });

  if (correct) {
    setTimeout(advanceGate, 400);
  } else {
    $("text-question-error").textContent =
      CONFIG.settings.wrongAnswerMessage || "Not quite.";
    $("text-answer-input").value = "";
    $("text-answer-input").focus();
    btn.disabled = false;
  }
}

/* --- Shared submit for gates --- */
async function validateGate(submission) {
  const body = {
    stepId: currentStep.id,
    gateIndex,
    ...submission,
  };
  const res = await fetch("/api/validate/gate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.correct === true;
}

function advanceGate() {
  gateIndex += 1;
  startGate();
}

/* ==================================================================
   Vault
   ================================================================== */
function showVaultScreen() {
  showScreen("vault");

  const scene    = $("vault-scene");
  const door     = $("vault-door");
  const handle   = $("vault-handle");
  const bolts    = document.querySelectorAll(".door-bolts span");
  const rays     = $("vault-rays");
  const hint     = $("vault-hint");

  scene.classList.remove("zoom");
  door.classList.remove("open");
  handle.classList.remove("spin");
  rays.classList.remove("on");
  hint.textContent = "Unlocking…";
  clearCanvas("dust-canvas");
  clearCanvas("sparkle-canvas");
  if (sparkleAnimId) { cancelAnimationFrame(sparkleAnimId); sparkleAnimId = null; }
  if (dustAnimId)    { cancelAnimationFrame(dustAnimId);    dustAnimId = null; }

  setTimeout(() => {
    handle.classList.add("spin");
  }, 200);

  setTimeout(() => {
    bolts.forEach((b) => {
      const t = b.style.transform;
      b.dataset.orig = t;
      b.style.transform = t + " scale(0.6)";
    });
  }, 1400);

  setTimeout(() => {
    door.classList.add("open");
    rays.classList.add("on");
    scene.classList.add("zoom");
    fireDust();
    hint.textContent = "It's open!";
  }, 2000);

  setTimeout(() => {
    fireSparkles();
  }, 2800);

  const ms = currentStep.vault?.animationMs || 3500;
  setTimeout(showNextScreen, 2000 + ms);
}

/* ---------------- Next clue ---------------- */
function showNextScreen() {
  const clue = currentStep.nextClue || {};
  $("next-text").textContent = clue.text || "";

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
    img.addEventListener("click", () => window.open(src, "_blank"));
    container.appendChild(img);
  });

  showScreen("next");
}

/* ---------------- Advance (Done) ---------------- */
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
   Dust puff
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
   Sparkle burst
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

/* ==================================================================
   Wiring
   ================================================================== */
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
$("video-replay").addEventListener("click", replayVideo);

$("text-question-submit").addEventListener("click", submitTextAnswer);
$("text-answer-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitTextAnswer();
});

$("next-done").addEventListener("click", advance);

init();