const views = {
  landing: document.querySelector("#landing-view"),
  dashboard: document.querySelector("#dashboard-view"),
  create: document.querySelector("#create-view"),
  course: document.querySelector("#course-view")
};

const accountActions = document.querySelector("#account-actions");
const mainNav = document.querySelector("#main-nav");
const themeToggle = document.querySelector("#theme-toggle");
const themeToggleLabel = document.querySelector("#theme-toggle-label");
const authModal = document.querySelector("#auth-modal");
const authForm = document.querySelector("#auth-form");
const authTitle = document.querySelector("#auth-title");
const authModeLabel = document.querySelector("#auth-mode-label");
const authName = document.querySelector("#auth-name");
const authEmail = document.querySelector("#auth-email");
const authPassword = document.querySelector("#auth-password");
const authSubmit = document.querySelector("#auth-submit");
const authSwitch = document.querySelector("#auth-switch");
const authError = document.querySelector("#auth-error");
const googleAuthButton = document.querySelector("#google-auth-button");
const closeAuth = document.querySelector("#close-auth");
const courseForm = document.querySelector("#course-form");
const statusStrip = document.querySelector("#status-strip");
const statusText = document.querySelector("#status-text");
const dashboardHero = document.querySelector("#dashboard-hero");
const statsRow = document.querySelector("#stats-row");
const courseGrid = document.querySelector("#course-grid");
const emptyLibrary = document.querySelector("#empty-library");
const activeCourseTitle = document.querySelector("#active-course-title");
const progressFill = document.querySelector("#progress-fill");
const progressLabel = document.querySelector("#progress-label");
const moduleList = document.querySelector("#module-list");
const playerFrame = document.querySelector("#player-frame");
const playerProgressChip = document.querySelector("#player-progress-chip");
const lessonMeta = document.querySelector("#lesson-meta");
const lessonTitle = document.querySelector("#lesson-title");
const lessonFocus = document.querySelector("#lesson-focus");
const lessonActivity = document.querySelector("#lesson-activity");
const markComplete = document.querySelector("#mark-complete");
const courseNotes = document.querySelector("#course-notes");
const summaryTitle = document.querySelector("#summary-title");
const summaryText = document.querySelector("#summary-text");
const summaryPoints = document.querySelector("#summary-points");
const summaryTerms = document.querySelector("#summary-terms");
const refreshSummary = document.querySelector("#refresh-summary");
const manualTranscript = document.querySelector("#manual-transcript");
const summarizeTranscript = document.querySelector("#summarize-transcript");
const timerLabel = document.querySelector("#timer-label");
const timerDisplay = document.querySelector("#timer-display");
const timerHint = document.querySelector("#timer-hint");
const studyMinutes = document.querySelector("#study-minutes");
const breakMinutes = document.querySelector("#break-minutes");
const startStudy = document.querySelector("#start-study");
const startBreak = document.querySelector("#start-break");
const pauseTimer = document.querySelector("#pause-timer");
const resetTimer = document.querySelector("#reset-timer");

let authMode = "signin";
let user = null;
let courses = [];
let activeCourseId = null;
let activeLessonNumber = 1;
let theme = localStorage.getItem("vidora-theme") || localStorage.getItem("coursetube-theme") || "dark";
let timer = {
  mode: "study",
  remaining: 25 * 60,
  total: 25 * 60,
  interval: null,
  running: false
};

function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function setStatus(message, mode = "") {
  statusText.textContent = message;
  statusStrip.classList.toggle("is-error", mode === "error");
  statusStrip.classList.toggle("is-ready", mode === "ready");
}

function setAuthError(message = "") {
  authError.textContent = message;
  authError.classList.toggle("hidden", !message);
}

function applyTheme() {
  document.body.dataset.theme = theme;
  const isDark = theme === "dark";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  themeToggleLabel.textContent = isDark ? "Light" : "Dark";
}

function requireAuth(route = "dashboard") {
  if (user) {
    showRoute(route);
    return true;
  }
  openAuth("signin");
  return false;
}

