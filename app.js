/* app.js — LegalScan AI prototype
   Real accounts (Firebase Authentication) + real cloud data (Firestore).
   One-time setup instructions live at the top of firebase-config.js.
*/

let RULES = null;
let capturedImages = []; // {dataUrl, file}
let cameraStream = null;
let lastResult = null; // holds the most recently computed inspection, before/after save
let capturedGeo = null; // {lat, lng}

/* ---------------- Firebase init ---------------- */

let auth = null, db = null;
if (typeof FIREBASE_IS_CONFIGURED !== "undefined" && FIREBASE_IS_CONFIGURED) {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
}

let currentUser = null;     // Firebase Auth user object (null when signed out)
let currentProfile = null;  // { name, email, role } loaded from Firestore users/{uid}
let inspectionsCache = [];  // kept live by the Firestore listener in watchInspections()
let unsubscribeInspections = null;

/* ---------------- Login / Sign Up (real — Firebase Authentication) ---------------- */

function isLoggedIn() { return !!currentUser; }
function getUser() { return currentProfile; }
function getRole() { return (currentProfile && currentProfile.role) || "inspector"; }

function showLogin() {
  document.getElementById("login-overlay").style.display = "flex";
  document.getElementById("app-root").style.display = "none";
}
function showApp() {
  document.getElementById("login-overlay").style.display = "none";
  document.getElementById("app-root").style.display = "";
}

// Firebase isn't configured yet — say so plainly and disable the form,
// rather than letting people fill in a login that can never actually work.
function showConfigBanner() {
  const banner = document.getElementById("firebase-config-banner");
  banner.style.display = "block";
  banner.innerHTML = "⚠️ Firebase isn't configured yet, so accounts can't be created or saved. " +
    "Open <code>firebase-config.js</code> and follow the setup steps at the top of that file.";
  document.querySelectorAll("#login-form input, #login-form select, #login-form button, #btn-continue-consumer")
    .forEach(el => el.disabled = true);
}

let currentTab = "login";
document.querySelectorAll(".login-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".login-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentTab = tab.dataset.tab;
    const isSignup = currentTab === "signup";
    document.getElementById("login-submit-btn").textContent = isSignup ? "Create Account" : "Log In";
    document.querySelectorAll(".signup-only").forEach(el => el.style.display = isSignup ? "" : "none");
    document.getElementById("login-error").textContent = "";
  });
});

// Human-readable text for Firebase's auth error codes — this is what makes
// "log in with no account" fail loudly and clearly instead of silently working.
function authErrorMessage(err) {
  switch (err.code) {
    case "auth/email-already-in-use": return "An account with that email already exists — try Log In instead.";
    case "auth/invalid-email": return "That doesn't look like a valid email address.";
    case "auth/weak-password": return "Password should be at least 6 characters.";
    case "auth/user-not-found": return "No account found with that email — try Sign Up instead.";
    case "auth/wrong-password":
    case "auth/invalid-credential": return "Incorrect email or password.";
    case "auth/too-many-requests": return "Too many attempts. Please wait a moment and try again.";
    default: return err.message || "Something went wrong. Please try again.";
  }
}

