/* ==================================================================
   Project Blue's Clues — frontend state machine
   Flow: loading → clue → video → question → vault → next → (advance)
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

/* ---------------- Boot ---------------- */
async function init() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to load config");
    CONFIG = await res.json();
    stepIndex = 0;
    startStep();
  } catch (err) {
    console.error(err);
    screens.loading.innerHTML =
      `<p class="error">Failed to load config. Is the server running?</p>`;
  }
}

function startStep() {
  if (stepIndex >= CONFIG.steps.length) {
    // Only one step defined? Loop back to it.
    stepIndex = 0;
  }
  currentStep = CONFIG.steps[stepIndex];
  showClueScreen();
}

/* ---------------- 1. Clue ---------------- */
function showClueScreen() {
  $("clue-prompt").textContent = currentStep.prompt || "";
  $("clue-input").value = "";
  $("clue-error").textContent = "";
  showScreen("clue");
  setTimeout(() => $("clue-input").focus(), 150);
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
    setTimeout(showVaultScreen, 600);
  } else {
    btnEl.classList.add("wrong");
    $("question-error").textContent =
      CONFIG.settings.wrongAnswerMessage || "Not quite.";
    setTimeout(() => {
      btnEl.classList.remove("wrong");
      document.querySelectorAll(".option-btn").forEach((b) => (b.disabled = false));
    }, 800);
  }
}

/* ---------------- 4. Vault ---------------- */
function showVaultScreen() {
  showScreen("vault");

  // Clear any leftover sparkles from a previous play-through
  if (sparkleAnimId) {
    cancelAnimationFrame(sparkleAnimId);
    sparkleAnimId = null;
    const c = $("sparkle-canvas");
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
  }

  const door = $("vault-door-group");
  const glow = $("vault-glow");
  const hint = $("vault-hint");

  // Reset
  door.classList.remove("unlocking", "open");
  door.style.transform = "";
  hint.textContent = "Unlocking…";
  glow.classList.remove("on");

  // Phase 1 — handle spins + door rotates slightly (the "unlock")
  setTimeout(() => {
    door.classList.add("unlocking");
  }, 200);

  // Phase 2 — door swings open, glow appears, sparkles fire
  setTimeout(() => {
    door.classList.remove("unlocking");
    // force reflow so the transition plays
    void door.offsetWidth;
    door.classList.add("open");
    glow.classList.add("on");
    fireSparkles();
    hint.textContent = "It's open!";
  }, 1700);

  // Phase 3 — advance to next clue
  const ms = currentStep.vault?.animationMs || 2500;
  setTimeout(showNextScreen, 1700 + ms);
}

/* ---------------- 5. Next clue ---------------- */
function showNextScreen() {
  const clue = currentStep.nextClue || {};
  $("next-text").textContent = clue.text || "";
  const img = $("next-image");
  if (clue.image) {
    img.src = clue.image;
    img.style.display = "block";
  } else {
    img.style.display = "none";
  }
  showScreen("next");
}

/* ---------------- 6. Advance ---------------- */
function advance() {
  stepIndex += 1;
  startStep();
}

/* ---------------- Sparkle burst ---------------- */

let sparkleAnimId = null;

function fireSparkles() {
  const canvas = $("sparkle-canvas");
  const ctx = canvas.getContext("2d");

  // Match the canvas resolution to its rendered size (handles retina)
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const cx = rect.width / 2;
  const cy = rect.height / 2;

  // Colours pulled from the vault glow palette
  const palette = ["#ffe9a8", "#f0b429", "#fff4d0", "#ffffff"];

  // Create a burst of particles radiating outward
  const particles = [];
  const COUNT = 90;
  for (let i = 0; i < COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 4.5;
    const size  = 2 + Math.random() * 4;
    const life  = 60 + Math.random() * 50;

    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      life,
      maxLife: life,
      color: palette[(Math.random() * palette.length) | 0],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
    });
  }

  let frame = 0;

  function tick() {
    ctx.clearRect(0, 0, rect.width, rect.height);
    let alive = 0;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.vy += 0.04; // slight gravity
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

        // Draw a little four-point star
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

    if (alive > 0 && frame < 180) {
      sparkleAnimId = requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, rect.width, rect.height);
      sparkleAnimId = null;
    }
  }

  // Cancel any existing animation before starting a new one
  if (sparkleAnimId) {
    cancelAnimationFrame(sparkleAnimId);
    sparkleAnimId = null;
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