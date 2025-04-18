// Initialize Socket.IO
const socket = io();

// Game canvas setup
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Game state
let gameState = {
    players: {},
    currentPlayer: null
};

// Login form handling
const loginForm = document.getElementById('login-form');
const loginSection = document.getElementById('login-section');
const gameSection = document.getElementById('game-section');
const playerName = document.getElementById('player-name');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        });

        if (response.ok) {
            const data = await response.json();
            startGame(data.username);
        } else {
            alert('Login failed. Please try again.');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please try again.');
    }
});

function startGame(username) {
    loginSection.classList.add('hidden');
    gameSection.classList.remove('hidden');
    playerName.textContent = username;
    gameState.currentPlayer = username;
    
    // Join game room
    socket.emit('join_game', { username });
}

// Socket event handlers
socket.on('player_joined', (data) => {
    console.log(`${data.username} joined the game`);
    gameState.players[data.username] = data.position;
    updateGame();
});

socket.on('player_left', (data) => {
    console.log(`${data.username} left the game`);
    delete gameState.players[data.username];
    updateGame();
});

socket.on('game_state', (state) => {
    gameState.players = state.players;
    updateGame();
});

// Game loop
function updateGame() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw all players
    Object.entries(gameState.players).forEach(([username, position]) => {
        drawPlayer(position.x, position.y, username === gameState.currentPlayer);
    });
}

function drawPlayer(x, y, isCurrentPlayer) {
    ctx.fillStyle = isCurrentPlayer ? '#4CAF50' : '#ff4444';
    ctx.fillRect(x, y, 50, 50);
}

// Handle window resize
function resizeCanvas() {
    canvas.width = gameSection.clientWidth;
    canvas.height = gameSection.clientHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); 