function showRoute(route) {
  if ((route === "dashboard" || route === "create" || route === "course") && !user) {
    openAuth("signin");
    route = "landing";
  }

  Object.entries(views).forEach(([name, element]) => {
    element.classList.toggle("hidden", name !== route);
  });

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.route === route);
  });

  if (route === "dashboard") renderDashboard();
  if (route === "course") renderCourseView();
}

function openAuth(mode) {
  authMode = mode;
  setAuthError("");
  authPassword.setCustomValidity("");
  authForm.reset();
  const isSignup = mode === "signup";
  authModeLabel.textContent = isSignup ? "Create account" : "Sign in";
  authTitle.textContent = isSignup ? "Start your course library" : "Welcome back";
  authName.parentElement.classList.toggle("hidden", !isSignup);
  authName.required = isSignup;
  authSubmit.textContent = isSignup ? "Create account" : "Sign in";
  authSwitch.innerHTML = isSignup
    ? `Already have an account? <button type="button" data-auth-switch="signin">Sign in</button>`
    : `New here? <button type="button" data-auth-switch="signup">Create account</button>`;
  authModal.showModal();
}

function renderAccount() {
  document.querySelectorAll("[data-auth-only]").forEach((item) => {
    item.classList.toggle("hidden", !user);
  });

  if (!user) {
    accountActions.innerHTML = `
      <button class="secondary-button" type="button" data-open-auth="signin">Sign in</button>
      <button class="primary-button" type="button" data-open-auth="signup">Sign up</button>
    `;
    return;
  }

  accountActions.innerHTML = `
    <span class="account-name">${escapeHtml(user.name || user.email)}</span>
    <button class="secondary-button" type="button" data-sign-out>Sign out</button>
  `;
}

function renderDashboard() {
  const completed = courses.reduce((sum, course) => sum + course.completed.length, 0);
  const lessons = courses.reduce((sum, course) => sum + course.summary.lessons, 0);
  const hours = courses.reduce((sum, course) => sum + course.summary.estimatedHours, 0);
  const progress = lessons ? Math.round((completed / lessons) * 100) : 0;
  const nextCourse = courses[0] || null;
  const nextPercent = nextCourse?.summary.lessons ? Math.round((nextCourse.completed.length / nextCourse.summary.lessons) * 100) : 0;

  dashboardHero.innerHTML = nextCourse ? `
    <div>
      <p class="eyebrow">Continue learning</p>
      <h3>${escapeHtml(nextCourse.title)}</h3>
      <p>${escapeHtml(nextCourse.objective)}</p>
      <div class="dashboard-progress"><span style="width: ${nextPercent}%"></span></div>
    </div>
    <div class="dashboard-hero-actions">
      <span>${nextCourse.completed.length} / ${nextCourse.summary.lessons} lessons complete</span>
      <button class="primary-button" type="button" data-open-course="${nextCourse.localId}">Resume course</button>
    </div>
  ` : `
    <div>
      <p class="eyebrow">Start here</p>
      <h3>Build your first course from a playlist.</h3>
      <p>Paste a YouTube playlist, generate a course structure, then study with summaries, notes, and focus tools.</p>
    </div>
    <div class="dashboard-hero-actions">
      <span>No saved courses yet</span>
      <button class="primary-button" type="button" data-route="create">Create course</button>
    </div>
  `;

  statsRow.innerHTML = [
    ["Courses", courses.length, "Saved paths"],
    ["Lessons", lessons, "Total videos"],
    ["Hours", hours, "Estimated study"],
    ["Progress", `${progress}%`, "Overall done"]
  ].map(([label, value, hint]) => `
    <article class="stat-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(hint)}</small>
    </article>
  `).join("");

  emptyLibrary.classList.toggle("hidden", courses.length > 0);
  courseGrid.innerHTML = courses.map((course) => {
    const percent = course.summary.lessons ? Math.round((course.completed.length / course.summary.lessons) * 100) : 0;
    return `
      <article class="course-card">
        <div>
          <p class="eyebrow">${escapeHtml(course.sourceLabel)}</p>
          <h3>${escapeHtml(course.title)}</h3>
        </div>
        <p>${escapeHtml(course.objective)}</p>
        <div class="course-progress" aria-label="${percent}% complete">
          <span style="width: ${percent}%"></span>
        </div>
        <div class="card-meta">
          <span>${course.summary.modules} modules</span>
          <span>${course.summary.lessons} lessons</span>
          <span>${percent}% done</span>
        </div>
        <div class="card-actions">
          <button class="primary-button" type="button" data-open-course="${course.localId}">Open course</button>
          <button class="danger-button" type="button" data-delete-course="${course.localId}" aria-label="Delete course">x</button>
        </div>
      </article>
    `;
  }).join("");
}

