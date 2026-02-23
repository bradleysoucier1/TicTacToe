import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-analytics.js";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBYyVqEc9DaeEXUVl0DbcmMsZbUs4UrEYU",
  authDomain: "tictactoe-2ba87.firebaseapp.com",
  projectId: "tictactoe-2ba87",
  storageBucket: "tictactoe-2ba87.firebasestorage.app",
  messagingSenderId: "232580324076",
  appId: "1:232580324076:web:26ae4d21e59f8bf6f023c9",
  measurementId: "G-BCV7QTGHTL",
};

const app = initializeApp(firebaseConfig);
getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

const ui = {
  googleLogin: document.getElementById("google-login"),
  anonLogin: document.getElementById("anon-login"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  emailSignup: document.getElementById("email-signup"),
  emailLogin: document.getElementById("email-login"),
  userInfo: document.getElementById("user-info"),
  logout: document.getElementById("logout"),
  gameControls: document.getElementById("game-controls"),
  newGame: document.getElementById("new-game"),
  currentLink: document.getElementById("current-link"),
  gameCard: document.getElementById("game-card"),
  gameTitle: document.getElementById("game-title"),
  status: document.getElementById("status"),
  board: document.getElementById("board"),
  message: document.getElementById("message"),
  resetGame: document.getElementById("reset-game"),
};

const winningLines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

let currentUser = null;
let currentGameId = null;
let unsubscribeGame = null;
let gameState = null;

function notify(message, isError = false) {
  ui.message.textContent = message;
  ui.message.style.color = isError ? "#f87171" : "#86efac";
}

function readHashGameId() {
  const rawHash = window.location.hash || "";
  const normalized = rawHash.replace(/^#\/?/, "");
  if (!normalized) return null;

  const [route, ...rest] = normalized.split("/");
  if (route !== "game") return null;

  const rawId = rest.join("/").trim();
  if (!rawId) return null;

  const noBrackets = rawId.replace(/^\[/, "").replace(/\]$/, "");
  const decoded = decodeURIComponent(noBrackets);
  return decoded || null;
}

function setHashGameId(gameId) {
  window.location.hash = `#game/${gameId}`;
}

function newEmptyGame(uid) {
  return {
    board: Array(9).fill(""),
    turn: "X",
    players: { X: uid, O: null },
    status: "waiting",
    winner: null,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function gameResult(board) {
  for (const [a, b, c] of winningLines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return { winner: board[a], status: "won" };
    }
  }
  return board.every(Boolean)
    ? { winner: null, status: "draw" }
    : { winner: null, status: "active" };
}

function mySymbol(game) {
  if (!currentUser || !game?.players) return null;
  if (game.players.X === currentUser.uid) return "X";
  if (game.players.O === currentUser.uid) return "O";
  return null;
}

async function claimSeat(gameId) {
  if (!currentUser) return;
  const gameRef = doc(db, "games", gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return;
    const game = snap.data();
    const players = game.players || { X: null, O: null };
    if (players.X === currentUser.uid || players.O === currentUser.uid) return;

    if (!players.X) players.X = currentUser.uid;
    else if (!players.O) players.O = currentUser.uid;
    else return;

    const status = players.X && players.O ? "active" : "waiting";
    tx.update(gameRef, { players, status, updatedAt: serverTimestamp() });
  });
}

function renderBoard() {
  ui.board.innerHTML = "";
  const board = gameState?.board || Array(9).fill("");
  const mine = mySymbol(gameState);
  const isMyTurn = mine && gameState?.turn === mine;
  const gameLive = gameState?.status === "active";

  board.forEach((cell, index) => {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.textContent = cell;
    btn.disabled = !!cell || !isMyTurn || !gameLive;
    btn.addEventListener("click", () => makeMove(index));
    ui.board.appendChild(btn);
  });
}

function renderGame() {
  if (!gameState || !currentGameId) {
    ui.gameTitle.textContent = "No game selected";
    ui.status.textContent = "Create a new game or open /#game/[game-id].";
    ui.resetGame.classList.add("hidden");
    renderBoard();
    return;
  }

  const mine = mySymbol(gameState);
  const link = `${window.location.origin}${window.location.pathname}#game/${currentGameId}`;
  ui.currentLink.textContent = `Share this game: ${link}`;
  ui.gameTitle.textContent = `Game ${currentGameId}`;

  const xPlayer = gameState.players?.X ? "taken" : "open";
  const oPlayer = gameState.players?.O ? "taken" : "open";

  if (gameState.status === "won") {
    ui.status.textContent = `Winner: ${gameState.winner}. You are ${mine || "spectator"}.`;
  } else if (gameState.status === "draw") {
    ui.status.textContent = `Draw game. You are ${mine || "spectator"}.`;
  } else if (gameState.status === "waiting") {
    ui.status.textContent = `Waiting for players (X: ${xPlayer}, O: ${oPlayer}). You are ${mine || "spectator"}.`;
  } else {
    ui.status.textContent = `Turn: ${gameState.turn}. You are ${mine || "spectator"}.`;
  }

  ui.resetGame.classList.toggle("hidden", !mine);
  renderBoard();
}

async function openGame(gameId) {
  if (unsubscribeGame) unsubscribeGame();
  currentGameId = gameId;
  gameState = null;
  ui.gameCard.classList.remove("hidden");

  if (!gameId) {
    renderGame();
    return;
  }

  const gameRef = doc(db, "games", gameId);
  const snap = await getDoc(gameRef);

  if (!snap.exists()) {
    notify("Game not found.", true);
    renderGame();
    return;
  }

  await claimSeat(gameId);

  unsubscribeGame = onSnapshot(gameRef, async (docSnap) => {
    if (!docSnap.exists()) {
      notify("Game deleted.", true);
      gameState = null;
      renderGame();
      return;
    }
    gameState = docSnap.data();
    renderGame();

    if (currentUser) {
      try {
        await claimSeat(gameId);
      } catch {
        // Ignore seat race conflicts.
      }
    }
  });
}

async function createGame() {
  if (!currentUser) return;
  const gameRef = doc(collection(db, "games"));
  await setDoc(gameRef, newEmptyGame(currentUser.uid));
  setHashGameId(gameRef.id);
  notify("New game created.");
}

async function makeMove(index) {
  if (!currentGameId || !currentUser) return;
  const gameRef = doc(db, "games", currentGameId);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(gameRef);
      if (!snap.exists()) throw new Error("Missing game.");

      const game = snap.data();
      const mine =
        game.players?.X === currentUser.uid
          ? "X"
          : game.players?.O === currentUser.uid
            ? "O"
            : null;

      if (!mine) throw new Error("Join as a player before moving.");
      if (game.status !== "active") throw new Error("Game is not active.");
      if (game.turn !== mine) throw new Error("It is not your turn.");
      if (game.board[index]) throw new Error("Cell already used.");

      const board = [...game.board];
      board[index] = mine;
      const result = gameResult(board);
      const turn = mine === "X" ? "O" : "X";

      tx.update(gameRef, {
        board,
        turn,
        status: result.status,
        winner: result.winner,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    notify(error.message || "Move failed.", true);
  }
}

async function resetGame() {
  if (!currentGameId || !currentUser) return;
  const mine = mySymbol(gameState);
  if (!mine) return;
  const gameRef = doc(db, "games", currentGameId);
  await updateDoc(gameRef, {
    board: Array(9).fill(""),
    turn: "X",
    status: gameState.players?.X && gameState.players?.O ? "active" : "waiting",
    winner: null,
    updatedAt: serverTimestamp(),
  });
}

async function handleEmail(action) {
  const email = ui.email.value.trim();
  const password = ui.password.value;
  if (!email || !password) {
    notify("Email and password are required.", true);
    return;
  }
  try {
    if (action === "signup") {
      await createUserWithEmailAndPassword(auth, email, password);
      notify("Account created.");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      notify("Logged in.");
    }
  } catch (error) {
    notify(error.message || "Email auth failed.", true);
  }
}

ui.googleLogin.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    notify("Google sign-in successful.");
  } catch (error) {
    notify(error.message || "Google sign-in failed.", true);
  }
});

