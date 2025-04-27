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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();
        
        if (response.ok) {
            // Store token in local storage
            localStorage.setItem('username', data.username);
            
            // If this was a registration, now log in automatically
            if (!isLoginForm) {
                const loginResponse = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });
                
                if (loginResponse.ok) {
                    socket.emit('user_login', { username });
                    window.location.href = '/lobby';
                } else {
                    alert('Registration successful. Please log in now.');
                    isLoginForm = true;
                    submitButton.textContent = 'Login';
                    toggleLink.textContent = 'Register here';
                    document.querySelector('h2').textContent = 'Login to Play';
                }
            } else {
                socket.emit('user_login', { username });
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
    if (playerCountElem) {
        playerCountElem.textContent = `${data.players.length}/${gameState.max_players || 4}`;
    }
    if (playersListElem) {
        playersListElem.innerHTML = data.players.map(player =>
            `<li class="${player === currentUsername ? 'current-player' : ''}">${player}${player === currentUsername ? ' (You)' : ''}</li>`
        ).join('');
    }
    updateGame();
});

socket.on('game_state', (state) => {
    gameState.players = state.players;
    updateGame();
});

// ← ADD: handle game over from server
socket.on('game_over', (data) => {
    const { winner, finalScores } = data;
    const msg = `🎉 ${winner} wins!\n` +
        Object.entries(finalScores)
              .map(([u, s]) => `${u}: ${s}`)
              .join('\n');
    alert(msg);
    // optionally disable further input or show an overlay here
});

// Game loop
function updateGame() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw all players + their scores
    Object.entries(gameState.players).forEach(([username, position]) => {
        drawPlayer(position.x, position.y, username === gameState.currentPlayer);
        
        // ← ADD: live score display
        ctx.font = '16px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText(
            `${username}: ${position.score}`, 
            position.x, 
            position.y - 10
        );
    });
}

function drawPlayer(x, y, isCurrentPlayer) {
    ctx.fillStyle = isCurrentPlayer ? '#4CAF50' : '#ff4444';
    ctx.fillRect(x, y, 50, 50);
}

// ← ADD: emit attack event on "Z" keypress
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyZ') {
        const me = gameState.players[currentUsername];
        if (!me) return;
        Object.entries(gameState.players).forEach(([user, p]) => {
            if (
                user !== currentUsername &&
                Math.hypot(p.x - me.x, p.y - me.y) < 60
            ) {
                socket.emit('player_attack', {
                    room_id: roomId,
                    username: currentUsername,
                    target: user
                });
            }
        });
    }
});

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
    const username = localStorage.getItem('username');
    
    if (username && window.location.pathname === '/') {
        window.location.href = '/lobby';
    }
});

// --- BEGIN GAME ROOM LOGIC ---
if (window.location.pathname.includes('/join-room/')) {
    // Get roomId from URL
    const roomId = window.location.pathname.split('/').pop();
    const currentUsername = localStorage.getItem('username');
    const playerCountElem = document.getElementById('player-count');
    const playersListElem = document.getElementById('players');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    // Set fixed canvas size
    canvas.width = 800;
    canvas.height = 600;
    // Robust game state (single source of truth)
    let gameState = { players: {} };
    // Only emit join_room after socket is connected
    socket.on('connect', () => {
        socket.emit('join_room', {
            room_id: roomId,
            username: currentUsername
        });
    });
    // Handle game state updates
    socket.on('game_state', (state) => {
        console.log('Received game_state:', state);
        gameState.players = state.players;
        // Update player count and list
        if (playerCountElem) {
            playerCountElem.textContent = `${state.player_count || Object.keys(state.players).length}/${state.max_players || 4}`;
        }
        if (playersListElem) {
            playersListElem.innerHTML = Object.keys(state.players).map(player => 
                `<li class="${player === currentUsername ? 'current-player' : ''}">${player}${player === currentUsername ? ' (You)' : ''}</li>`
            ).join('');
        }
        updateGame();
    });
    // Update player count/list on player_left
    socket.on('player_left', (data) => {
        if (playerCountElem) {
            playerCountElem.textContent = `${data.players.length}/${gameState.max_players || 4}`;
        }
        if (playersListElem) {
            playersListElem.innerHTML = data.players.map(player =>
                `<li class="${player === currentUsername ? 'current-player' : ''}">${player}${player === currentUsername ? ' (You)' : ''}</li>`
            ).join('');
        }
        updateGame();
    });
    // Input handling
    const keys = {};
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if(e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => keys[e.code] = false);
    function handleInput() {
        if (!gameState.players[currentUsername]) return;
        const player = gameState.players[currentUsername];
        let moved = false;
        if (keys['ArrowLeft'] && player.x > 25) {
            player.x -= 5;
            moved = true;
        }
        if (keys['ArrowRight'] && player.x < canvas.width - 25) {
            player.x += 5;
            moved = true;
        }
        if (keys['Space'] && player.y >= canvas.height - 100) {
            player.y -= 200;
            moved = true;
        }
        if (moved) {
            socket.emit('player_move', {
                room_id: roomId,
                username: currentUsername,
                position: {
                    x: player.x,
                    y: player.y,
                    score: player.score || 0
                }
            });
        }
    }
    // Apply gravity
    setInterval(() => {
        if (gameState.players[currentUsername]) {
            const player = gameState.players[currentUsername];
            if (player.y < canvas.height - 100) {
                player.y = Math.min(player.y + 5, canvas.height - 100);
                socket.emit('player_move', {
                    room_id: roomId,
                    username: currentUsername,
                    position: {
                        x: player.x,
                        y: player.y,
                        score: player.score || 0
                    }
                });
            }
        }
    }, 20);
    // Draw all players
    function updateGame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#666';
        ctx.fillRect(0, canvas.height - 50, canvas.width, 50);
        Object.entries(gameState.players).forEach(([username, player]) => {
            ctx.fillStyle = username === currentUsername ? '#4CAF50' : '#f44336';
            ctx.beginPath();
            ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${username} (${player.score || 0})`, player.x, player.y - 35);
        });
    }
    // Game loop
    function gameLoop() {
        handleInput();
        updateGame();
        requestAnimationFrame(gameLoop);
    }
    gameLoop();
    // Leave room button
    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', () => {
            leaveRoomBtn.disabled = true;
            console.log('Emitting leave_room...');
            socket.emit('leave_room', {
                room_id: roomId,
                username: currentUsername
            });
            socket.once('left_room', () => {
                console.log('Received left_room confirmation');
                window.location.href = '/lobby';
            });
        });
    }
}
// --- END GAME ROOM LOGIC ---