function findCourse() {
  return courses.find((course) => course.localId === activeCourseId) || courses[0] || null;
}

function allLessons(course) {
  return course.modules.flatMap((module) => module.lessons.map((lesson) => ({ ...lesson, moduleTitle: module.title })));
}

function getActiveLesson(course = findCourse()) {
  if (!course) return null;
  const lessons = allLessons(course);
  return lessons.find((item) => item.number === activeLessonNumber) || lessons[0] || null;
}

function renderSummaryFallback(course, lesson, message = "") {
  if (!course || !lesson) return;
  summaryTitle.textContent = lesson.title;
  summaryText.textContent = message || "A transcript-based summary is not available for this video yet.";
  summaryPoints.innerHTML = "";
  summaryTerms.innerHTML = "";
}

function renderSummaryResult(summary) {
  summaryTitle.textContent = summary.title;
  summaryText.textContent = summary.overview;
  summaryPoints.innerHTML = summary.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("");
  summaryTerms.innerHTML = (summary.keyTerms || []).map((term) => `<span>${escapeHtml(term)}</span>`).join("");
}

async function loadVideoSummary(course, lesson, force = false) {
  if (!course || !lesson) return;

  course.summaries ||= {};
  const cacheKey = lesson.id || String(lesson.number);
  if (!force && course.summaries[cacheKey]) {
    renderSummaryResult(course.summaries[cacheKey]);
    return;
  }

  if (!lesson.id || lesson.id.startsWith("manual-")) {
    renderSummaryFallback(course, lesson, "This lesson was created manually, so there is no YouTube transcript to summarize.");
    return;
  }

  summaryTitle.textContent = lesson.title;
  summaryText.textContent = "Reading public YouTube captions and preparing the video-content summary...";
  summaryPoints.innerHTML = "";
  summaryTerms.innerHTML = "";
  refreshSummary.disabled = true;

  try {
    const response = await fetch("/api/video-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: lesson.id, title: lesson.title })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not summarize this video.");

    course.summaries[cacheKey] = data;
    saveCourse(course);
    renderSummaryResult(data);
  } catch (error) {
    renderSummaryFallback(course, lesson, error.message);
  } finally {
    refreshSummary.disabled = false;
  }
}

async function summarizeManualTranscript() {
  const course = findCourse();
  const lesson = getActiveLesson(course);
  if (!course || !lesson) return;

  const transcript = manualTranscript.value.trim();
  if (!transcript) {
    renderSummaryFallback(course, lesson, "Paste the video transcript first, then summarize it.");
    return;
  }

  summaryTitle.textContent = lesson.title;
  summaryText.textContent = "Summarizing the pasted transcript...";
  summaryPoints.innerHTML = "";
  summaryTerms.innerHTML = "";
  summarizeTranscript.disabled = true;

  try {
    const response = await fetch("/api/transcript-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: lesson.title, transcript })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not summarize this transcript.");

    course.summaries ||= {};
    const cacheKey = lesson.id || String(lesson.number);
    course.summaries[cacheKey] = data;
    saveCourse(course);
    renderSummaryResult(data);
  } catch (error) {
    renderSummaryFallback(course, lesson, error.message);
  } finally {
    summarizeTranscript.disabled = false;
  }
}

