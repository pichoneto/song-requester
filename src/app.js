import { renderQrCode } from "./qr.js";

const SONGS_URL = "data/songs.json";
const LOCAL_LAST_REQUEST_KEY = "karaoke.lastRequestAt.fallback.v1";
const COOLDOWN_MS = 10 * 60 * 1000;

const firebaseConfig = {
  apiKey: "AIzaSyDQxvYhDtBNG0EFe7nTmVrNCDDBk7DECY4",
  authDomain: "karaoke-4b044.firebaseapp.com",
  projectId: "karaoke-4b044",
  storageBucket: "karaoke-4b044.firebasestorage.app",
  messagingSenderId: "35545257063",
  appId: "1:35545257063:web:fb31cc9ea7c757aed930c2",
};

let auth = null;
let db = null;
let firebase = null;
let firebaseReady = false;
let firebaseErrorMessage = "";

const state = {
  songs: [],
  filteredSongs: [],
  requests: [],
  selectedSong: null,
  user: null,
  userProfile: null,
  isAdmin: false,
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: {
    catalog: document.querySelector("#catalogView"),
    queue: document.querySelector("#queueView"),
    admin: document.querySelector("#adminView"),
  },
  songList: document.querySelector("#songList"),
  currentSong: document.querySelector("#currentSong"),
  queueList: document.querySelector("#queueList"),
  completedList: document.querySelector("#completedList"),
  queueCount: document.querySelector("#queueCount"),
  emptyCurrent: document.querySelector("#emptyCurrent"),
  emptyQueue: document.querySelector("#emptyQueue"),
  emptyCompleted: document.querySelector("#emptyCompleted"),
  catalogMeta: document.querySelector("#catalogMeta"),
  searchInput: document.querySelector("#searchInput"),
  cooldownNotice: document.querySelector("#cooldownNotice"),
  dialog: document.querySelector("#requestDialog"),
  modalSongTitle: document.querySelector("#modalSongTitle"),
  modalSongArtist: document.querySelector("#modalSongArtist"),
  requesterInput: document.querySelector("#requesterInput"),
  modalError: document.querySelector("#modalError"),
  confirmRequestButton: document.querySelector("#confirmRequestButton"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminEmail: document.querySelector("#adminEmail"),
  adminPassword: document.querySelector("#adminPassword"),
  adminStatus: document.querySelector("#adminStatus"),
  adminControls: document.querySelector("#adminControls"),
  queueAdminControls: document.querySelector("#queueAdminControls"),
  adminError: document.querySelector("#adminError"),
  nextSongButton: document.querySelector("#nextSongButton"),
  adminLogoutButton: document.querySelector("#adminLogoutButton"),
  pageUrl: document.querySelector("#pageUrl"),
  qrCanvas: document.querySelector("#qrCanvas"),
};

function normalize(text) {
  return text
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function queueTimestamp(item) {
  if (item.createdAt?.toMillis) {
    return item.createdAt.toMillis();
  }
  if (item.startedAt?.toMillis) {
    return item.startedAt.toMillis();
  }
  if (item.completedAt?.toMillis) {
    return item.completedAt.toMillis();
  }
  return Number(item.createdAtMs || item.startedAtMs || item.completedAtMs || 0);
}

function remainingCooldown() {
  if (state.isAdmin) {
    return 0;
  }

  const lastRequestAt = state.userProfile?.lastRequestAt;
  const lastRequestMs = lastRequestAt?.toMillis ? lastRequestAt.toMillis() : Number(localStorage.getItem(LOCAL_LAST_REQUEST_KEY) || 0);
  return Math.max(0, COOLDOWN_MS - (Date.now() - lastRequestMs));
}

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatQueueTime(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
  return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function updateCooldownNotice() {
  const remaining = remainingCooldown();
  if (!remaining) {
    els.cooldownNotice.hidden = true;
    return;
  }

  els.cooldownNotice.hidden = false;
  els.cooldownNotice.textContent = `Ya hay una solicitud reciente desde este dispositivo. Nueva solicitud disponible en ${formatRemaining(remaining)}.`;
}

function setView(view) {
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  Object.entries(els.views).forEach(([name, element]) => {
    element.classList.toggle("is-active", name === view);
  });
}

function renderSongs() {
  const fragment = document.createDocumentFragment();

  state.filteredSongs.forEach((song) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song-card";
    button.dataset.songId = song.id;
    button.innerHTML = `
      <span class="song-title"></span>
      <span class="song-artist"></span>
    `;
    button.querySelector(".song-title").textContent = song.title;
    button.querySelector(".song-artist").textContent = song.artist;
    fragment.append(button);
  });

  els.songList.replaceChildren(fragment);
  els.catalogMeta.textContent = `${state.filteredSongs.length} disponibles`;
}

function splitQueue() {
  return {
    current: state.requests.find((item) => item.status === "current") || null,
    queued: state.requests.filter((item) => !item.status || item.status === "queued").sort((a, b) => queueTimestamp(a) - queueTimestamp(b)),
    completed: state.requests.filter((item) => item.status === "completed").sort((a, b) => queueTimestamp(b) - queueTimestamp(a)),
  };
}

function requestMeta(item) {
  return `${item.requesterName || "Sin nombre"} · ${formatQueueTime(item.createdAt || item.createdAtMs)}`;
}

function adminButtons(item) {
  if (!state.isAdmin) {
    return "";
  }

  const playNowButton = item.status === "queued" || !item.status
    ? `<button type="button" data-action="play-now" data-id="${item.id}">Poner ahora</button>`
    : "";

  return `
    <div class="item-actions">
      ${playNowButton}
      <button type="button" data-action="delete" data-id="${item.id}">Eliminar</button>
    </div>
  `;
}

function queueItemTemplate(item) {
  return `
    <div class="queue-song">
      <strong></strong>
      <span></span>
    </div>
    <div class="queue-meta"></div>
    ${adminButtons(item)}
  `;
}

function hydrateQueueItem(row, item) {
  row.querySelector("strong").textContent = item.title;
  row.querySelector(".queue-song span").textContent = item.artist;
  row.querySelector(".queue-meta").textContent = requestMeta(item);
}

function renderCurrent(current) {
  els.currentSong.replaceChildren();
  els.emptyCurrent.hidden = Boolean(current);

  if (!current) {
    return;
  }

  const card = document.createElement("article");
  card.className = "current-card";
  card.innerHTML = `
    <div>
      <p class="eyebrow">Sonando ahora</p>
      <h3></h3>
      <p></p>
    </div>
    ${adminButtons(current)}
    <div class="progress-track"><div class="progress-bar"></div></div>
  `;
  card.querySelector("h3").textContent = current.title;
  card.querySelector("p:not(.eyebrow)").textContent = `${current.artist} · ${current.requesterName || "Sin nombre"}`;
  els.currentSong.append(card);
}

function renderList(container, items) {
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const row = document.createElement("li");
    row.className = "queue-item";
    row.innerHTML = queueItemTemplate(item);
    hydrateQueueItem(row, item);
    fragment.append(row);
  });
  container.replaceChildren(fragment);
}

