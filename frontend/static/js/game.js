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

// Add health update handler
socket.on('player_health_update', (data) => {
    const { username, health } = data;
    if (gameState.players[username]) {
        gameState.players[username].health = health;
        updateGame();
    }
});

// Add player elimination handler
socket.on('player_eliminated', (data) => {
    const { username } = data;
    console.log('Player eliminated:', username);
    if (gameState.players[username]) {
        // Mark player as eliminated
        gameState.players[username].eliminated = true;
        gameState.players[username].lives = 0;
        
        // Add elimination visual effect
        const player = gameState.players[username];
        const particles = [];
        for (let i = 0; i < 30; i++) {
            particles.push(new RespawnParticle(player.x, player.y));
        }
        respawnEffects.set(username, {
            particles,
            fadeIn: 1,
            startTime: Date.now(),
            isElimination: true
        });
        
        // If this is the current player, disable controls
        if (username === currentUsername) {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        }
        
        updateGame();
    }
});

// Add game over state tracking
let gameOverState = null;

// Update game over handler
socket.on('game_over', (data) => {
    console.log('Game Over:', data);
    
    // Ensure we have valid data
    if (!data || typeof data !== 'object') {
        console.error('Invalid game over data received:', data);
        return;
    }
    
    const winner = data.winner;
    if (!winner) {
        console.error('No winner in game over data:', data);
        return;
    }
    
    // Store game over state
    gameOverState = {
        winner,
        timestamp: Date.now()
    };
    
    console.log('Setting game over state:', gameOverState);
    
    // Disable controls
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    
    // Set timeout to reset game state
    setTimeout(() => {
        console.log('Resetting game state');
        gameOverState = null;
        
        // Reset all players
        Object.values(gameState.players).forEach(player => {
            player.lives = 3;
            player.health = 100;
            player.eliminated = false;
            player.dead = false;
            player.invulnerable = false;
        });
        
        // Re-enable controls
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        
        updateGame();
    }, 5000);
    
    updateGame();
});

// Add DeathParticle class
class DeathParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.angle = Math.random() * Math.PI * 2;
        this.speed = Math.random() * 8 + 4;
        this.radius = Math.random() * 4 + 2;
        this.life = 1.0;
        this.decay = Math.random() * 0.04 + 0.02;
        this.color = `hsl(${Math.random() * 60 + 340}, 100%, 50%)`;
    }

    update() {
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        this.speed *= 0.95;
        this.life -= this.decay;
        return this.life > 0;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color.replace(')', `,${this.life})`).replace('hsl', 'hsla');
        ctx.fill();
    }
}

// Add death effects map
const deathEffects = new Map();

// Update player_died handler
socket.on('player_died', (data) => {
    console.log('Player died:', data);
    const { username, respawn_time, lives_remaining } = data;
    if (gameState.players[username]) {
        const player = gameState.players[username];
        player.dead = true;
        player.respawn_time = respawn_time;
        player.lives = lives_remaining;
        player.waitingForShield = true; // Add flag to track shield waiting state
        
        // Create death effect
        const deathEffect = {
            particles: [],
            startTime: Date.now(),
            duration: 500
        };
        
        // Create particles in a circle around the player
        for (let i = 0; i < 30; i++) {
            const angle = (Math.PI * 2 * i) / 30;
            const distance = 25;
            const particleX = player.x + Math.cos(angle) * distance;
            const particleY = player.y + Math.sin(angle) * distance;
            deathEffect.particles.push(new DeathParticle(particleX, particleY));
        }
        
        deathEffects.set(username, deathEffect);
        
        // Set a timeout to clear death effect but don't show player yet
        setTimeout(() => {
            if (deathEffects.has(username)) {
                deathEffects.delete(username);
                updateGame();
            }
        }, 500);
        
        updateGame();
    }
});