function showStudyTab(tabName) {
  document.querySelectorAll("[data-study-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.studyTab === tabName);
  });
  document.querySelector("#summary-panel").classList.toggle("hidden", tabName !== "summary");
  document.querySelector("#notes-panel").classList.toggle("hidden", tabName !== "notes");
  document.querySelector("#transcript-panel").classList.toggle("hidden", tabName !== "transcript");
  document.querySelector("#focus-panel").classList.toggle("hidden", tabName !== "focus");
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function renderTimer() {
  timerDisplay.textContent = formatTimer(timer.remaining);
  timerLabel.textContent = timer.mode === "break" ? "Break session" : "Study session";
  pauseTimer.textContent = timer.running ? "Pause" : "Resume";
  pauseTimer.disabled = !timer.running && timer.remaining === timer.total;
}

function stopTimerInterval() {
  if (timer.interval) clearInterval(timer.interval);
  timer.interval = null;
  timer.running = false;
}

function startTimer(mode) {
  stopTimerInterval();
  const minutes = Number(mode === "break" ? breakMinutes.value : studyMinutes.value) || (mode === "break" ? 5 : 25);
  timer = {
    mode,
    remaining: Math.max(1, minutes) * 60,
    total: Math.max(1, minutes) * 60,
    interval: null,
    running: true
  };
  timerHint.textContent = mode === "break"
    ? "Break started. Step away, reset your attention, then return to the course."
    : `Focus started for lesson ${activeLessonNumber}. Keep only this video, notes, and one task in view.`;
  timer.interval = setInterval(() => {
    timer.remaining = Math.max(0, timer.remaining - 1);
    renderTimer();
    if (timer.remaining === 0) {
      stopTimerInterval();
      timerHint.textContent = timer.mode === "break" ? "Break finished. Start a study session when ready." : "Study session complete. Mark the lesson or take a short break.";
      renderTimer();
    }
  }, 1000);
  renderTimer();
}

function resetTimerToInputs() {
  stopTimerInterval();
  const minutes = Number(timer.mode === "break" ? breakMinutes.value : studyMinutes.value) || (timer.mode === "break" ? 5 : 25);
  timer.remaining = Math.max(1, minutes) * 60;
  timer.total = timer.remaining;
  timerHint.textContent = "Timer reset. Start when you are ready.";
  renderTimer();
}

function renderCourseView() {
  const course = findCourse();
  if (!course) {
    showRoute("dashboard");
    return;
  }

  activeCourseId = course.localId;
  const lessons = allLessons(course);
  const lesson = lessons.find((item) => item.number === activeLessonNumber) || lessons[0];
  activeLessonNumber = lesson.number;
  const percent = course.summary.lessons ? Math.round((course.completed.length / course.summary.lessons) * 100) : 0;

  activeCourseTitle.textContent = course.title;
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = `${course.completed.length} of ${course.summary.lessons} lessons complete`;
  playerProgressChip.textContent = `${percent}% complete`;
  courseNotes.value = course.notes || "";

  moduleList.innerHTML = course.modules.map((module) => `
    <section class="module-block">
      <h3>Module ${module.number}: ${escapeHtml(module.title)}</h3>
      ${module.lessons.map((item) => `
        <button class="lesson-nav-button ${item.number === activeLessonNumber ? "is-active" : ""} ${course.completed.includes(item.number) ? "is-complete" : ""}" type="button" data-lesson="${item.number}">
          <span class="lesson-number">${item.number}</span>
          <span class="lesson-nav-copy">
            <span class="lesson-nav-title">${escapeHtml(item.title)}</span>
            <span class="lesson-nav-meta">${escapeHtml(item.duration)}</span>
          </span>
        </button>
      `).join("")}
    </section>
  `).join("");

  if (lesson.embedUrl) {
    playerFrame.innerHTML = `<iframe title="${escapeHtml(lesson.title)}" src="${lesson.embedUrl}?rel=0&modestbranding=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  } else {
    playerFrame.innerHTML = `<div class="player-empty">This lesson does not have a YouTube video ID. Use a public playlist import to play videos here.</div>`;
  }

  lessonMeta.textContent = `${lesson.moduleTitle} - ${lesson.duration}`;
  lessonTitle.textContent = lesson.title;
  lessonFocus.textContent = lesson.focus;
  lessonActivity.textContent = lesson.activity;
  markComplete.textContent = course.completed.includes(lesson.number) ? "Undo complete" : "Mark complete";
  manualTranscript.value = "";
  loadVideoSummary(course, lesson);
}

function saveCourse(course) {
  const existingIndex = courses.findIndex((item) => item.localId === course.localId);
  if (existingIndex >= 0) {
    courses[existingIndex] = course;
  } else {
    courses.unshift(course);
  }
  fetch("/api/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ course })
  }).catch(() => {});
}

function courseToMarkdown(course) {
  const lines = [
    `# ${course.title}`,
    "",
    `Objective: ${course.objective}`,
    "",
    `Lessons: ${course.summary.lessons}`,
    `Modules: ${course.summary.modules}`,
    `Estimated hours: ${course.summary.estimatedHours}`,
    `Suggested timeline: ${course.summary.weeks} week(s)`,
    "",
    "## Modules"
  ];

  course.modules.forEach((module) => {
    lines.push("", `### Module ${module.number}: ${module.title}`, module.goal, "");
    module.lessons.forEach((lesson) => {
      lines.push(`- ${lesson.number}. ${lesson.title}`);
      lines.push(`  - Focus: ${lesson.focus}`);
      lines.push(`  - Activity: ${lesson.activity}`);
      if (lesson.url) lines.push(`  - Video: ${lesson.url}`);
    });
    lines.push("", `Checkpoint: ${module.checkpoint}`);
  });

  lines.push("", "## Capstone", course.capstone.brief, "", ...course.capstone.deliverables.map((item) => `- ${item}`));
  return lines.join("\n");
}