function renderQueue() {
  const { current, queued, completed } = splitQueue();
  renderCurrent(current);
  renderList(els.queueList, queued);
  renderList(els.completedList, completed);

  els.queueCount.textContent = queued.length + (current ? 1 : 0);
  els.emptyQueue.hidden = queued.length > 0;
  els.emptyCompleted.hidden = completed.length > 0;
}

function renderAdmin() {
  const hasEmailSession = Boolean(state.user?.email);
  els.adminLoginForm.hidden = hasEmailSession;
  els.adminControls.hidden = !hasEmailSession;
  els.queueAdminControls.hidden = !state.isAdmin;
  if (state.isAdmin) {
    els.adminStatus.textContent = `Sesión iniciada como ${state.user?.email || "admin"}.`;
  } else if (state.user?.email) {
    els.adminStatus.textContent = "Ese usuario existe, pero no está autorizado como administrador.";
  } else {
    els.adminStatus.textContent = "Inicia sesión para gestionar la cola.";
  }
  els.adminError.hidden = true;
  els.adminError.textContent = "";
}

function openRequestDialog(song) {
  if (!state.user) {
    els.cooldownNotice.hidden = false;
    els.cooldownNotice.textContent = firebaseErrorMessage || "Conectando con Firebase. Prueba de nuevo en unos segundos.";
    return;
  }

  const remaining = remainingCooldown();
  if (remaining) {
    updateCooldownNotice();
    return;
  }

  state.selectedSong = song;
  els.modalSongTitle.textContent = song.title;
  els.modalSongArtist.textContent = song.artist;
  els.requesterInput.value = state.isAdmin ? "Admin" : state.userProfile?.displayName || "";
  els.modalError.hidden = true;
  els.modalError.textContent = "";
  els.confirmRequestButton.disabled = false;
  els.confirmRequestButton.textContent = "Añadir a la cola";
  els.dialog.showModal();
  els.requesterInput.focus();
}