// Update player respawned handler
socket.on('player_respawned', (data) => {
    console.log('Player respawned:', data);
    const { username, invulnerable_until, lives_remaining } = data;
    if (gameState.players[username]) {
        const player = gameState.players[username];
        player.dead = false;
        player.invulnerable = true;
        player.invulnerable_until = invulnerable_until;
        player.lives = lives_remaining;
        
        // Initialize shield effect
        const shieldEffect = {
            particles: [],
            fadeIn: 1,
            startTime: Date.now(),
            isInvulnerable: true
        };
        respawnEffects.set(username, shieldEffect);
        
        // Add initial particles
        for (let i = 0; i < 20; i++) {
            const angle = (Math.PI * 2 * i) / 20;
            const distance = 30;
            const particleX = player.x + Math.cos(angle) * distance;
            const particleY = player.y + Math.sin(angle) * distance;
            const particle = new RespawnParticle(particleX, particleY, 'rgba(100, 200, 255, 1.0)');
            shieldEffect.particles.push(particle);
        }
    }
});

// Update player invulnerable handler
socket.on('player_invulnerable', (data) => {
    const { username, invulnerable_until } = data;
    if (gameState.players[username]) {
        const player = gameState.players[username];
        player.invulnerable = true;
        player.invulnerable_until = invulnerable_until;
        player.dead = false;
        player.waitingForShield = false; // Clear the waiting flag when shield is ready
        
        // Create shield effect
        respawnEffects.delete(username);
        const shieldEffect = {
            particles: [],
            fadeIn: 1,
            startTime: Date.now(),
            isInvulnerable: true
        };
        respawnEffects.set(username, shieldEffect);
        
        // Add shield particles
        for (let i = 0; i < 20; i++) {
            const angle = (Math.PI * 2 * i) / 20;
            const distance = 30;
            const particleX = player.x + Math.cos(angle) * distance;
            const particleY = player.y + Math.sin(angle) * distance;
            const particle = new RespawnParticle(particleX, particleY, 'rgba(100, 200, 255, 1.0)');
            shieldEffect.particles.push(particle);
        }
        
        updateGame();
    }
});

// Add particle system for respawn effect
class RespawnParticle {
    constructor(x, y, color = '#ffffff') {
        this.x = x;
        this.y = y;
        this.radius = Math.random() * 3 + 2;
        this.angle = Math.random() * Math.PI * 2;
        this.speed = Math.random() * 2 + 1;
        this.life = 1.0;
        this.decay = Math.random() * 0.02 + 0.02;
        this.color = color;
    }

    update() {
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        this.life -= this.decay;
        return this.life > 0;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color.replace(')', `,${this.life})`).replace('rgb', 'rgba');
        ctx.fill();
    }
}

// Add respawn effect system
const respawnEffects = new Map(); // Map of username to their respawn effect

