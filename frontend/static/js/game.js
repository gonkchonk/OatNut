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

// Login and registration handling
const loginForm = document.getElementById('login-form');
const registerLink = document.getElementById('show-register');
const loginSection = document.getElementById('login-section');
const gameSection = document.getElementById('game-section');
const playerName = document.getElementById('player-name');

// Toggle between login and registration
let isLoginForm = true;
registerLink.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginForm = !isLoginForm;
    
    const submitButton = loginForm.querySelector('button[type="submit"]');
    const toggleLink = document.getElementById('show-register');
    
    if (isLoginForm) {
        submitButton.textContent = 'Login';
        toggleLink.textContent = 'Register here';
        document.querySelector('h2').textContent = 'Login to Play';
    } else {
        submitButton.textContent = 'Register';
        toggleLink.textContent = 'Back to login';
        document.querySelector('h2').textContent = 'Register to Play';
    }
});

// Handle form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        let endpoint = isLoginForm ? '/login' : '/register';
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();
        
        if (response.ok) {
            // Store token in local storage
            localStorage.setItem('gameAuthToken', data.token);
            localStorage.setItem('username', data.username);
            
            // If this was a registration, now log in automatically
            if (!isLoginForm) {
                const loginResponse = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                });
                
                if (loginResponse.ok) {
                    window.location.href = '/lobby';
                } else {
                    console.error('Auto-login after registration failed');
                    alert('Registration successful. Please log in now.');
                    isLoginForm = true;
                    document.querySelector('button[type="submit"]').textContent = 'Login';
                    document.getElementById('show-register').textContent = 'Register here';
                    document.querySelector('h2').textContent = 'Login to Play';
                }
            } else {
                // Normal login flow
                window.location.href = '/lobby';
            }
        } else {
            alert(data.message || 'Authentication failed. Please try again.');
        }
    } catch (error) {
        console.error('Authentication error:', error);
        alert('Authentication failed. Please try again.');
    }
});

// Game functions
function startGame(username) {
    loginSection.classList.add('hidden');
    gameSection.classList.remove('hidden');
    playerName.textContent = username;
    gameState.currentPlayer = username;
    
    // Join game room
    socket.emit('join_game', { username });
}

// Room functions - for lobby page
function createRoom(name, maxPlayers = 4) {
    return fetch('/create-room', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('gameAuthToken')}`
        },
        body: JSON.stringify({ name, max_players: maxPlayers })
    }).then(res => res.json());
}

function joinRoom(roomId) {
    window.location.href = `/join-room/${roomId}`;
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
    if (canvas) {
        canvas.width = gameSection.clientWidth;
        canvas.height = gameSection.clientHeight;
        updateGame();
    }
}

window.addEventListener('resize', resizeCanvas);
// Initialize canvas if we're on the game page
if (canvas) {
    resizeCanvas();
}

// Check if user is already logged in when page loads
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('gameAuthToken');
    const username = localStorage.getItem('username');
    
    if (token && username && window.location.pathname === '/') {
        window.location.href = '/lobby';
    }
}); 