async function addRequest() {
  const requesterName = els.requesterInput.value.trim();
  if (!requesterName || !state.selectedSong || !state.user || !firebaseReady) {
    return false;
  }

  await runFirebaseStep("crear la solicitud en requests", () =>
    firebase.addDoc(firebase.collection(db, "requests"), {
      songId: state.selectedSong.id,
      title: state.selectedSong.title,
      artist: state.selectedSong.artist,
      requesterName,
      userId: state.user.uid,
      status: "queued",
      createdAtMs: Date.now(),
      createdAt: firebase.serverTimestamp(),
    }),
  );

  if (!state.isAdmin) {
    const lastRequestAt = firebase.Timestamp.now();
    localStorage.setItem(LOCAL_LAST_REQUEST_KEY, String(Date.now()));
    state.userProfile = { ...state.userProfile, displayName: requesterName, lastRequestAt };

    try {
      await runFirebaseStep("actualizar users/{uid}", () =>
        firebase.setDoc(
          firebase.doc(db, "users", state.user.uid),
          {
            displayName: requesterName,
            lastRequestAt,
            updatedAt: firebase.serverTimestamp(),
          },
          { merge: true },
        ),
      );
    } catch (error) {
      console.warn("No se pudo actualizar users/{uid}; se usara cooldown local.", error);
    }
  }

  updateCooldownNotice();
  setView("queue");
  return true;
}

async function deleteRequest(id) {
  await runFirebaseStep("eliminar una solicitud", () => firebase.deleteDoc(firebase.doc(db, "requests", id)));
}

async function passToNextSong() {
  const { current, queued } = splitQueue();
  const batch = firebase.writeBatch(db);
  const nowMs = Date.now();

  if (current) {
    batch.update(firebase.doc(db, "requests", current.id), {
      status: "completed",
      completedAt: firebase.serverTimestamp(),
      completedAtMs: nowMs,
    });
  }

  if (queued[0]) {
    batch.update(firebase.doc(db, "requests", queued[0].id), {
      status: "current",
      startedAt: firebase.serverTimestamp(),
      startedAtMs: nowMs,
    });
  }

  if (current || queued[0]) {
    await runFirebaseStep("pasar a la siguiente canción", () => batch.commit());
  }
}

async function playRequestNow(id) {
  const { current } = splitQueue();
  const target = state.requests.find((item) => item.id === id);
  if (!target) {
    return;
  }
  if (target.status === "current") {
    return;
  }

  const batch = firebase.writeBatch(db);
  const nowMs = Date.now();

  if (current && current.id !== target.id) {
    batch.update(firebase.doc(db, "requests", current.id), {
      status: "completed",
      completedAt: firebase.serverTimestamp(),
      completedAtMs: nowMs,
    });
  }

  batch.update(firebase.doc(db, "requests", target.id), {
    status: "current",
    startedAt: firebase.serverTimestamp(),
    startedAtMs: nowMs,
  });

  await runFirebaseStep("poner una canción ahora", () => batch.commit());
}

function setupQr() {
  const url = window.location.href.split("#")[0];
  els.pageUrl.textContent = url;
  renderQrCode(els.qrCanvas, url);
}

function bindEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  els.searchInput.addEventListener("input", () => {
    const queryText = normalize(els.searchInput.value.trim());
    state.filteredSongs = queryText ? state.songs.filter((song) => song.search.includes(queryText)) : state.songs;
    renderSongs();
  });

  els.songList.addEventListener("click", (event) => {
    const card = event.target.closest(".song-card");
    if (!card) {
      return;
    }

    const song = state.songs.find((item) => item.id === card.dataset.songId);
    if (song) {
      openRequestDialog(song);
    }
  });

  els.dialog.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "default") {
      return;
    }

    event.preventDefault();
    els.modalError.hidden = true;
    els.confirmRequestButton.disabled = true;
    els.confirmRequestButton.textContent = "Enviando...";

    try {
      if (await addRequest()) {
        state.selectedSong = null;
        els.dialog.close();
      }
    } catch (error) {
      els.modalError.hidden = false;
      els.modalError.textContent = firebaseErrorMessage || readableFirebaseError(error);
      console.error(error);
    } finally {
      els.confirmRequestButton.disabled = false;
      els.confirmRequestButton.textContent = "Añadir a la cola";
    }
  });

  els.adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.adminError.hidden = true;

    try {
      await firebase.signInWithEmailAndPassword(auth, els.adminEmail.value.trim(), els.adminPassword.value);
      els.adminPassword.value = "";
    } catch (error) {
      els.adminError.hidden = false;
      els.adminError.textContent = readableFirebaseError(error);
      console.error(error);
    }
  });

  els.adminLogoutButton.addEventListener("click", async () => {
    state.isAdmin = false;
    renderAdmin();
    renderQueue();
    await firebase.signOut(auth);
    await firebase.signInAnonymously(auth);
  });

  els.nextSongButton.addEventListener("click", async () => {
    if (!state.isAdmin) {
      return;
    }
    try {
      await passToNextSong();
    } catch (error) {
      els.adminError.hidden = false;
      els.adminError.textContent = readableFirebaseError(error);
      console.error(error);
    }
  });

  els.views.queue.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !state.isAdmin) {
      return;
    }

    try {
      if (button.dataset.action === "delete") {
        await deleteRequest(button.dataset.id);
      }
      if (button.dataset.action === "play-now") {
        await playRequestNow(button.dataset.id);
      }
    } catch (error) {
      els.adminError.hidden = false;
      els.adminError.textContent = readableFirebaseError(error);
      console.error(error);
    }
  });
}

