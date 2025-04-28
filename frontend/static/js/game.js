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
    max_players: 4,
    room_name: 'Game Room',
    win_counts: {}  // Add win counts tracking
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
    if (data.username && data.position) {
        // Initialize velocityY if not present
        if (!data.position.velocityY) {
            data.position.velocityY = 0;
        }
        gameState.players[data.username] = data.position;
    }
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
    // Update game state
    gameState.players = state.players || {};
    if (state.win_counts) {
        gameState.win_counts = state.win_counts;
    }
    updateGame();
});


socket.on('player_move_batch', deltas => {
    // deltas is { username: { x, y }, … }
    Object.entries(deltas).forEach(([user, pos]) => {
      if (gameState.players[user]) {
        gameState.players[user].x = pos.x;
        gameState.players[user].y = pos.y;
      }
    });
    // redraw with only the updated positions
    updateGame();
  });

// Add health update handler
socket.on('player_health_update', (data) => {
    const { username, health } = data;
    if (gameState.players[username]) {
        // Check if this was a hit
        const prevHealth = gameState.players[username].health || 100;
        gameState.players[username].health = health;
        
        // If health decreased, play hit sound
        if (health < prevHealth) {
            try {
                // Play hit sound if this player was hit
                if (username === currentUsername) {
                    hitSound.currentTime = 0;
                    hitSound.volume = 0.3;
                    hitSound.play().catch(e => console.error('Error playing hit sound:', e));
                }
            } catch (error) {
                console.error('Error with hit sound:', error);
            }
        }
        
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
        
        // Play elimination sound
        try {
            eliminationSound.currentTime = 0;
            eliminationSound.volume = 0.4;
            eliminationSound.play().catch(e => console.error('Error playing elimination sound:', e));
        } catch (error) {
            console.error('Error with elimination sound:', error);
        }
        
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
let gameOverMessage = null;
// Create victory sound
const victorySound = new Audio('https://cdn.freesound.org/previews/270/270402_5123851-lq.mp3');
// Create elimination sound
const eliminationSound = new Audio('https://cdn.freesound.org/previews/476/476178_9242326-lq.mp3');
// Create attack sound
const attackSound = new Audio('https://cdn.freesound.org/previews/350/350985_6456158-lq.mp3');
// Create hit sound
const hitSound = new Audio('https://cdn.freesound.org/previews/391/391961_7416345-lq.mp3');

// Add game freeze state
let gameFrozen = false;

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

    // Freeze the game
    gameFrozen = true;

    // Update win counts from server data
    if (data.win_counts) {
        gameState.win_counts = data.win_counts;
        console.log('Updated win counts:', gameState.win_counts);
    }
    
    // Store game over state
    gameOverState = {
        winner,
        timestamp: Date.now()
    };
    
    // Play victory sound
    try {
        victorySound.currentTime = 0;
        victorySound.volume = 0.4;
        victorySound.play().catch(e => console.error('Error playing victory sound:', e));
    } catch (error) {
        console.error('Error with victory sound:', error);
    }
    
    // Remove any existing game over message
    if (gameOverMessage && gameOverMessage.parentNode) {
        gameOverMessage.parentNode.removeChild(gameOverMessage);
        gameOverMessage = null;
    }
    
    // Create new game over message
    gameOverMessage = document.createElement('div');
    gameOverMessage.style.position = 'absolute';
    gameOverMessage.style.top = '50%';
    gameOverMessage.style.left = '50%';
    gameOverMessage.style.transform = 'translate(-50%, -50%)';
    gameOverMessage.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    gameOverMessage.style.color = 'white';
    gameOverMessage.style.padding = '20px';
    gameOverMessage.style.textAlign = 'center';
    gameOverMessage.style.borderRadius = '10px';
    gameOverMessage.style.border = '2px solid #FFD700';
    gameOverMessage.style.minWidth = '300px';
    gameOverMessage.style.zIndex = '1000';
    
    const winnerIsYou = winner === currentUsername;
    const currentWinCount = gameState.win_counts[winner] || 0;
    
    gameOverMessage.innerHTML = `
        <h2 style="margin-top: 0; color: #FFD700; font-size: 32px;">GAME OVER</h2>
        <div style="margin: 20px 0; font-size: 24px;">
            ${winnerIsYou ? 'YOU WIN! 🎉' : `${winner} WINS! 👑`}
        </div>
        <div style="margin: 10px 0 20px 0; font-size: 18px;">
            ${winnerIsYou ? 'Congratulations!' : 'Better luck next time!'}
        </div>
        <div style="font-size: 16px; margin-bottom: 15px;">
            Win Count: ${currentWinCount}
        </div>
        <div style="font-size: 14px; opacity: 0.8; margin-top: 20px;">
            Game restarting in 5 seconds...
        </div>
    `;
    
    // Add to game section
    document.getElementById('game-section').appendChild(gameOverMessage);
    
    // Update the players list to reflect new win counts immediately
    if (playersListElem) {
        playersListElem.innerHTML = Object.keys(gameState.players).map(player => {
            const isCurrentPlayer = player === currentUsername;
            const winCount = gameState.win_counts[player] || 0;
            return `<li class="${isCurrentPlayer ? 'current-player' : ''}">${player} (${winCount})${isCurrentPlayer ? ' (You)' : ''}</li>`;
        }).join('');
    }
    
    // Force a game state update to refresh all displays
    updateGame();
    
    // Disable controls during reset
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    
    // Clear any existing reset timeout
    if (window.gameResetTimeout) {
        clearTimeout(window.gameResetTimeout);
    }
    
    // Set timeout to reset game state
    window.gameResetTimeout = setTimeout(() => {
        console.log('Resetting game state');
        
        // Clear game over state
        gameOverState = null;
        
        // Remove game over message
        if (gameOverMessage && gameOverMessage.parentNode) {
            gameOverMessage.parentNode.removeChild(gameOverMessage);
            gameOverMessage = null;
        }
        
        // Reset all players
        Object.values(gameState.players).forEach(player => {
            player.lives = 3;
            player.health = 100;
            player.eliminated = false;
            player.dead = false;
            player.invulnerable = false;
            player.invulnerable_until = 0;
        });
        
        // Re-enable controls
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        
        // Clear any existing effects
        deathEffects.clear();
        respawnEffects.clear();
        
        // Unfreeze the game
        gameFrozen = false;
        
        // Force final update
        updateGame();
    }, 5000);
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

// Replace single platform with multiple platforms
const platforms = [
    {
        x: 300,
        y: 400,
        width: 200,
        height: 20,
        color: '#8B4513'
    },
    {
        x: 100,
        y: 300,
        width: 150,
        height: 20,
        color: '#8B4513'
    },
    {
        x: 500,
        y: 250,
        width: 180,
        height: 20,
        color: '#8B4513'
    },
    {
        x: 300,
        y: 150,
        width: 160,
        height: 20,
        color: '#8B4513'
    }
];

// Update physics configuration
const jumpConfig = {
    initialVelocity: -15,
    gravity: 0.5,
    maxFallSpeed: 10,
    moveSpeed: 7,     // Base movement speed
    airControl: 0.7,  // Multiplier for air movement (70% control in air)
    friction: 0.85    // Ground friction
};

// Add ground configuration
const GROUND_HEIGHT = 50;
const PLAYER_RADIUS = 25;
const FLOOR_Y = canvas.height - GROUND_HEIGHT;

let lastMoveEmit = 0;
const MOVE_EMIT_INTERVAL = 50; // ms → 20 Hz

// Update handleInput function to work with multiple platforms
function handleInput() {
    if (!gameState.players[currentUsername]) {
        return;
    }
    
    const player = gameState.players[currentUsername];
    let moved = false;
    
    // Initialize velocities if they don't exist
    if (player.velocityY === undefined) player.velocityY = 0;
    if (player.velocityX === undefined) player.velocityX = 0;
    
    // Check if player is on any platform
    const onPlatform = platforms.some(platform => (
        player.y >= platform.y - PLAYER_RADIUS &&
        player.y <= platform.y + 10 &&
        player.x >= platform.x - PLAYER_RADIUS &&
        player.x <= platform.x + platform.width + PLAYER_RADIUS
    ));
    
    // Check if player is on ground
    const onGround = player.y >= FLOOR_Y - PLAYER_RADIUS;
    const isGrounded = onGround || onPlatform;
    
    // Initialize facing direction if it doesn't exist
    if (player.facingLeft === undefined) {
        player.facingLeft = false;
    }
    
    // Calculate target velocity based on input
    let targetVelocityX = 0;
    if (keys['ArrowLeft']) {
        targetVelocityX = -jumpConfig.moveSpeed;
        player.facingLeft = true;
        moved = true;
    }
    if (keys['ArrowRight']) {
        targetVelocityX = jumpConfig.moveSpeed;
        player.facingLeft = false;
        moved = true;
    }
    
    // Apply air control or ground movement
    if (isGrounded) {
        // On ground - direct control
        player.velocityX = targetVelocityX;
    } else {
        // In air - reduced control
        player.velocityX = player.velocityX * jumpConfig.friction + targetVelocityX * jumpConfig.airControl;
    }
    
    // Apply friction when no input
    if (targetVelocityX === 0 && isGrounded) {
        player.velocityX *= jumpConfig.friction;
    }
    
    // Update position based on velocity
    player.x += player.velocityX;
    
    // Constrain to screen bounds
    player.x = Math.max(25, Math.min(canvas.width - 25, player.x));
    
    // Handle jumping
    if (keys['Space'] && isGrounded) {
        player.velocityY = jumpConfig.initialVelocity;
        moved = true;
    }
    
    // Apply gravity
    player.velocityY = Math.min(player.velocityY + jumpConfig.gravity, jumpConfig.maxFallSpeed);
    player.y += player.velocityY;
    
    // Handle ground collision
    if (player.y >= FLOOR_Y - PLAYER_RADIUS) {
        player.y = FLOOR_Y - PLAYER_RADIUS;
        player.velocityY = 0;
    }
    
    // Handle platform collisions
    for (const platform of platforms) {
        if (player.velocityY > 0 && // Moving downward
            player.y >= platform.y - PLAYER_RADIUS &&
            player.y <= platform.y + platform.height &&
            player.x >= platform.x - PLAYER_RADIUS &&
            player.x <= platform.x + platform.width + PLAYER_RADIUS) {
            player.y = platform.y - PLAYER_RADIUS;
            player.velocityY = 0;
            break;
        }
    }
    
    // Attack handling (keep existing attack code)
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
                    
                    // Start attack animation with facing direction
                    attackAnimations.set(currentUsername, new AttackAnimation(player, Date.now(), player.facingLeft));
                    
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
            // Start attack animation even if no target hit
            attackAnimations.set(currentUsername, new AttackAnimation(player, Date.now(), player.facingLeft));
            
            // Flash the attack area
            ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
            ctx.beginPath();
            ctx.arc(player.x, player.y, 60, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Send position update to server if moved or has velocity
    if (moved || Math.abs(player.velocityX) > 0.1 || Math.abs(player.velocityY) > 0.1) {
        const now = Date.now();
        if (now - lastMoveEmit >= MOVE_EMIT_INTERVAL) {
          socket.emit('player_move', {
            room_id: roomId,
            username: currentUsername,
            position: { x: player.x, y: player.y }
          });
          lastMoveEmit = now;
        }
      }
}

// Update the game loop to run at a fixed time step
const FRAME_RATE = 60;
const FRAME_DELAY = 1000 / FRAME_RATE;
let lastFrameTime = 0;

function gameLoop(timestamp) {
    if (!lastFrameTime) lastFrameTime = timestamp;
    
    const elapsed = timestamp - lastFrameTime;
    
    if (elapsed >= FRAME_DELAY) {
        if (!gameFrozen) {
            handleInput();
        }
        updateGame();
        lastFrameTime = timestamp;
    }
    
    requestAnimationFrame(gameLoop);
}

// Start the game loop with requestAnimationFrame
requestAnimationFrame(gameLoop);

// Remove the old gravity interval since it's now handled in handleInput
if (typeof gravityInterval !== 'undefined') {
    clearInterval(gravityInterval);
}

// Add weapon animation configuration
const weaponConfig = {
    length: 40,           // Length of the sword
    width: 8,            // Width of the sword
    swingDuration: 200,  // Duration of swing animation in ms
    color: '#C0C0C0',    // Silver color for the sword
    glowColor: '#4169E1', // Royal blue glow for the swing effect
    defaultAngle: -Math.PI / 4  // Default sword angle (-45 degrees)
};

// Track active attack animations
const attackAnimations = new Map();

class AttackAnimation {
    constructor(player, startTime, facingLeft) {
        this.player = player;
        this.startTime = startTime;
        this.progress = 0;
        this.facingLeft = facingLeft;
    }

    update(currentTime) {
        const elapsed = currentTime - this.startTime;
        this.progress = Math.min(elapsed / weaponConfig.swingDuration, 1);
        return this.progress < 1;
    }

    draw(ctx) {
        const player = this.player;
        
        ctx.save();
        ctx.translate(player.x, player.y);
        
        if (this.facingLeft) {
            // When facing left, flip horizontally and animate
            ctx.scale(-1, 1);
            const swingAngle = (-Math.PI / 4) + (this.progress * Math.PI / 2);
            ctx.rotate(swingAngle);
        } else {
            // When facing right, just animate
            const swingAngle = (Math.PI / 4) - (this.progress * Math.PI / 2);
            ctx.rotate(swingAngle);
        }
        
        // Draw sword handle
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(-5, -5, 10, 10);
        
        // Draw sword blade
        const gradient = ctx.createLinearGradient(0, -weaponConfig.length, 0, 0);
        gradient.addColorStop(0, weaponConfig.color);
        gradient.addColorStop(1, '#A0A0A0');
        ctx.fillStyle = gradient;
        ctx.fillRect(-weaponConfig.width/2, -weaponConfig.length, weaponConfig.width, weaponConfig.length);
        
        // Add swing effect
        const glowOpacity = Math.sin(this.progress * Math.PI) * 0.6;
        ctx.strokeStyle = weaponConfig.glowColor;
        ctx.lineWidth = 2;
        ctx.globalAlpha = glowOpacity;
        ctx.stroke();
        
        // Add motion blur effect
        ctx.beginPath();
        ctx.globalAlpha = glowOpacity * 0.3;
        if (this.facingLeft) {
            ctx.arc(0, 0, weaponConfig.length, -Math.PI/4, Math.PI/4, false);
        } else {
            ctx.arc(0, 0, weaponConfig.length, Math.PI * 5/4, Math.PI * 7/4, false);
        }
        ctx.strokeStyle = weaponConfig.glowColor;
        ctx.stroke();
        
        ctx.restore();
    }
}

// Game loop
function updateGame() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw the floor with proper height
    ctx.fillStyle = '#666';
    ctx.fillRect(0, FLOOR_Y, canvas.width, GROUND_HEIGHT);
    
    // Add floor highlight for better visibility
    ctx.fillStyle = '#777';
    ctx.fillRect(0, FLOOR_Y, canvas.width, 2);
    
    // Draw all platforms
    platforms.forEach(platform => {
        // Draw the platform
        ctx.fillStyle = platform.color;
        ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
        
        // Add platform shadow/highlight for 3D effect
        ctx.fillStyle = '#6B3410';
        ctx.fillRect(platform.x, platform.y + platform.height - 2, platform.width, 2);
        ctx.fillStyle = '#A0522D';
        ctx.fillRect(platform.x, platform.y, platform.width, 2);
    });
    
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
        
        // Only draw player and weapon if not dead and not waiting for shield
        if (!player.dead && !player.waitingForShield && !player.eliminated) {
            // Draw invulnerability effect if player is invulnerable
            if (player.invulnerable && currentTime < player.invulnerable_until) {
                ctx.beginPath();
                ctx.arc(player.x, player.y, PLAYER_RADIUS + 10, 0, Math.PI * 2);
                ctx.strokeStyle = '#64c8ff';
                ctx.lineWidth = 3;
                ctx.stroke();
                
                const gradient = ctx.createRadialGradient(
                    player.x, player.y, PLAYER_RADIUS,
                    player.x, player.y, PLAYER_RADIUS + 15
                );
                gradient.addColorStop(0, 'rgba(100, 200, 255, 0.2)');
                gradient.addColorStop(1, 'rgba(100, 200, 255, 0)');
                ctx.fillStyle = gradient;
                ctx.fill();
            }
            
            // Draw player circle
            ctx.beginPath();
            ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = username === currentUsername ? '#4CAF50' : '#f44336';
            ctx.fill();
            
            // Draw slight shadow under player for grounding effect
            ctx.beginPath();
            ctx.ellipse(player.x, player.y + PLAYER_RADIUS - 2, PLAYER_RADIUS - 5, 8, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.fill();
            
            // Draw player name and win count
            ctx.fillStyle = '#fff';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${username} (${gameState.win_counts[username] || 0})`, player.x, player.y - 55);
            
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
            
            // Draw weapon and attack animation if exists
            const attackAnim = attackAnimations.get(username);
            if (attackAnim) {
                if (!attackAnim.update(Date.now())) {
                    // Animation finished
                    attackAnimations.delete(username);
                } else {
                    // Draw the animation
                    attackAnim.draw(ctx);
                }
            } else {
                // Draw default weapon position when not attacking
                ctx.save();
                ctx.translate(player.x, player.y);
                
                if (player.facingLeft) {
                    // When facing left, flip horizontally and rotate
                    ctx.scale(-1, 1);
                    ctx.rotate(-Math.PI / 4);
                } else {
                    // When facing right, just rotate
                    ctx.rotate(Math.PI / 4);
                }
                
                // Draw sword handle
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(-5, -5, 10, 10);
                
                // Draw sword blade
                const gradient = ctx.createLinearGradient(0, -weaponConfig.length, 0, 0);
                gradient.addColorStop(0, weaponConfig.color);
                gradient.addColorStop(1, '#A0A0A0');
                ctx.fillStyle = gradient;
                ctx.fillRect(-weaponConfig.width/2, -weaponConfig.length, weaponConfig.width, weaponConfig.length);
                
                ctx.restore();
            }
        }
        
        ctx.restore();
    });
    
    // If game is over, request animation frame to keep effects running
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
        // Play attack sound
        try {
            attackSound.currentTime = 0;
            attackSound.volume = 0.3;
            attackSound.play().catch(e => console.error('Error playing attack sound:', e));
        } catch (error) {
            console.error('Error with attack sound:', error);
        }
        
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
        gameState.win_counts = state.win_counts || {}; // Make sure we update win counts from server
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
                const isCurrentPlayer = player === currentUsername;
                const winCount = gameState.win_counts[player] || 0;
                return `<li class="${isCurrentPlayer ? 'current-player' : ''}">${player} (${winCount})${isCurrentPlayer ? ' (You)' : ''}</li>`;
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
        
        // Check if player is on any platform
        const onPlatform = platforms.some(platform => (
            player.y >= platform.y - PLAYER_RADIUS && // Player bottom touches platform top
            player.y <= platform.y + 10 && // Small tolerance for landing
            player.x >= platform.x - PLAYER_RADIUS && // Player left side is past platform left edge
            player.x <= platform.x + platform.width + PLAYER_RADIUS // Player right side is before platform right edge
        ));
        
        // Check if player is on ground
        const onGround = player.y >= FLOOR_Y - PLAYER_RADIUS;
        
        // Initialize velocityY if it doesn't exist
        if (player.velocityY === undefined) {
            player.velocityY = 0;
        }
        
        // Jump (only if on ground or platform)
        if (keys['Space'] && (onGround || onPlatform)) {
            player.velocityY = jumpConfig.initialVelocity;
            moved = true;
        }
        
        // Apply gravity and velocity
        player.velocityY = Math.min(player.velocityY + jumpConfig.gravity, jumpConfig.maxFallSpeed);
        player.y += player.velocityY;
        
        // Handle ground collision
        if (player.y >= FLOOR_Y - PLAYER_RADIUS) {
            player.y = FLOOR_Y - PLAYER_RADIUS;
            player.velocityY = 0;
        }
        
        // Handle platform collisions
        for (const platform of platforms) {
            if (player.velocityY > 0 && // Moving downward
                player.y >= platform.y - PLAYER_RADIUS &&
                player.y <= platform.y + platform.height &&
                player.x >= platform.x - PLAYER_RADIUS &&
                player.x <= platform.x + platform.width + PLAYER_RADIUS) {
                player.y = platform.y - PLAYER_RADIUS;
                player.velocityY = 0;
                break;
            }
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
                        
                        // Start attack animation with facing direction
                        attackAnimations.set(currentUsername, new AttackAnimation(player, Date.now(), player.facingLeft));
                        
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
                // Start attack animation even if no target hit
                attackAnimations.set(currentUsername, new AttackAnimation(player, Date.now(), player.facingLeft));
                
                // Flash the attack area
                ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
                ctx.beginPath();
                ctx.arc(player.x, player.y, 60, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        // Send position update to server if moved
        if (moved || player.velocityY !== 0) {
            socket.emit('player_move', {
                room_id: roomId,
                username: currentUsername,
                position: {
                    x: player.x,
                    y: player.y,
                    score: player.score || 0,
                    velocityY: player.velocityY
                }
            });
        }
    }
    
    // Update gravity interval to use new physics
    const gravityInterval = setInterval(() => {
        if (gameState.players[currentUsername]) {
            const player = gameState.players[currentUsername];
            
            // Initialize velocityY if it doesn't exist
            if (player.velocityY === undefined) {
                player.velocityY = 0;
            }
            
            // Check if player is on any platform
            const onPlatform = platforms.some(platform => (
                player.y >= platform.y - PLAYER_RADIUS && // Player bottom touches platform top
                player.y <= platform.y + 10 && // Small tolerance for landing
                player.x >= platform.x - PLAYER_RADIUS && // Player left side is past platform left edge
                player.x <= platform.x + platform.width + PLAYER_RADIUS // Player right side is before platform right edge
            ));
            
            // Check if player is on ground
            const onGround = player.y >= FLOOR_Y - PLAYER_RADIUS;
            
            // Apply gravity if not on ground and not on platform
            if (!onGround && !onPlatform) {
                player.velocityY = Math.min(player.velocityY + jumpConfig.gravity, jumpConfig.maxFallSpeed);
                player.y += player.velocityY;
                
                // Send updated position to server
                socket.emit('player_move', {
                    room_id: roomId,
                    username: currentUsername,
                    position: {
                        x: player.x,
                        y: player.y,
                        score: player.score || 0,
                        velocityY: player.velocityY
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
        
        // Draw the floor with proper height
        ctx.fillStyle = '#666';
        ctx.fillRect(0, FLOOR_Y, canvas.width, GROUND_HEIGHT);
        
        // Add floor highlight for better visibility
        ctx.fillStyle = '#777';
        ctx.fillRect(0, FLOOR_Y, canvas.width, 2);
        
        // Draw all platforms
        platforms.forEach(platform => {
            // Draw the platform
            ctx.fillStyle = platform.color;
            ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
            
            // Add platform shadow/highlight for 3D effect
            ctx.fillStyle = '#6B3410';
            ctx.fillRect(platform.x, platform.y + platform.height - 2, platform.width, 2);
            ctx.fillStyle = '#A0522D';
            ctx.fillRect(platform.x, platform.y, platform.width, 2);
        });
        
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
            
            // Only draw player and weapon if not dead and not waiting for shield
            if (!player.dead && !player.waitingForShield && !player.eliminated) {
                // Draw invulnerability effect if player is invulnerable
                if (player.invulnerable && currentTime < player.invulnerable_until) {
                    ctx.beginPath();
                    ctx.arc(player.x, player.y, PLAYER_RADIUS + 10, 0, Math.PI * 2);
                    ctx.strokeStyle = '#64c8ff';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                    
                    const gradient = ctx.createRadialGradient(
                        player.x, player.y, PLAYER_RADIUS,
                        player.x, player.y, PLAYER_RADIUS + 15
                    );
                    gradient.addColorStop(0, 'rgba(100, 200, 255, 0.2)');
                    gradient.addColorStop(1, 'rgba(100, 200, 255, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }
                
                // Draw player circle
                ctx.beginPath();
                ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = username === currentUsername ? '#4CAF50' : '#f44336';
                ctx.fill();
                
                // Draw slight shadow under player for grounding effect
                ctx.beginPath();
                ctx.ellipse(player.x, player.y + PLAYER_RADIUS - 2, PLAYER_RADIUS - 5, 8, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.fill();
                
                // Draw player name and win count
                ctx.fillStyle = '#fff';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(`${username} (${gameState.win_counts[username] || 0})`, player.x, player.y - 55);
                
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
                
                // Draw weapon and attack animation if exists
                const attackAnim = attackAnimations.get(username);
                if (attackAnim) {
                    if (!attackAnim.update(Date.now())) {
                        // Animation finished
                        attackAnimations.delete(username);
                    } else {
                        // Draw the animation
                        attackAnim.draw(ctx);
                    }
                } else {
                    // Draw default weapon position when not attacking
                    ctx.save();
                    ctx.translate(player.x, player.y);
                    
                    if (player.facingLeft) {
                        // When facing left, flip horizontally and rotate
                        ctx.scale(-1, 1);
                        ctx.rotate(-Math.PI / 4);
                    } else {
                        // When facing right, just rotate
                        ctx.rotate(Math.PI / 4);
                    }
                    
                    // Draw sword handle
                    ctx.fillStyle = '#8B4513';
                    ctx.fillRect(-5, -5, 10, 10);
                    
                    // Draw sword blade
                    const gradient = ctx.createLinearGradient(0, -weaponConfig.length, 0, 0);
                    gradient.addColorStop(0, weaponConfig.color);
                    gradient.addColorStop(1, '#A0A0A0');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(-weaponConfig.width/2, -weaponConfig.length, weaponConfig.width, weaponConfig.length);
                    
                    ctx.restore();
                }
            }
            
            ctx.restore();
        });
    }
    
    // Game loop
    function gameLoop() {
        if (!gameFrozen) {
            handleInput();
        }
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
    
    // Sound management
    let soundsEnabled = true;
    const muteBtn = document.getElementById('mute-btn');
    
    if (muteBtn) {
        // Check if mute preference is stored in localStorage
        const savedMutePreference = localStorage.getItem('gameSoundsMuted');
        if (savedMutePreference === 'true') {
            soundsEnabled = false;
            muteBtn.textContent = '🔇';
            muteBtn.classList.add('muted');
            muteBtn.title = 'Unmute Sounds';
            
            // Mute all sounds
            victorySound.muted = true;
            eliminationSound.muted = true;
            attackSound.muted = true;
            hitSound.muted = true;
        }
        
        muteBtn.addEventListener('click', () => {
            soundsEnabled = !soundsEnabled;
            
            if (soundsEnabled) {
                muteBtn.textContent = '🔊';
                muteBtn.classList.remove('muted');
                muteBtn.title = 'Mute Sounds';
                
                // Unmute all sounds
                victorySound.muted = false;
                eliminationSound.muted = false;
                attackSound.muted = false;
                hitSound.muted = false;
            } else {
                muteBtn.textContent = '🔇';
                muteBtn.classList.add('muted');
                muteBtn.title = 'Unmute Sounds';
                
                // Mute all sounds
                victorySound.muted = true;
                eliminationSound.muted = true;
                attackSound.muted = true;
                hitSound.muted = true;
            }
            
            // Save preference to localStorage
            localStorage.setItem('gameSoundsMuted', !soundsEnabled);
        });
    }
}
// --- END GAME ROOM LOGIC ---

// Add handler for game reset
socket.on('game_reset', () => {
    console.log('Receiving game reset');
    
    // Clear game over state
    gameOverState = null;
    
    // Remove game over message
    if (gameOverMessage && gameOverMessage.parentNode) {
        gameOverMessage.parentNode.removeChild(gameOverMessage);
        gameOverMessage = null;
    }
    
    // Clear any existing effects
    deathEffects.clear();
    respawnEffects.clear();
    
    // Re-enable controls
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Unfreeze the game
    gameFrozen = false;
    
    // Force final update
    updateGame();
});