document.body.addEventListener("click", (event) => {
  const routeButton = event.target.closest("[data-route]");
  const authButton = event.target.closest("[data-open-auth]");
  const authSwitchButton = event.target.closest("[data-auth-switch]");
  const signOutButton = event.target.closest("[data-sign-out]");
  const openCourseButton = event.target.closest("[data-open-course]");
  const deleteCourseButton = event.target.closest("[data-delete-course]");
  const lessonButton = event.target.closest("[data-lesson]");

  if (authButton) {
    event.preventDefault();
    openAuth(authButton.dataset.openAuth);
    return;
  }

  if (authSwitchButton) {
    event.preventDefault();
    openAuth(authSwitchButton.dataset.authSwitch);
    return;
  }

  if (routeButton) {
    const route = routeButton.dataset.route;
    route === "landing" ? showRoute("landing") : requireAuth(route);
  }

  if (signOutButton) {
    fetch("/api/auth/signout", { method: "POST" }).finally(() => {
      user = null;
      courses = [];
      renderAccount();
      showRoute("landing");
    });
  }

  if (openCourseButton) {
    activeCourseId = openCourseButton.dataset.openCourse;
    const resumeCourse = courses.find((c) => c.localId === activeCourseId);
    activeLessonNumber = resumeCourse?.lastLesson || 1;
    showRoute("course");
  }

  if (deleteCourseButton) {
    const courseId = deleteCourseButton.dataset.deleteCourse;
    courses = courses.filter((course) => course.localId !== courseId);
    fetch(`/api/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" }).catch(() => {});
    renderDashboard();
  }

  if (lessonButton) {
    activeLessonNumber = Number(lessonButton.dataset.lesson);
    const course = findCourse();
    if (course) {
      course.lastLesson = activeLessonNumber;
      saveCourse(course);
    }
    stopTimerInterval();
    resetTimerToInputs();
    renderCourseView();
  }

  const studyTabButton = event.target.closest("[data-study-tab]");
  if (studyTabButton) showStudyTab(studyTabButton.dataset.studyTab);
});

themeToggle.addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem("vidora-theme", theme);
  applyTheme();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthError("");
  if (authPassword.value.length < 8) {
    authPassword.setCustomValidity("Use at least 8 characters.");
    authPassword.reportValidity();
    return;
  }
  authPassword.setCustomValidity("");
  authSubmit.disabled = true;
  try {
    const response = await fetch(authMode === "signup" ? "/api/auth/signup" : "/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: authName.value.trim(),
        email: authEmail.value.trim(),
        password: authPassword.value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Authentication failed.");
    user = data.user;
    await loadCourses();
    renderAccount();
    authModal.close();
    showRoute("dashboard");
  } catch (error) {
    setAuthError(error.message);
  } finally {
    authSubmit.disabled = false;
  }
});

authPassword.addEventListener("input", () => {
  authPassword.setCustomValidity("");
  setAuthError("");
});
authEmail.addEventListener("input", () => setAuthError(""));

closeAuth.addEventListener("click", () => authModal.close());

courseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAuth("create")) return;

  const submitButton = courseForm.querySelector("button[type='submit']");
  const payload = Object.fromEntries(new FormData(courseForm));
  submitButton.disabled = true;
  setStatus("Building the course structure...");

  try {
    const response = await fetch("/api/course", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Course generation failed.");

    const course = {
      ...data,
      localId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      sourceLabel: data.source === "youtube-api" ? "YouTube Data API" : data.source === "youtube" ? "YouTube import" : "Manual course",
      completed: [],
      notes: ""
    };

    saveCourse(course);
    activeCourseId = course.localId;
    activeLessonNumber = 1;
    courseForm.reset();
    setStatus(data.warning ? "Course created with fallback data." : "Course created.", "ready");
    showRoute("course");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

markComplete.addEventListener("click", () => {
  const course = findCourse();
  if (!course) return;
  if (course.completed.includes(activeLessonNumber)) {
    course.completed = course.completed.filter((n) => n !== activeLessonNumber);
  } else {
    course.completed.push(activeLessonNumber);
  }
  saveCourse(course);
  renderCourseView();
});

courseNotes.addEventListener("input", debounce(() => {
  const course = findCourse();
  if (!course) return;
  course.notes = courseNotes.value;
  saveCourse(course);
}, 500));

startStudy.addEventListener("click", () => startTimer("study"));
startBreak.addEventListener("click", () => startTimer("break"));

pauseTimer.addEventListener("click", () => {
  if (timer.running) {
    stopTimerInterval();
    timerHint.textContent = "Timer paused. Resume when you are ready.";
    renderTimer();
    return;
  }
  timer.running = true;
  timer.interval = setInterval(() => {
    timer.remaining = Math.max(0, timer.remaining - 1);
    renderTimer();
    if (timer.remaining === 0) {
      stopTimerInterval();
      timerHint.textContent = timer.mode === "break" ? "Break finished. Start a study session when ready." : "Study session complete. Mark the lesson or take a short break.";
      renderTimer();
    }
  }, 1000);
  timerHint.textContent = "Timer resumed.";
  renderTimer();
});

resetTimer.addEventListener("click", resetTimerToInputs);
refreshSummary.addEventListener("click", () => {
  const course = findCourse();
  const lesson = getActiveLesson(course);
  loadVideoSummary(course, lesson, true);
});
summarizeTranscript.addEventListener("click", summarizeManualTranscript);
studyMinutes.addEventListener("input", () => {
  if (!timer.running && timer.mode === "study") resetTimerToInputs();
});
breakMinutes.addEventListener("input", () => {
  if (!timer.running && timer.mode === "break") resetTimerToInputs();
});

async function loadSession() {
  try {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    user = data.user;
  } catch {
    user = null;
  }
}

async function loadAuthConfig() {
  try {
    const response = await fetch("/api/auth/config");
    const data = await response.json();
    googleAuthButton.classList.toggle("hidden", !data.google);
  } catch {
    googleAuthButton.classList.add("hidden");
  }
}

async function loadCourses() {
  if (!user) {
    courses = [];
    return;
  }
  try {
    const response = await fetch("/api/courses");
    const data = await response.json();
    courses = response.ok ? data.courses || [] : [];
  } catch {
    courses = [];
  }
}

async function boot() {
  applyTheme();
  await loadAuthConfig();
  await loadSession();
  await loadCourses();
  renderAccount();
  renderTimer();
  showRoute(user ? "dashboard" : "landing");
  const authErrorParam = new URLSearchParams(window.location.search).get("auth");
  if (!user && authErrorParam?.startsWith("google_")) {
    openAuth("signin");
    setAuthError("Google sign-in could not be completed. Please try again.");
    window.history.replaceState({}, "", window.location.pathname);
  }
}

boot();