function subscribeToQueue() {
  const queueQuery = firebase.query(firebase.collection(db, "requests"), firebase.limit(500));
  firebase.onSnapshot(
    queueQuery,
    (snapshot) => {
      state.requests = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderQueue();
    },
    (error) => {
      error.firebaseStep = "leer la cola en requests";
      els.emptyQueue.hidden = false;
      els.emptyQueue.textContent = readableFirebaseError(error);
      console.error(error);
    },
  );
}

async function checkAdmin(user) {
  if (!user?.email) {
    return false;
  }

  try {
    const adminDoc = await runFirebaseStep("leer admins/{uid}", () => firebase.getDoc(firebase.doc(db, "admins", user.uid)));
    return adminDoc.exists() && adminDoc.data().isAdmin === true;
  } catch (error) {
    console.warn("No se pudo leer admins/{uid}.", error);
    return false;
  }
}

function bootstrapAuth() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let sawInitialState = false;
    firebase.onAuthStateChanged(auth, async (user) => {
      if (!user) {
        state.user = null;
        state.isAdmin = false;
        renderAdmin();
        renderQueue();
        if (!sawInitialState) {
          sawInitialState = true;
          firebase.signInAnonymously(auth).catch(reject);
        }
        return;
      }
      sawInitialState = true;

      try {
        state.user = user;
        state.isAdmin = await checkAdmin(user);

        if (!state.isAdmin) {
          const userRef = firebase.doc(db, "users", user.uid);
          try {
            const currentProfile = await runFirebaseStep("leer users/{uid}", () => firebase.getDoc(userRef));
            state.userProfile = currentProfile.exists() ? currentProfile.data() : {};
            await runFirebaseStep("crear o actualizar users/{uid}", () =>
              firebase.setDoc(
                userRef,
                currentProfile.exists()
                  ? { lastSeenAt: firebase.serverTimestamp() }
                  : { createdAt: firebase.serverTimestamp(), lastSeenAt: firebase.serverTimestamp() },
                { merge: true },
              ),
            );
          } catch (error) {
            state.userProfile = {};
            console.warn("No se pudo leer/escribir users/{uid}; la app continuara con Auth anonimo.", error);
          }
        }

        firebaseReady = true;
        firebaseErrorMessage = "";
        updateCooldownNotice();
        renderAdmin();
        renderQueue();

        if (!resolved) {
          resolved = true;
          resolve(user);
        }
      } catch (error) {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      }
    });

  });
}

async function connectFirebase() {
  const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js"),
  ]);

  const app = initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = firestoreModule.getFirestore(app);
  firebase = { ...authModule, ...firestoreModule };
  await authModule.setPersistence(auth, authModule.browserLocalPersistence);

  await bootstrapAuth();
  subscribeToQueue();
}

async function init() {
  bindEvents();
  renderAdmin();
  renderQueue();
  setupQr();
  updateCooldownNotice();
  setInterval(updateCooldownNotice, 1000);

  const response = await fetch(SONGS_URL);
  const data = await response.json();
  state.songs = data.songs;
  state.filteredSongs = state.songs;
  renderSongs();

  try {
    await connectFirebase();
  } catch (error) {
    firebaseReady = false;
    firebaseErrorMessage = readableFirebaseError(error);
    els.emptyQueue.textContent = firebaseErrorMessage;
    console.error(error);
  }
}

async function runFirebaseStep(step, action) {
  try {
    return await action();
  } catch (error) {
    error.firebaseStep = step;
    throw error;
  }
}

function readableFirebaseError(error) {
  const step = error?.firebaseStep ? ` al ${error.firebaseStep}` : "";

  if (error?.code === "auth/admin-restricted-operation" || error?.code === "auth/operation-not-allowed") {
    return "Firebase no permite esta autenticación todavía. Activa el método de inicio de sesión necesario.";
  }

  if (error?.code === "auth/invalid-credential" || error?.code === "auth/user-not-found" || error?.code === "auth/wrong-password") {
    return "Usuario o contraseña incorrectos.";
  }

  if (error?.code === "permission-denied") {
    return `Firebase está conectado, pero Firestore rechaza la operación${step}. Revisa las reglas de seguridad publicadas.`;
  }

  return `La cola compartida no está conectada${step}. El cancionero sigue disponible.`;
}

init().catch((error) => {
  els.catalogMeta.textContent = "No se pudo cargar el cancionero o conectar Firebase.";
  console.error(error);
});