document.getElementById("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit-btn");
  errEl.textContent = "";
  if (!auth) { showConfigBanner(); return; }

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  submitBtn.disabled = true;
  try {
    if (currentTab === "signup") {
      const name = document.getElementById("login-name").value.trim();
      const role = document.getElementById("login-role").value;
      if (!name) { errEl.textContent = "Please enter your full name."; submitBtn.disabled = false; return; }
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      await db.collection("users").doc(cred.user.uid).set({
        name, email, role, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // onAuthStateChanged (below) picks this up and shows the app.
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  } catch (err) {
    errEl.textContent = authErrorMessage(err);
  }
  submitBtn.disabled = false;
});

document.getElementById("btn-continue-consumer").addEventListener("click", async () => {
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  if (!auth) { showConfigBanner(); return; }
  try {
    const cred = await auth.signInAnonymously();
    const doc = await db.collection("users").doc(cred.user.uid).get();
    if (!doc.exists) {
      await db.collection("users").doc(cred.user.uid).set({
        name: "Consumer", email: "", role: "consumer",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    // onAuthStateChanged (below) picks this up and shows the app.
  } catch (err) {
    errEl.textContent = authErrorMessage(err);
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  if (unsubscribeInspections) { unsubscribeInspections(); unsubscribeInspections = null; }
  if (auth) await auth.signOut();
  document.getElementById("login-form").reset();
  document.getElementById("login-error").textContent = "";
  showLogin();
});

/* ---------------- Auth state → drives the whole app ---------------- */

function watchInspections() {
  if (unsubscribeInspections) { unsubscribeInspections(); unsubscribeInspections = null; }
  if (!db || !currentUser) return;

  const role = getRole();
  // Inspectors get a live view of every inspection from every user (the
  // admin view). Everyone else only ever gets their own — enforced again
  // server-side by the Firestore security rules in firebase-config.js, so
  // this isn't just a client-side filter.
  const query = role === "inspector"
    ? db.collection("inspections").orderBy("date", "desc")
    : db.collection("inspections").where("uid", "==", currentUser.uid);

  unsubscribeInspections = query.onSnapshot(snap => {
    inspectionsCache = snap.docs.map(d => d.data());
    if (role !== "inspector") inspectionsCache.sort((a, b) => b.date - a.date);
    refreshCurrentScreen();
  }, err => console.error("Inspections listener error:", err));
}

function refreshCurrentScreen() {
  updateScanCounter();
  const current = document.querySelector(".nav-item.active");
  const screen = current ? current.dataset.screen : "dashboard";
  if (screen === "dashboard") renderDashboard();
  if (screen === "history") renderHistory();
  if (screen === "analytics") renderAnalytics();
}

if (auth) {
  auth.onAuthStateChanged(async user => {
    currentUser = user;
    inspectionsCache = [];
    if (user) {
      try {
        const doc = await db.collection("users").doc(user.uid).get();
        currentProfile = doc.exists ? doc.data()
          : { name: user.displayName || "User", email: user.email || "", role: "inspector" };
      } catch (err) {
        console.error("Could not load user profile:", err);
        currentProfile = { name: user.displayName || "User", email: user.email || "", role: "inspector" };
      }
      showApp();
      applyRole();
      watchInspections();
    } else {
      currentProfile = null;
      showLogin();
    }
  });
} else {
  // Firebase isn't configured — surface that clearly instead of a login
  // form that looks real but can never actually succeed.
  document.addEventListener("DOMContentLoaded", showConfigBanner);
}

/* ---------------- Role switching (Inspector / Manufacturer / Consumer) ---------------- */

const ROLE_LABELS = {
  inspector: { sub: "Field Operations", avatar: "IO" },
  manufacturer: { sub: "Pre-Market Self-Check", avatar: "MF" },
  consumer: { sub: "Quick Scan", avatar: "CU" }
};
// Which nav items each role can see (data-screen values)
const ROLE_NAV = {
  inspector: ["dashboard", "new-inspection", "history", "analytics", "rules"],
  manufacturer: ["dashboard", "new-inspection", "history"],
  consumer: ["new-inspection", "history"]
};

function applyRole() {
  const role = getRole();
  const info = ROLE_LABELS[role];
  const user = getUser();
  document.getElementById("officer-name").textContent = (user && user.name) || "Guest";
  document.getElementById("officer-role").textContent = info.sub;
  document.getElementById("officer-avatar").textContent = info.avatar;

  // Role is now a real account attribute set at sign-up (not a demo toggle),
  // so the old free-switching dropdown is retired.
  const roleSelect = document.getElementById("role-select");
  if (roleSelect) roleSelect.style.display = "none";

  // "Submitted By" column only makes sense for the Inspector admin view.
  document.querySelectorAll(".col-submitter").forEach(el => {
    el.style.display = (role === "inspector") ? "" : "none";
  });

  const allowed = ROLE_NAV[role];
  document.querySelectorAll(".nav-item[data-screen]").forEach(btn => {
    btn.style.display = allowed.includes(btn.dataset.screen) ? "" : "none";
  });

  // Adjust wording + visibility for the consumer / manufacturer flows
  document.getElementById("new-inspection-heading").textContent =
    role === "consumer" ? "Quick Scan" : role === "manufacturer" ? "Pre-Market Self-Check" : "New Inspection";
  document.getElementById("new-inspection-sub").textContent =
    role === "consumer" ? "Scan a product label to check compliance before or after buying."
    : role === "manufacturer" ? "Upload a label design or product photo before printing/listing to catch issues early."
    : "Upload or capture package images for compliance scanning.";
  document.querySelectorAll(".meta-officer-only").forEach(el => {
    el.style.display = (role === "consumer") ? "none" : "";
  });
  document.getElementById("btn-report-violation").style.display = (role === "consumer") ? "" : "none";
  document.getElementById("btn-dispute").style.display = (role === "manufacturer") ? "" : "none";
  updateScanCounter();

  // Land on a role-appropriate screen if the current one is hidden
  const current = document.querySelector(".nav-item.active");
  if (current && current.style.display === "none") {
    goto(allowed[0] || "new-inspection");
  }
}

/* ---------------- Navigation ---------------- */

const screens = ["dashboard", "new-inspection", "results", "history", "analytics", "rules"];
const crumbNames = {
  "dashboard": "Dashboard", "new-inspection": "New Inspection", "results": "Inspection Result",
  "history": "Inspection History", "analytics": "Analytics", "rules": "Rules & Standards"
};

function goto(screen) {
  screens.forEach(s => {
    document.getElementById("screen-" + s).style.display = (s === screen) ? "" : "none";
  });
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.screen === screen);
  });
  document.getElementById("crumb-current").textContent = crumbNames[screen] || screen;
  if (screen === "dashboard") renderDashboard();
  if (screen === "history") renderHistory();
  if (screen === "analytics") renderAnalytics();
  if (screen === "rules") renderRulesScreen();
}

document.querySelectorAll(".nav-item[data-screen]").forEach(btn => {
  btn.addEventListener("click", () => goto(btn.dataset.screen));
});
document.querySelectorAll("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => goto(btn.dataset.goto));
});

/* ---------------- Storage helpers (Firestore-backed) ---------------- */

// inspectionsCache is kept live by the onSnapshot listener in watchInspections()
// above, already scoped correctly per role — Inspectors get everyone's
// inspections (the admin view), everyone else only ever gets their own.
// Both names are kept since both are used below; they're equivalent now.
function getInspections() { return inspectionsCache; }
function getVisibleInspections() { return inspectionsCache; }

async function saveInspection(inspection) {
  const record = {
    ...inspection,
    uid: currentUser.uid,
    ownerName: (currentProfile && currentProfile.name) || "Unknown",
    ownerEmail: (currentProfile && currentProfile.email) || ""
  };
  await db.collection("inspections").doc(inspection.id).set(record);
  // The onSnapshot listener above updates inspectionsCache and re-renders
  // the current screen automatically once this write lands.
}
async function updateInspection(id, patch) {
  await db.collection("inspections").doc(id).update(patch);
}

// Always-visible scan counter in the top bar — visible on every screen and
// every role, so you don't have to open the Dashboard to see how many
// inspections/scans you've done.
function updateScanCounter() {
  const el = document.getElementById("scan-counter");
  if (!el) return;
  const count = getVisibleInspections().length;
  const role = getRole();
  const noun = role === "consumer" ? "scans" : "inspections";
  el.textContent = `${count} ${noun} so far`;
}

function badgeClass(status) {
  if (status === "Compliant") return "compliant";
  if (status === "Needs Review") return "review";
  return "noncompliant";
}

/* ---------------- Dashboard ---------------- */

function renderDashboard() {
  const all = getVisibleInspections();
  const total = all.length;
  const compliant = all.filter(i => i.status === "Compliant").length;
  const review = all.filter(i => i.status !== "Compliant").length;
  const evidence = all.reduce((s, i) => s + (i.imageCount || 0), 0);

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-compliant").textContent = compliant;
  document.getElementById("stat-compliant-rate").textContent =
    (total ? Math.round(compliant / total * 100) : 0) + "% compliance rate";
  document.getElementById("stat-review").textContent = review;
  document.getElementById("stat-review-rate").textContent =
    (total ? Math.round(review / total * 100) : 0) + "% of inspections";
  document.getElementById("stat-evidence").textContent = evidence;
  document.getElementById("stat-evidence-avg").textContent =
    (total ? (evidence / total).toFixed(1) : 0) + " average / inspection";

  const tbody = document.querySelector("#recent-table tbody");
  tbody.innerHTML = "";
  const recent = all.slice(0, 6);
  document.getElementById("dashboard-empty").style.display = recent.length ? "none" : "block";
  recent.forEach(i => tbody.appendChild(rowForInspection(i, false)));
}

function rowForInspection(i, withAction) {
  const tr = document.createElement("tr");
  tr.className = "clickable";
  tr.innerHTML = `
    <td>${i.code}</td>
    <td>${i.category || "—"}</td>
    <td>${i.location || "—"}</td>
    <td class="col-submitter">${esc(i.ownerName || "—")}</td>
    <td>${i.score}</td>
    <td><span class="badge ${badgeClass(i.status)}">${i.status}</span></td>
    <td>${new Date(i.date).toLocaleString()}</td>
    ${withAction ? "<td></td>" : ""}
  `;
  tr.addEventListener("click", () => showSavedResult(i));
  return tr;
}

/* ---------------- History ---------------- */

function renderHistory() {
  const all = getVisibleInspections();
  populateHistoryCategoryFilter(all);
  applyHistoryFilters();
}

function populateHistoryCategoryFilter(all) {
  const sel = document.getElementById("history-filter-category");
  if (!sel) return;
  const current = sel.value;
  const cats = Array.from(new Set(all.map(i => i.category).filter(Boolean)));
  sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option>${c}</option>`).join("");
  sel.value = current;
}

function applyHistoryFilters() {
  const all = getVisibleInspections();
  const q = (document.getElementById("history-search")?.value || "").toLowerCase().trim();
  const statusF = document.getElementById("history-filter-status")?.value || "";
  const catF = document.getElementById("history-filter-category")?.value || "";

  const filtered = all.filter(i => {
    if (statusF && i.status !== statusF) return false;
    if (catF && i.category !== catF) return false;
    if (q) {
      const hay = [i.code, i.category, i.location, i.brand, i.batch].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const tbody = document.querySelector("#history-table tbody");
  tbody.innerHTML = "";
  document.getElementById("history-empty").style.display = filtered.length ? "none" : "block";
  document.getElementById("history-empty").textContent = all.length
    ? "No inspections match your search/filter." : "No inspections saved yet.";
  filtered.forEach(i => tbody.appendChild(rowForInspection(i, true)));
}

["history-search", "history-filter-status", "history-filter-category"].forEach(id => {
  document.addEventListener("input", e => { if (e.target && e.target.id === id) applyHistoryFilters(); });
  document.addEventListener("change", e => { if (e.target && e.target.id === id) applyHistoryFilters(); });
});

/* ---------------- New Inspection: upload & camera ---------------- */

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");

document.getElementById("btn-choose-images").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", e => addFiles(e.target.files));

["dragover", "dragenter"].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.style.borderColor = "#3b82f6"; }));
["dragleave", "drop"].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.style.borderColor = ""; }));
dropzone.addEventListener("drop", e => addFiles(e.dataTransfer.files));

function addFiles(fileList) {
  Array.from(fileList).forEach(file => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      capturedImages.push({ dataUrl: reader.result, file });
      renderThumbs();
    };
    reader.readAsDataURL(file);
  });
}

function renderThumbs() {
  const wrap = document.getElementById("thumbs");
  wrap.innerHTML = "";
  capturedImages.forEach((img, idx) => {
    const div = document.createElement("div");
    div.className = "thumb";
    div.innerHTML = `<img src="${img.dataUrl}"><button class="remove" data-idx="${idx}">✕</button>`;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll(".remove").forEach(btn => {
    btn.addEventListener("click", () => {
      capturedImages.splice(+btn.dataset.idx, 1);
      renderThumbs();
    });
  });
}

// Camera
document.getElementById("btn-open-camera").addEventListener("click", async () => {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    document.getElementById("camera-video").srcObject = cameraStream;
    document.getElementById("camera-wrap").style.display = "block";
  } catch (e) {
    alert("Could not access camera: " + e.message + "\n(Camera requires running this app via a local server — see README — and browser permission.)");
  }
});
document.getElementById("btn-close-camera").addEventListener("click", closeCamera);
function closeCamera() {
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
  document.getElementById("camera-wrap").style.display = "none";
}
document.getElementById("btn-capture").addEventListener("click", () => {
  const video = document.getElementById("camera-video");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  capturedImages.push({ dataUrl });
  renderThumbs();
});

document.getElementById("btn-cancel-inspection").addEventListener("click", () => {
  capturedImages = []; renderThumbs(); closeCamera(); capturedGeo = null; updateGeoStatus();
  goto(getRole() === "consumer" ? "new-inspection" : "dashboard");
});

/* ---------------- Geotagging (optional) ---------------- */

function updateGeoStatus() {
  const el = document.getElementById("geo-status");
  if (!el) return;
  el.textContent = capturedGeo
    ? `📍 Location attached: ${capturedGeo.lat.toFixed(5)}, ${capturedGeo.lng.toFixed(5)}`
    : "No location attached yet.";
}
document.getElementById("btn-attach-location").addEventListener("click", () => {
  if (!navigator.geolocation) { alert("Geolocation is not supported on this device/browser."); return; }
  const el = document.getElementById("geo-status");
  el.textContent = "Requesting location…";
  navigator.geolocation.getCurrentPosition(
    pos => {
      capturedGeo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateGeoStatus();
    },
    err => { el.textContent = "Could not get location: " + err.message; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

/* ---------------- Analyze pipeline ---------------- */

document.getElementById("btn-analyze").addEventListener("click", runAnalysis);

async function runAnalysis() {
  if (!capturedImages.length) { alert("Add at least one image first."); return; }
  closeCamera();

  const progressWrap = document.getElementById("progress-wrap");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");
  progressWrap.style.display = "block";
  progressFill.style.width = "0%";

  const meta = {
    category: document.getElementById("meta-category").value,
    location: document.getElementById("meta-location").value,
    brand: document.getElementById("meta-brand").value,
    batch: document.getElementById("meta-batch").value
  };

  let fullText = "";
  let allWords = [];
  let refImageHeight = 0;

  const ocrLang = document.getElementById("meta-ocr-lang").value || RULES.defaultOcrLanguage || "eng";

  try {
    for (let i = 0; i < capturedImages.length; i++) {
      progressLabel.textContent = `Running OCR (${ocrLang}) on image ${i + 1} of ${capturedImages.length}…`;
      let data;
      try {
        ({ data } = await Tesseract.recognize(capturedImages[i].dataUrl, ocrLang, {
          logger: m => {
            if (m.status === "recognizing text") {
              const pct = Math.round(((i + m.progress) / capturedImages.length) * 100);
              progressFill.style.width = pct + "%";
            }
          }
        }));
      } catch (langErr) {
        // Language pack failed to load (e.g. no internet for the extra script) — fall back to English only.
        progressLabel.textContent = `"${ocrLang}" pack unavailable, retrying with English…`;
        ({ data } = await Tesseract.recognize(capturedImages[i].dataUrl, "eng"));
      }
      fullText += "\n----- Image " + (i + 1) + " -----\n" + data.text;
      allWords = allWords.concat(data.words || []);
      if (i === 0) refImageHeight = data.imageWidth ? data.imageHeight : 1000;
    }
  } catch (err) {
    progressWrap.style.display = "none";
    alert("OCR failed: " + err.message);
    return;
  }

  progressLabel.textContent = "Applying compliance rules…";
  const fieldResults = extractFields(fullText, allWords, refImageHeight || 1000, RULES);
  const verdict = scoreInspection(fieldResults, RULES);

  const inspection = {
    id: "insp_" + Date.now(),
    code: "INS-" + new Date().getFullYear() + "-" + String(getInspections().length + 1).padStart(4, "0"),
    date: Date.now(),
    category: meta.category, location: meta.location, brand: meta.brand, batch: meta.batch,
    imageCount: capturedImages.length,
    images: capturedImages.map(i => i.dataUrl),
    fullText,
    fieldResults,
    status: verdict.status,
    score: verdict.score,
    criticalMissing: verdict.criticalMissing,
    minorIssues: verdict.minorIssues,
    needsReview: verdict.needsReview,
    disputed: false,
    role: getRole(),
    ocrLanguage: ocrLang,
    geo: capturedGeo
  };

  progressWrap.style.display = "none";
  await saveInspection(inspection);
  capturedImages = []; renderThumbs();
  capturedGeo = null; updateGeoStatus();
  document.getElementById("meta-category").value = "";
  document.getElementById("meta-location").value = "";
  document.getElementById("meta-brand").value = "";
  document.getElementById("meta-batch").value = "";

  showSavedResult(inspection);
}

/* ---------------- Results screen ---------------- */

function showSavedResult(inspection) {
  lastResult = inspection;
  const geoTxt = inspection.geo ? ` • 📍 ${inspection.geo.lat.toFixed(4)}, ${inspection.geo.lng.toFixed(4)}` : "";
  const langTxt = inspection.ocrLanguage ? ` • OCR: ${inspection.ocrLanguage}` : "";
  document.getElementById("results-sub").textContent =
    `${inspection.code} • ${inspection.category || "Uncategorized"} • ${inspection.location || "Location not set"} • ${new Date(inspection.date).toLocaleString()}${geoTxt}${langTxt}`;

  const badge = document.getElementById("verdict-badge");
  badge.textContent = inspection.status;
  badge.className = "verdict-badge badge " + badgeClass(inspection.status);
  document.getElementById("verdict-score").textContent = inspection.score + " / 100";
  document.getElementById("verdict-desc").textContent =
    inspection.criticalMissing > 0
      ? `${inspection.criticalMissing} mandatory declaration(s) missing.`
      : (inspection.needsReview > 0 || inspection.minorIssues > 0)
        ? "All mandatory fields detected, but some findings need manual verification."
        : "All checks passed with high confidence.";

  const findingsWrap = document.getElementById("findings");
  findingsWrap.innerHTML = "";
  Object.values(inspection.fieldResults).forEach(f => {
    const cls = !f.found ? (f.severity === "critical" ? "critical" : "minor")
              : (f.confidence !== null && f.confidence < RULES.minOcrConfidence) ? "minor" : "ok";
    const div = document.createElement("div");
    div.className = "finding " + cls;
    div.innerHTML = `
      <div class="finding-left">
        <div class="finding-name">${f.label} ${f.severity === "critical" ? "" : "<span class='muted small'>(minor)</span>"} ${f.matchedLanguage === "hi" ? "<span class='muted small'>(via Hindi label)</span>" : ""}</div>
        <div class="finding-value">${f.found ? esc(f.value) : "Not detected — " + f.hint}</div>
      </div>
      <div class="finding-right">
        <span class="badge ${f.found ? (cls === "ok" ? "compliant" : "review") : "noncompliant"}">
          ${f.found ? (cls === "ok" ? "Detected" : "Needs Review") : "Missing"}
        </span>
        <div class="finding-conf">${f.confidence !== null ? "OCR confidence: " + f.confidence + "%" : ""}</div>
      </div>`;
    findingsWrap.appendChild(div);
  });

  const thumbsWrap = document.getElementById("results-thumbs");
  thumbsWrap.innerHTML = "";
  (inspection.images || []).forEach(src => {
    const div = document.createElement("div");
    div.className = "thumb";
    div.innerHTML = `<img src="${src}">`;
    thumbsWrap.appendChild(div);
  });

  document.getElementById("raw-text").textContent = inspection.fullText.trim();

  const disputeBtn = document.getElementById("btn-dispute");
  disputeBtn.textContent = inspection.disputed ? "Dispute Raised ✓" : "Raise Dispute";
  disputeBtn.disabled = inspection.disputed;

  goto("results");
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

document.getElementById("btn-dispute").addEventListener("click", async () => {
  if (!lastResult) return;
  const patch = { disputed: true, status: "Needs Review" };
  await updateInspection(lastResult.id, patch);
  showSavedResult({ ...lastResult, ...patch });
  alert("Dispute recorded. This inspection is now flagged for manual officer review.");
});

document.getElementById("btn-export-pdf").addEventListener("click", () => {
  if (!lastResult) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const i = lastResult;
  let y = 16;
  doc.setFontSize(16); doc.text("LegalScan AI — Compliance Report", 14, y); y += 8;
  doc.setFontSize(10); doc.setTextColor(100);
  doc.text(`${i.code}  |  ${new Date(i.date).toLocaleString()}`, 14, y); y += 10;

  doc.setTextColor(0); doc.setFontSize(12);
  doc.text(`Status: ${i.status}    Score: ${i.score}/100`, 14, y); y += 8;
  doc.setFontSize(10);
  doc.text(`Category: ${i.category || "-"}   Location: ${i.location || "-"}`, 14, y); y += 6;
  doc.text(`Brand: ${i.brand || "-"}   Batch/Lot: ${i.batch || "-"}`, 14, y); y += 10;

  doc.setFontSize(12); doc.text("Field-by-field findings:", 14, y); y += 7;
  doc.setFontSize(10);
  Object.values(i.fieldResults).forEach(f => {
    const line = `${f.found ? "[OK]" : "[MISSING]"} ${f.label}: ${f.found ? f.value : "not detected"}`;
    const wrapped = doc.splitTextToSize(line, 180);
    doc.text(wrapped, 14, y); y += 6 * wrapped.length;
    if (y > 270) { doc.addPage(); y = 16; }
  });

  y += 4;
  doc.setFontSize(9); doc.setTextColor(120);
  doc.text("Generated locally by LegalScan AI prototype. Not an official regulatory determination.", 14, y);

  doc.save(`${i.code}-report.pdf`);
});

// Editable-format exports (the problem statement asks for PDF + editable formats)
document.getElementById("btn-export-csv").addEventListener("click", () => {
  if (!lastResult) return;
  const i = lastResult;
  let csv = "Field,Detected,Value,Confidence(%),Severity\n";
  Object.values(i.fieldResults).forEach(f => {
    const val = (f.found ? f.value : "").replace(/"/g, '""');
    csv += `"${f.label}","${f.found ? "Yes" : "No"}","${val}","${f.confidence ?? ""}","${f.severity}"\n`;
  });
  downloadBlob(csv, `${i.code}-report.csv`, "text/csv");
});
document.getElementById("btn-export-json").addEventListener("click", () => {
  if (!lastResult) return;
  downloadBlob(JSON.stringify(lastResult, null, 2), `${lastResult.code}-report.json`, "application/json");
});
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Consumer: report a suspected violation (no backend yet, so this opens a
// pre-filled email to the configured authority inbox with the evidence attached info)
document.getElementById("btn-report-violation").addEventListener("click", () => {
  if (!lastResult) return;
  const i = lastResult;
  const subject = encodeURIComponent(`Suspected Legal Metrology violation — ${i.code}`);
  const body = encodeURIComponent(
    `Product category: ${i.category || "-"}\nBrand: ${i.brand || "-"}\nLocation: ${i.location || "-"}\n` +
    `Status: ${i.status} (score ${i.score}/100)\nDate scanned: ${new Date(i.date).toLocaleString()}\n\n` +
    `Findings:\n` + Object.values(i.fieldResults).map(f => `- ${f.label}: ${f.found ? f.value : "MISSING"}`).join("\n") +
    `\n\n(Attach the scanned image(s) from the app's Inspection History before sending.)`
  );
  window.location.href = `mailto:consumerhelpline@nic.in?subject=${subject}&body=${body}`;
});