ui.anonLogin.addEventListener("click", async () => {
  try {
    await signInAnonymously(auth);
    notify("Signed in anonymously.");
  } catch (error) {
    notify(error.message || "Anonymous sign-in failed.", true);
  }
});

ui.emailSignup.addEventListener("click", () => handleEmail("signup"));
ui.emailLogin.addEventListener("click", () => handleEmail("login"));
ui.logout.addEventListener("click", () => signOut(auth));
ui.newGame.addEventListener("click", createGame);
ui.resetGame.addEventListener("click", async () => {
  try {
    await resetGame();
    notify("Game reset.");
  } catch (error) {
    notify(error.message || "Reset failed.", true);
  }
});

window.addEventListener("hashchange", () => openGame(readHashGameId()));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    ui.userInfo.classList.remove("hidden");
    ui.userInfo.textContent = `Logged in as ${user.isAnonymous ? "Anonymous" : user.email || user.uid}`;
    ui.logout.classList.remove("hidden");
    ui.gameControls.classList.remove("hidden");
    ui.gameCard.classList.remove("hidden");

    const hashGameId = readHashGameId();
    if (hashGameId) await openGame(hashGameId);
    else renderGame();
  } else {
    if (unsubscribeGame) unsubscribeGame();
    unsubscribeGame = null;
    gameState = null;
    currentGameId = null;

    ui.userInfo.classList.add("hidden");
    ui.logout.classList.add("hidden");
    ui.gameControls.classList.add("hidden");
    ui.currentLink.textContent = "";

    renderGame();
  }
});
