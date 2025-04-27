// Initialize Socket.IO
// Note: For game room functionality, we're using the socket initialized in game.html
// Don't create a new socket instance here to avoid duplicate connections
// const socket = io();

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

// Only initialize if login elements exist (we're on the login page)
if (loginForm && registerLink) {
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
        const submitButton = loginForm.querySelector('button[type="submit"]');
        const loginStatus = document.getElementById('login-status');
        
        // Clear previous error message
        if (loginStatus) {
            loginStatus.textContent = '';
        }
        
        // Disable button and show loading state
        submitButton.disabled = true;
        submitButton.textContent = isLoginForm ? 'Logging in...' : 'Registering...';
        
        try {
            let endpoint = isLoginForm ? '/login' : '/register';
            console.log(`Submitting ${isLoginForm ? 'login' : 'registration'} request to ${endpoint}`);
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            console.log(`Received response: ${response.status}`);
            const data = await response.json();
            console.log(`Response data:`, data);
            
            if (response.ok && data.success) {
                // Store username in local storage
                localStorage.setItem('username', data.username);
                
                // Store token in local storage
                if (data.token) {
                    localStorage.setItem('gameAuthToken', data.token);
                }
                
                // Notify the server that a user has logged in (if socket is available)
                if (typeof socket !== 'undefined') {
                    socket.emit('user_login', { username });
                }
                
                // If this was a registration, now log in automatically
                if (!isLoginForm) {
                    console.log('Registration successful, redirecting to lobby');
                    window.location.href = '/lobby';
                } else {
                    console.log('Login successful, redirecting to lobby');
                    window.location.href = '/lobby';
                }
            } else {
                // Reset button state
                submitButton.disabled = false;
                submitButton.textContent = isLoginForm ? 'Login' : 'Register';
                
                // Show error message
                const errorMessage = data.message || `${isLoginForm ? 'Login' : 'Registration'} failed. Please try again.`;
                if (loginStatus) {
                    loginStatus.textContent = errorMessage;
                } else {
                    alert(errorMessage);
                }
                console.error(`${isLoginForm ? 'Login' : 'Registration'} failed:`, data.message);
            }
        } catch (error) {
            // Reset button state
            submitButton.disabled = false;
            submitButton.textContent = isLoginForm ? 'Login' : 'Register';
            
            // Show error message
            const errorMessage = `${isLoginForm ? 'Login' : 'Registration'} failed. Server error, please try again.`;
            if (loginStatus) {
                loginStatus.textContent = errorMessage;
            } else {
                alert(errorMessage);
            }
            
            console.error(`${isLoginForm ? 'Login' : 'Registration'} error:`, error);
        }
    });
}

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
    // Get roomId and username from the script in game.html
    // These variables should be defined in the game.html template:
    // const roomId = "{{ room_id }}";
    // const currentUsername = localStorage.getItem('username');
    
    console.log(`Initializing game in room ${roomId} as player ${currentUsername}`);
    
    const playerCountElem = document.getElementById('player-count');
    const playersListElem = document.getElementById('players');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const scoreDisplayElem = document.getElementById('player-score');
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    
    // Set fixed canvas size
    canvas.width = 800;
    canvas.height = 600;
    
    // Game state
    let gameState = { 
        players: {},
        max_players: 4,
        room_name: 'Game Room'
    };
    
    // Display room name in the header
    document.querySelector('.game-header h2').textContent = gameState.room_name;
    
    // Connect to the socket server
    socket.on('connect', () => {
        console.log('Socket connected, joining room:', roomId);
        
        // Join the room via socket
        socket.emit('join_room', {
            room_id: roomId,
            username: currentUsername
        });
    });
    
    // Handle socket connection error
    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        alert('Connection error, please try again later.');
    });
    
    // Handle game state updates from the server
    socket.on('game_state', (state) => {
        console.log('Received game_state:', state);
        
        // Update our game state
        gameState.players = state.players || {};
        gameState.max_players = state.max_players || 4;
        if (state.room_name) {
            gameState.room_name = state.room_name;
            document.querySelector('.game-header h2').textContent = state.room_name;
        }
        
        // Update player count display
        if (playerCountElem) {
            let playerCount = Object.keys(gameState.players).length;
            playerCountElem.textContent = `${playerCount}/${gameState.max_players}`;
        }
        
        // Update players list
        if (playersListElem) {
            playersListElem.innerHTML = Object.keys(gameState.players).map(player => {
                const score = gameState.players[player].score || 0;
                const isCurrentPlayer = player === currentUsername;
                return `<li class="${isCurrentPlayer ? 'current-player' : ''}">${player} (Score: ${score})${isCurrentPlayer ? ' (You)' : ''}</li>`;
            }).join('');
        }
        
        // Update score display for current player
        if (scoreDisplayElem && gameState.players[currentUsername]) {
            scoreDisplayElem.textContent = gameState.players[currentUsername].score || 0;
        }
        
        // Redraw the game
        updateGame();
    });
    
    // Handle other player joining
    socket.on('player_joined', (data) => {
        console.log('Player joined:', data.username);
        // The full game state will be sent separately via game_state event
    });
    
    // Handle player leaving
    socket.on('player_left', (data) => {
        console.log('Player left:', data.username);
        
        // Remove player from our local game state
        if (gameState.players[data.username]) {
            delete gameState.players[data.username];
        }
        
        // Update the players list
        if (playersListElem) {
            playersListElem.innerHTML = data.players.map(player => {
                const isCurrentPlayer = player === currentUsername;
                const score = gameState.players[player] ? gameState.players[player].score || 0 : 0;
                return `<li class="${isCurrentPlayer ? 'current-player' : ''}">${player} (Score: ${score})${isCurrentPlayer ? ' (You)' : ''}</li>`;
            }).join('');
        }
        
        // Update player count
        if (playerCountElem) {
            playerCountElem.textContent = `${data.players.length}/${gameState.max_players}`;
        }
        
        // Redraw the game
        updateGame();
    });
    
    // Handle game over event
    socket.on('game_over', (data) => {
        const { winner, finalScores } = data;
        let message = `🎉 ${winner} wins! Final scores:\n`;
        
        Object.entries(finalScores).forEach(([player, score]) => {
            message += `${player}: ${score}\n`;
        });
        
        alert(message);
        
        // Disable controls
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
    });
    
    // Handle errors
    socket.on('error', (data) => {
        console.error('Error from server:', data.message);
        alert(`Error: ${data.message}`);
    });
    
    // Input handling
    const keys = {};
    
    function handleKeyDown(e) {
        keys[e.code] = true;
        if (e.code === 'Space') {
            e.preventDefault(); // Prevent space from scrolling the page
        }
    }
    
    function handleKeyUp(e) {
        keys[e.code] = false;
    }
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Process player input
    function handleInput() {
        if (!gameState.players[currentUsername]) {
            return;  // Player not yet in game state
        }
        
        const player = gameState.players[currentUsername];
        let moved = false;
        
        // Move left
        if (keys['ArrowLeft'] && player.x > 25) {
            player.x -= 5;
            moved = true;
        }
        
        // Move right
        if (keys['ArrowRight'] && player.x < canvas.width - 25) {
            player.x += 5;
            moved = true;
        }
        
        // Jump (only if on ground)
        if (keys['Space'] && player.y >= canvas.height - 100) {
            player.y -= 20; // Initial jump velocity
            moved = true;
        }
        
        // Attack with Z key
        if (keys['KeyZ']) {
            // Check if there are players nearby to attack
            let attacked = false;
            
            Object.entries(gameState.players).forEach(([username, otherPlayer]) => {
                if (username !== currentUsername) {
                    // Simple collision detection - if players are close enough
                    const distance = Math.hypot(player.x - otherPlayer.x, player.y - otherPlayer.y);
                    if (distance < 60) { // Within attack range
                        socket.emit('player_attack', {
                            room_id: roomId,
                            username: currentUsername,
                            target: username
                        });
                        attacked = true;
                        
                        // Set a cooldown on the Z key to prevent spam attacks
                        keys['KeyZ'] = false;
                        setTimeout(() => {
                            if (keys['KeyZ']) keys['KeyZ'] = false;
                        }, 500); // Half second cooldown
                    }
                }
            });
            
            // Visual feedback for attack attempt
            if (!attacked) {
                // Flash the attack area
                ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
                ctx.beginPath();
                ctx.arc(player.x, player.y, 60, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        // Send position update to server if moved
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
    const gravityInterval = setInterval(() => {
        if (gameState.players[currentUsername]) {
            const player = gameState.players[currentUsername];
            
            // Apply gravity if not on ground
            if (player.y < canvas.height - 100) {
                player.y = Math.min(player.y + 5, canvas.height - 100);
                
                // Send updated position to server
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
    
    // Clean up interval when leaving page
    window.addEventListener('beforeunload', () => {
        clearInterval(gravityInterval);
    });
    
    // Draw the game
    function updateGame() {
        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw the floor
        ctx.fillStyle = '#666';
        ctx.fillRect(0, canvas.height - 50, canvas.width, 50);
        
        // Draw all players
        Object.entries(gameState.players).forEach(([username, player]) => {
            // Draw player circle
            ctx.fillStyle = username === currentUsername ? '#4CAF50' : '#f44336';
            ctx.beginPath();
            ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw player name and score
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
    
    // Start the game loop
    gameLoop();
    
    // Handle leave room button
    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', () => {
            leaveRoomBtn.disabled = true;
            leaveRoomBtn.textContent = 'Leaving...';
            
            console.log('Leaving room:', roomId);
            socket.emit('leave_room', {
                room_id: roomId,
                username: currentUsername
            });
            
            // Wait for server confirmation before redirecting
            socket.once('left_room', () => {
                console.log('Successfully left room');
                window.location.href = '/lobby';
            });
            
            // Timeout in case server doesn't respond
            setTimeout(() => {
                if (leaveRoomBtn.disabled) {
                    console.log('Leave room timeout, redirecting anyway');
                    window.location.href = '/lobby';
                }
            }, 3000);
        });
    }
}
// --- END GAME ROOM LOGIC ---