/* ---------------- Analytics ---------------- */

let chartStatus, chartCategory;
function renderAnalytics() {
  const all = getInspections();
  const statusCounts = { "Compliant": 0, "Needs Review": 0, "Non-Compliant": 0 };
  const catCounts = {};
  all.forEach(i => {
    statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
    const c = i.category || "Uncategorized";
    catCounts[c] = (catCounts[c] || 0) + 1;
  });

  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart(document.getElementById("chart-status"), {
    type: "doughnut",
    data: {
      labels: Object.keys(statusCounts),
      datasets: [{ data: Object.values(statusCounts), backgroundColor: ["#16a34a", "#c2790a", "#dc2626"] }]
    },
    options: { plugins: { legend: { position: "bottom" } } }
  });

  if (chartCategory) chartCategory.destroy();
  chartCategory = new Chart(document.getElementById("chart-category"), {
    type: "bar",
    data: {
      labels: Object.keys(catCounts),
      datasets: [{ data: Object.values(catCounts), backgroundColor: "#1a56db" }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

/* ---------------- Rules screen ---------------- */

function renderRulesScreen() {
  const tbody = document.querySelector("#rules-table tbody");
  tbody.innerHTML = "";
  RULES.requiredFields.forEach(f => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${f.label}</td><td><span class="badge ${f.severity === "critical" ? "noncompliant" : "review"}">${f.severity}</span></td><td class="muted small">${f.hint}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("rule-min-conf").value = RULES.minOcrConfidence;
  document.getElementById("rule-min-font").value = RULES.minFontProminenceRatio;
}

document.getElementById("btn-save-rules").addEventListener("click", () => {
  RULES.minOcrConfidence = +document.getElementById("rule-min-conf").value;
  RULES.minFontProminenceRatio = +document.getElementById("rule-min-font").value;
  saveRules(RULES);
  alert("Thresholds saved. New rules apply to the next inspection you run.");
});
document.getElementById("btn-reset-rules").addEventListener("click", async () => {
  RULES = await resetRules();
  renderRulesScreen();
});

/* ---------------- Init ---------------- */

(async function init() {
  RULES = await loadRules();
  populateOcrLanguageOptions();
  if (!auth) showLogin(); // Firebase not configured — the banner above explains why
  // When Firebase IS configured, onAuthStateChanged (registered above) drives
  // showLogin()/showApp() — including silently resuming a previous session —
  // so there's nothing else to do here.
})();

function populateOcrLanguageOptions() {
  const sel = document.getElementById("meta-ocr-lang");
  if (!sel || !RULES.ocrLanguageOptions) return;
  sel.innerHTML = RULES.ocrLanguageOptions.map(o => `<option value="${o.code}">${o.label}</option>`).join("");
  sel.value = RULES.defaultOcrLanguage || "eng+hin";
}
