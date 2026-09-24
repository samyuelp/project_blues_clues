/* ==================================================================
   Project Blue's Clues — frontend state machine
   ==================================================================

   Flow:
     loading → clue → video → question → vault → next → (next step or done)

   All answers are validated server-side. This script only:
     - Fetches the sanitized config
     - Walks through the steps array
     - Shows the right screen at the right time
     - Posts inputs to /api/validate/* and reacts to the result
   ================================================================== */

// ---- Global state --------------------------------------------------------
let CONFIG = null;         // sanitized config from server
let stepIndex = 0;         // which step we're on
let currentStep = null;    // the step object

// ---- DOM shortcuts -------------------------------------------------------
const $ = (id) => document.getElementById(id);
const screens = {
  loading:  $("screen-loading"),
  clue:     $("screen-clue"),
  video:    $("screen-video"),
  question: $("screen-question"),
  vault:    $("screen-vault"),
  next:     $("screen-next"),
};

// ---- Screen helper -------------------------------------------------------
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// ---- Boot ----------------------------------------------------------------
async function init() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to load config");
    CONFIG = await res.json();
    stepIndex = 0;
    startStep();
  } catch (err) {
    console.error(err);
    $("screen-loading").innerHTML =
      `<p class="error">Failed to load config. Is the server running?</p>`;
  }
}

// ---- Start a step --------------------------------------------------------
function startStep() {
  if (stepIndex >= CONFIG.steps.length) {
    // All steps done — for now just loop back to step 1.
    // Later you might show a "You escaped!" screen.
    stepIndex = 0;
  }
  currentStep = CONFIG.steps[stepIndex];
  showClueScreen();
}

// ---- 1. Clue input -------------------------------------------------------
function showClueScreen() {
  $("clue-prompt").textContent = currentStep.prompt || "";
  $("clue-input").value = "";
  $("clue-error").textContent = "";
  showScreen("clue");
  $("clue-input").focus();
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

// ---- 2. Video ------------------------------------------------------------
function showVideoScreen() {
  const video = $("video-player");
  const continueBtn = $("video-continue");
  const hint = $("video-hint");

  video.src = currentStep.video.src;
  video.currentTime = 0;
  continueBtn.disabled = true;
  hint.textContent = "Watch the whole video to continue.";
  showScreen("video");

  // If requireFullWatch is false, allow skipping immediately.
  if (!currentStep.video.requireFullWatch) {
    continueBtn.disabled = false;
    hint.textContent = "";
  }

  video.play().catch(() => {
    // Autoplay may be blocked — user can tap play.
  });
}

// Called when the video finishes (or is watched fully)
function onVideoEnded() {
  $("video-continue").disabled = false;
  $("video-hint").textContent = "Nice. Now answer the question.";
}

// Prevent scrubbing if skippable is false
function onVideoSeeking(e) {
  const video = e.target;
  if (currentStep.video.skippable === false) {
    // Allow only tiny forward jumps (avoids blocking normal playback)
    if (video.currentTime > (video.lastTime || 0) + 0.5) {
      video.currentTime = video.lastTime || 0;
    }
  }
}

// ---- 3. Question ---------------------------------------------------------
function showQuestionScreen() {
  const q = currentStep.question;
  $("question-text").textContent = q.text;
  $("question-error").textContent = "";

  const container = $("question-options");
  container.innerHTML = "";

  // Optionally shuffle so teams don't share "it's the 2nd one"
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
  // Disable all buttons while we check
  document.querySelectorAll(".option-btn").forEach((b) => (b.disabled = true));

  const res = await fetch("/api/validate/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stepId: currentStep.id, optionId }),
  });
  const data = await res.json();

  if (data.correct) {
    btnEl.classList.add("correct");
    setTimeout(showVaultScreen, 500);
  } else {
    btnEl.classList.add("wrong");
    $("question-error").textContent =
      CONFIG.settings.wrongAnswerMessage || "Not quite.";
    // Re-enable after the shake so they can try again
    setTimeout(() => {
      btnEl.classList.remove("wrong");
      document.querySelectorAll(".option-btn").forEach((b) => (b.disabled = false));
    }, 700);
  }
}

// ---- 4. Vault ------------------------------------------------------------
function showVaultScreen() {
  showScreen("vault");
  const door = $("vault-door");
  door.classList.remove("open");

  // Small delay so the transition is visible
  setTimeout(() => {
    door.classList.add("open");
  }, 200);

  const ms = currentStep.vault?.animationMs || 2500;
  setTimeout(showNextScreen, ms + 400);
}

// ---- 5. Next clue --------------------------------------------------------
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

// ---- 6. Advance ----------------------------------------------------------
function advance() {
  stepIndex += 1;
  startStep();
}

// ---- Wire up event listeners --------------------------------------------
$("clue-submit").addEventListener("click", submitClue);
$("clue-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitClue();
});

$("video-player").addEventListener("ended", onVideoEnded);
$("video-player").addEventListener("seeking", onVideoSeeking);
$("video-player").addEventListener("timeupdate", (e) => {
  e.target.lastTime = e.target.currentTime;
});

$("video-continue").addEventListener("click", showQuestionScreen);

$("next-done").addEventListener("click", advance);

// ---- Go! -----------------------------------------------------------------
init();