// Game loop
function updateGame() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw the floor
    ctx.fillStyle = '#666';
    ctx.fillRect(0, 0, canvas.width, canvas.height - 50);
    
    // Draw all players
    Object.entries(gameState.players).forEach(([username, player]) => {
        ctx.save();
        
        const currentTime = Date.now() / 1000;
        
        // Check if invulnerability has ended
        if (player.invulnerable && currentTime >= player.invulnerable_until) {
            player.invulnerable = false;
            respawnEffects.delete(username);
        }
        
        // Draw death effect if it exists
        const deathEffect = deathEffects.get(username);
        if (deathEffect) {
            deathEffect.particles.forEach(particle => {
                particle.update();
                particle.draw(ctx);
            });
        }
        
        // Only draw player if not dead and not waiting for shield
        if (!player.dead && !player.waitingForShield) {
            // Draw invulnerability effect if player is invulnerable
            if (player.invulnerable && currentTime < player.invulnerable_until) {
                // Draw shield circle
                ctx.beginPath();
                ctx.arc(player.x, player.y, 35, 0, Math.PI * 2);
                ctx.strokeStyle = '#64c8ff';
                ctx.lineWidth = 3;
                ctx.stroke();
                
                // Draw shield glow
                const gradient = ctx.createRadialGradient(player.x, player.y, 25, player.x, player.y, 40);
                gradient.addColorStop(0, 'rgba(100, 200, 255, 0.2)');
                gradient.addColorStop(1, 'rgba(100, 200, 255, 0)');
                ctx.fillStyle = gradient;
                ctx.fill();
            }
            
            // Draw player circle with gray overlay for non-winners if game is over
            ctx.beginPath();
            ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
            if (gameOverState && username !== gameOverState.winner) {
                ctx.fillStyle = '#808080'; // Gray color for losers
            } else {
                ctx.fillStyle = username === currentUsername ? '#4CAF50' : '#f44336';
            }
            ctx.fill();
            
            // Draw crown for winner
            if (gameOverState && username === gameOverState.winner) {
                ctx.font = '32px Arial';
                ctx.fillStyle = '#FFD700';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText('👑', player.x, player.y - 35);
                
                // Add golden glow effect around winner
                const winnerGlow = ctx.createRadialGradient(player.x, player.y, 20, player.x, player.y, 45);
                winnerGlow.addColorStop(0, 'rgba(255, 215, 0, 0.2)');
                winnerGlow.addColorStop(1, 'rgba(255, 215, 0, 0)');
                ctx.fillStyle = winnerGlow;
                ctx.beginPath();
                ctx.arc(player.x, player.y, 45, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Draw player name and score (grayed out for losers)
            ctx.fillStyle = gameOverState && username !== gameOverState.winner ? '#808080' : '#fff';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${username} (${player.score || 0})`, player.x, player.y - 55);
            
            // Draw hearts for lives
            const lives = player.lives || 3;
            const heartSize = 15;
            const heartsWidth = (heartSize * lives) + ((lives - 1) * 5);
            const heartsStartX = player.x - (heartsWidth / 2);
            
            for (let i = 0; i < lives; i++) {
                const heartX = heartsStartX + (i * (heartSize + 5));
                const heartY = player.y - 40;
                
                ctx.fillStyle = gameOverState && username !== gameOverState.winner ? '#808080' : '#ff0000';
                ctx.strokeStyle = gameOverState && username !== gameOverState.winner ? '#808080' : '#ff0000';
                ctx.lineWidth = 2;
                
                ctx.beginPath();
                ctx.moveTo(heartX + heartSize/2, heartY + heartSize/4);
                ctx.bezierCurveTo(
                    heartX, heartY, 
                    heartX, heartY - heartSize/2, 
                    heartX + heartSize/2, heartY - heartSize/2
                );
                ctx.bezierCurveTo(
                    heartX + heartSize, heartY - heartSize/2, 
                    heartX + heartSize, heartY, 
                    heartX + heartSize/2, heartY + heartSize/4
                );
                ctx.lineTo(heartX + heartSize/2, heartY + heartSize/2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            
            // Draw health bar (grayed out for losers)
            const health = player.health || 100;
            const healthBarWidth = 50;
            const healthBarHeight = 5;
            const healthBarX = player.x - healthBarWidth / 2;
            const healthBarY = player.y - 25;
            
            ctx.fillStyle = '#333';
            ctx.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);
            
            if (gameOverState && username !== gameOverState.winner) {
                ctx.fillStyle = '#808080';
            } else {
                ctx.fillStyle = health > 50 ? '#00ff00' : health > 25 ? '#ffff00' : '#ff0000';
            }
            ctx.fillRect(healthBarX, healthBarY, (health / 100) * healthBarWidth, healthBarHeight);
        }
        
        ctx.restore();
    });
    
    // Request next frame if game is over to keep animations smooth
    if (gameOverState) {
        requestAnimationFrame(updateGame);
    }
}

// Add attack handling
let lastAttackTime = 0;
const ATTACK_COOLDOWN = 1000; // 1 second cooldown between attacks

function handleAttack() {
    const currentTime = Date.now();
    if (currentTime - lastAttackTime < ATTACK_COOLDOWN) {
        return; // Still on cooldown
    }
    
    lastAttackTime = currentTime;
    
    // Find the closest player to attack
    const currentPlayer = gameState.players[currentUsername];
    if (!currentPlayer) return;
    
    let closestPlayer = null;
    let minDistance = Infinity;
    
    Object.entries(gameState.players).forEach(([username, position]) => {
        if (username === currentUsername) return;
        
        // Skip dead or invulnerable players
        if (position.dead || (position.invulnerable && (currentTime / 1000) < position.invulnerable_until)) return;
        
        const distance = Math.sqrt(
            Math.pow(position.x - currentPlayer.x, 2) +
            Math.pow(position.y - currentPlayer.y, 2)
        );
        
        if (distance < minDistance) {
            minDistance = distance;
            closestPlayer = username;
        }
    });
    
    if (closestPlayer && minDistance <= 100) {
        socket.emit('player_attack', {
            room_id: roomId,
            username: currentUsername,
            target: closestPlayer
        });
    }
}

// Add attack to keyboard controls
document.addEventListener('keydown', (e) => {
    if (e.key === 'z' || e.key === 'Z') {
        handleAttack();
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
            ctx.save();
            
            const currentTime = Date.now() / 1000;
            
            // Check if invulnerability has ended
            if (player.invulnerable && currentTime >= player.invulnerable_until) {
                player.invulnerable = false;
                respawnEffects.delete(username);
            }
            
            // Draw death effect if it exists
            const deathEffect = deathEffects.get(username);
            if (deathEffect) {
                // Draw death particles
                deathEffect.particles.forEach(particle => {
                    particle.update();
                    particle.draw(ctx);
                });
            }
            
            // Draw player and effects if not in death animation
            if (!player.dead) {
                // Draw invulnerability effect if player is invulnerable
                if (player.invulnerable && currentTime < player.invulnerable_until) {
                    // Draw shield circle
                    ctx.beginPath();
                    ctx.arc(player.x, player.y, 35, 0, Math.PI * 2);
                    ctx.strokeStyle = '#64c8ff';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                    
                    // Draw shield glow
                    const gradient = ctx.createRadialGradient(player.x, player.y, 25, player.x, player.y, 40);
                    gradient.addColorStop(0, 'rgba(100, 200, 255, 0.2)');
                    gradient.addColorStop(1, 'rgba(100, 200, 255, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fill();
                    
                    // Draw shield timer
                    const timeLeft = Math.ceil(player.invulnerable_until - currentTime);
                    ctx.fillStyle = '#64c8ff';
                    ctx.font = '14px Arial';
                    ctx.fillText(`Shield: ${timeLeft}s`, player.x, player.y + 40);
                }
                
                // Draw player circle
                ctx.fillStyle = username === currentUsername ? '#4CAF50' : '#f44336';
                ctx.beginPath();
                ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
                ctx.fill();
                
                // Draw player name and score
                ctx.fillStyle = '#fff';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(`${username} (${player.score || 0})`, player.x, player.y - 55);
                
                // Draw hearts for lives
                const lives = player.lives || 3;
                const heartSize = 15;
                const heartsWidth = (heartSize * lives) + ((lives - 1) * 5);
                const heartsStartX = player.x - (heartsWidth / 2);
                
                for (let i = 0; i < lives; i++) {
                    const heartX = heartsStartX + (i * (heartSize + 5));
                    const heartY = player.y - 40;
                    
                    ctx.fillStyle = '#ff0000';
                    ctx.strokeStyle = '#ff0000';
                    ctx.lineWidth = 2;
                    
                    ctx.beginPath();
                    ctx.moveTo(heartX + heartSize/2, heartY + heartSize/4);
                    ctx.bezierCurveTo(
                        heartX, heartY, 
                        heartX, heartY - heartSize/2, 
                        heartX + heartSize/2, heartY - heartSize/2
                    );
                    ctx.bezierCurveTo(
                        heartX + heartSize, heartY - heartSize/2, 
                        heartX + heartSize, heartY, 
                        heartX + heartSize/2, heartY + heartSize/4
                    );
                    ctx.lineTo(heartX + heartSize/2, heartY + heartSize/2);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }
                
                // Draw health bar
                const health = player.health || 100;
                const healthBarWidth = 50;
                const healthBarHeight = 5;
                const healthBarX = player.x - healthBarWidth / 2;
                const healthBarY = player.y - 25;
                
                ctx.fillStyle = '#333';
                ctx.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);
                
                ctx.fillStyle = health > 50 ? '#00ff00' : health > 25 ? '#ffff00' : '#ff0000';
                ctx.fillRect(healthBarX, healthBarY, (health / 100) * healthBarWidth, healthBarHeight);
            }
            
            ctx.restore();
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
