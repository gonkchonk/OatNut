// socket setup
const socket = io();

// sections
const loginSection    = document.getElementById("login-section");
const registerSection = document.getElementById("register-section");
const gameSection     = document.getElementById("game-section");

// forms & fields
const loginForm    = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const playerName   = document.getElementById("player-name");

// canvas
const canvas = document.getElementById("game-canvas");
const ctx    = canvas.getContext("2d");

let gameState = {
  players: {},
  currentPlayer: null
};

// show/hide handlers
document.getElementById("show-register").addEventListener("click", e => {
  e.preventDefault();
  loginSection.classList.add("hidden");
  registerSection.classList.remove("hidden");
});
document.getElementById("show-login").addEventListener("click", e => {
  e.preventDefault();
  registerSection.classList.add("hidden");
  loginSection.classList.remove("hidden");
});

// LOGIN
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    if (res.ok) {
      const data = await res.json();
      startGame(data.username);
    } else {
      const err = await res.json();
      alert("Login failed: " + err.error);
    }
  } catch (err) {
    console.error(err);
    alert("Login error");
  }
});

// REGISTER
registerForm.addEventListener("submit", async e => {
  e.preventDefault();
  const username = document.getElementById("reg-username").value;
  const email    = document.getElementById("reg-email").value;
  const password = document.getElementById("reg-password").value;

  try {
    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password })
    });

    if (res.ok) {
      const data = await res.json();
      startGame(data.username);
    } else {
      const err = await res.json();
      alert("Registration failed: " + err.error);
    }
  } catch (err) {
    console.error(err);
    alert("Registration error");
  }
});

// start game UI
function startGame(username) {
  loginSection.classList.add("hidden");
  registerSection.classList.add("hidden");
  gameSection.classList.remove("hidden");

  playerName.textContent        = username;
  gameState.currentPlayer = username;
  socket.emit("join_game", { username });
}

// socket events (unchanged)
socket.on("player_joined", data => {
  gameState.players[data.username] = data.position;
  updateGame();
});
socket.on("player_left", data => {
  delete gameState.players[data.username];
  updateGame();
});
socket.on("game_state", state => {
  gameState.players = state.players;
  updateGame();
});

// draw loop
function updateGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  Object.entries(gameState.players).forEach(([user, pos]) => {
    drawPlayer(pos.x, pos.y, user === gameState.currentPlayer);
  });
}
function drawPlayer(x, y, isMe) {
  ctx.fillStyle = isMe ? "#4CAF50" : "#ff4444";
  ctx.fillRect(x, y, 50, 50);
}

// handle resize
function resizeCanvas() {
  canvas.width  = gameSection.clientWidth;
  canvas.height = gameSection.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
