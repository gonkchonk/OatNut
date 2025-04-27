from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from pymongo import MongoClient
from bson.objectid import ObjectId
import os
import logging
from logging.handlers import RotatingFileHandler
import hashlib
import random
import string
import bcrypt
import datetime

# Initialize Flask app
app = Flask(__name__, 
    template_folder='../frontend/templates',
    static_folder='../frontend/static'
)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev_key_123')  # Change in production

# Initialize LoginManager
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# Initialize SocketIO
socketio = SocketIO(
    app, 
    cors_allowed_origins="*",  # Allow all origins
    logger=True,              # Enable logging
    engineio_logger=True,     # Enable Engine.IO logging
    ping_timeout=60,          # Increase ping timeout
    ping_interval=25          # Increase ping interval
)

# Try to connect to MongoDB - if it fails we'll handle gracefully
try:
    mongo_uri = os.environ.get('MONGODB_URI', 'mongodb://localhost:27017/game_db')
    mongo_client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    # Verify the connection
    mongo_client.admin.command('ping')
    db = mongo_client.game_db
    
    # --- AUTHTOKEN SETUP ---
    user_tokens = db.user_authtokens
    user_tokens.create_index('userid')
except Exception as e:
    app.logger.error(f"MongoDB connection error: {e}")
    # Create a dummy DB for development/testing
    from pymongo.errors import ServerSelectionTimeoutError
    app.logger.warning("Using in-memory database for development")
    
    class InMemoryDB:
        def __init__(self):
            self.users = InMemoryCollection()
            self.rooms = InMemoryCollection()
            self.user_authtokens = InMemoryCollection()
    
    class InMemoryCollection:
        def __init__(self):
            self.data = []
            self.indexes = []
        
        def create_index(self, field):
            self.indexes.append(field)
            return field
        
        def find_one(self, query):
            for item in self.data:
                match = True
                for key, value in query.items():
                    if key not in item or item[key] != value:
                        match = False
                        break
                if match:
                    return item
            return None
        
        def find(self, query=None, projection=None):
            results = []
            query = query or {}
            for item in self.data:
                match = True
                for key, value in query.items():
                    if key not in item or item[key] != value:
                        match = False
                        break
                if match:
                    if projection:
                        result = {}
                        for key in projection:
                            if key in item:
                                result[key] = item[key]
                        results.append(result)
                    else:
                        results.append(item)
            return results
        
        def insert_one(self, doc):
            if '_id' not in doc:
                doc['_id'] = ObjectId()
            self.data.append(doc)
            class Result:
                def __init__(self, id):
                    self.inserted_id = id
            return Result(doc['_id'])
        
        def update_one(self, query, update):
            for item in self.data:
                match = True
                for key, value in query.items():
                    if key not in item or item[key] != value:
                        match = False
                        break
                if match:
                    if '$push' in update:
                        for key, value in update['$push'].items():
                            if key not in item:
                                item[key] = []
                            item[key].append(value)
                    if '$set' in update:
                        for key, value in update['$set'].items():
                            item[key] = value
                    break
        
        def delete_one(self, query):
            for i, item in enumerate(self.data):
                match = True
                for key, value in query.items():
                    if key not in item or item[key] != value:
                        match = False
                        break
                if match:
                    del self.data[i]
                    break
    
    db = InMemoryDB()
    user_tokens = db.user_authtokens

# Track active users
active_users = {}
game_states = {}

@socketio.on('connect')
def handle_connect():
    app.logger.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info(f"Client disconnected: {request.sid}")

@socketio.on('join_room')
def handle_join_room(data):
    try:
        room_id = data['room_id']
        username = data['username']
        app.logger.info(f"Player {username} joining room {room_id}")
        
        # Use flask_socketio's join_room to add the client to the room
        join_room(room_id)
        
        # Initialize room state if it doesn't exist
        if room_id not in game_states:
            game_states[room_id] = {
                'players': {},
                'active': True
            }
        
        # Initialize player position
        if username not in game_states[room_id]['players']:
            # Spread players across the screen based on how many are in the room
            player_count = len(game_states[room_id]['players'])
            x_position = 100 + (player_count * 150)  # Space players out horizontally
            
            game_states[room_id]['players'][username] = {
                'x': x_position,
                'y': 500,  # Start at the bottom
                'score': 0
            }
        
        # Update player list in database
        db.rooms.update_one(
            {"_id": ObjectId(room_id)},
            {"$addToSet": {"players": username}}
        )
        
        # Get room details from database
        room = db.rooms.find_one({"_id": ObjectId(room_id)})
        max_players = room.get('max_players', 4) if room else 4
        
        # Broadcast the updated game state to all players in the room
        room_data = {
            'players': game_states[room_id]['players'],
            'player_count': len(game_states[room_id]['players']),
            'max_players': max_players,
            'room_name': room.get('name', 'Game Room') if room else 'Game Room'
        }
        
        # Emit to the specific client first
        emit('game_state', room_data)
        
        # Then emit to everyone in the room
        socketio.emit('game_state', room_data, room=room_id)
        
        # Notify other players that someone has joined
        socketio.emit('player_joined', {
            'username': username,
            'position': game_states[room_id]['players'][username],
            'players': list(game_states[room_id]['players'].keys())
        }, room=room_id)
        
        # Also emit room_update to the lobby to refresh the room list
        socketio.emit('room_update')
        
        app.logger.info(f"Current game state for room {room_id}: {game_states[room_id]}")
    except Exception as e:
        app.logger.error(f"Error in handle_join_room: {str(e)}", exc_info=True)
        emit('error', {'message': f'Error joining room: {str(e)}'})

@socketio.on('player_move')
def handle_player_move(data):
    try:
        room_id = data['room_id']
        username = data['username']
        position = data['position']
        
        if room_id in game_states and username in game_states[room_id]['players']:
            # Update player position
            game_states[room_id]['players'][username].update(position)
            
            # Get room details from database
            room = db.rooms.find_one({"_id": ObjectId(room_id)})
            max_players = room.get('max_players', 4) if room else 4
            
            # Broadcast updated game state
            socketio.emit('game_state', {
                'players': game_states[room_id]['players'],
                'player_count': len(game_states[room_id]['players']),
                'max_players': max_players
            }, room=room_id)
    except Exception as e:
        app.logger.error(f"Error in handle_player_move: {str(e)}")

@socketio.on('player_attack')
def handle_player_attack(data):
    try:
        room_id = data['room_id']
        attacker = data['username']
        target = data.get('target')  # Optional target
        
        # Check if room exists and is active
        if room_id not in game_states or not game_states[room_id]['active']:
            app.logger.warning(f"Attack failed: Room {room_id} not found or inactive")
            return
            
        # Validate the attacker exists in the room
        if attacker not in game_states[room_id]['players']:
            app.logger.warning(f"Attack failed: Player {attacker} not in room {room_id}")
            return
            
        # Validate target if specified
        if target and target not in game_states[room_id]['players']:
            app.logger.warning(f"Attack failed: Target {target} not in room {room_id}")
            return
            
        # Increase the attacker's score
        game_states[room_id]['players'][attacker]['score'] += 1
        app.logger.info(f"Player {attacker} scored in room {room_id}. New score: {game_states[room_id]['players'][attacker]['score']}")
        
        # Check for win condition (score of 5)
        if game_states[room_id]['players'][attacker]['score'] >= 5:
            game_states[room_id]['active'] = False
            app.logger.info(f"Game over in room {room_id}. Winner: {attacker}")
            
            socketio.emit('game_over', {
                'winner': attacker,
                'finalScores': {
                    user: info['score']
                    for user, info in game_states[room_id]['players'].items()
                }
            }, room=room_id)
        else:
            # Just update the game state
            room = db.rooms.find_one({"_id": ObjectId(room_id)})
            max_players = room.get('max_players', 4) if room else 4
            
            socketio.emit('game_state', {
                'players': game_states[room_id]['players'],
                'player_count': len(game_states[room_id]['players']),
                'max_players': max_players
            }, room=room_id)
    except Exception as e:
        app.logger.error(f"Error in handle_player_attack: {str(e)}", exc_info=True)
        emit('error', {'message': f'Error processing attack: {str(e)}'})

@socketio.on('leave_room')
def handle_leave_room(data):
    try:
        room_id = data['room_id']
        username = data['username']
        app.logger.info(f"Player {username} leaving room {room_id}")
        
        # Remove player from game state
        if room_id in game_states and username in game_states[room_id]['players']:
            del game_states[room_id]['players'][username]
            app.logger.info(f"Removed player {username} from game state in room {room_id}")
            
            # If room is empty, clean it up
            if not game_states[room_id]['players']:
                del game_states[room_id]
                app.logger.info(f"Room {room_id} is empty, removing from game states")
                
                # Check if room exists in database before trying to delete
                room = db.rooms.find_one({"_id": ObjectId(room_id)})
                if room:
                    db.rooms.delete_one({"_id": ObjectId(room_id)})
                    app.logger.info(f"Deleted empty room {room_id} from database")
            else:
                # Get room details from database
                room = db.rooms.find_one({"_id": ObjectId(room_id)})
                if room:
                    max_players = room.get('max_players', 4)
                    
                    # Update the database - remove player from room's players list
                    db.rooms.update_one(
                        {"_id": ObjectId(room_id)},
                        {"$pull": {"players": username}}
                    )
                    app.logger.info(f"Removed player {username} from room {room_id} in database")
                    
                    # Broadcast updated game state
                    socketio.emit('game_state', {
                        'players': game_states[room_id]['players'],
                        'player_count': len(game_states[room_id]['players']),
                        'max_players': max_players
                    }, room=room_id)
                else:
                    app.logger.warning(f"Room {room_id} not found in database")
        else:
            app.logger.warning(f"Player {username} or room {room_id} not found in game state")
        
        # Leave the socket room
        leave_room(room_id)
        app.logger.info(f"Player {username} left socket room {room_id}")
        
        # Notify others about the player leaving
        remaining_players = list(game_states[room_id]['players'].keys()) if room_id in game_states else []
        socketio.emit('player_left', {
            'username': username,
            'players': remaining_players
        }, room=room_id)
        
        # Send a confirmation to the client that they've left
        emit('left_room', {'success': True}, room=request.sid)
        
        # Broadcast room update to the lobby
        socketio.emit('room_update')
        
        app.logger.info(f"Player {username} successfully left room {room_id}")
    except Exception as e:
        app.logger.error(f"Error in handle_leave_room: {str(e)}", exc_info=True)
        emit('error', {'message': f'Error leaving room: {str(e)}'})
        # Still try to send left_room to client
        emit('left_room', {'success': False, 'error': str(e)}, room=request.sid)

@app.route('/api/rooms')
@login_required
def get_rooms():
    # Get all available game rooms
    rooms = list(db.rooms.find({}, {"_id": 1, "name": 1, "players": 1, "max_players": 1}))
    
    # Convert ObjectId to string
    for room in rooms:
        room["_id"] = str(room["_id"])
    
    return jsonify({"success": True, "rooms": rooms})

# --- AUTHTOKEN SETUP ---
user_tokens = db.user_authtokens
user_tokens.create_index('userid')

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def create_authtoken(userid: str) -> str:
    token = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
    token_hash = _hash_token(token)
    
    # Check if a token already exists for this user and delete it
    user_tokens.delete_many({'userid': userid})
    
    # Create new token
    user_tokens.insert_one({
        'userid': userid,
        'authtoken': token_hash
    })
    
    app.logger.info(f"Created new token for user ID: {userid}")
    return token

def verify_authtoken(token: str) -> bool:
    if not token:
        return False
        
    token_hash = _hash_token(token)
    result = user_tokens.find_one({'authtoken': token_hash})
    return result is not None

def get_userid_from_token(token: str) -> str:
    if not token:
        return None
        
    token_hash = _hash_token(token)
    result = user_tokens.find_one({'authtoken': token_hash})
    return result['userid'] if result else None

def delete_authtoken(token: str) -> None:
    if not token:
        return
        
    token_hash = _hash_token(token)
    user_tokens.delete_one({'authtoken': token_hash})
# --- END AUTHTOKEN SETUP ---

class User(UserMixin):
    def __init__(self, _id, username):
        self.id = str(_id)
        self.username = username

    @classmethod
    def from_dict(cls, data):
        return cls(data["_id"], data["username"])
        
    def __str__(self):
        return f"User(id={self.id}, username={self.username})"
    
@login_manager.user_loader
def load_user(user_id):
    try:
        doc = db.users.find_one({"_id": ObjectId(user_id)})
        if not doc:
            app.logger.warning(f"User not found for ID: {user_id}")
            return None
        return User.from_dict(doc)
    except Exception as e:
        app.logger.error(f"Error loading user: {str(e)}", exc_info=True)
        return None

# Set up logging
if not os.path.exists('logs'):
    os.makedirs('logs')

try:
    file_handler = RotatingFileHandler('logs/app.log', maxBytes=10240, backupCount=10)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))
    file_handler.setLevel(logging.INFO)
    app.logger.addHandler(file_handler)
    app.logger.setLevel(logging.INFO)
    app.logger.info('Application startup')
except Exception as e:
    print(f"Error setting up logging: {e}")
    # Set up simple console logging instead
    logging.basicConfig(level=logging.INFO)

# Import and initialize socket handlers
# from sockets.game_handlers import init_socket_handlers
# init_socket_handlers(socketio, db)

@app.before_request
def log_request():
    ip     = request.remote_addr or '-'
    method = request.method
    path   = request.path
    app.logger.info(f"[{ip}] {method} {path}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.json
        if not data:
            app.logger.error("No JSON data in register request")
            return jsonify({"success": False, "message": "Invalid request format"}), 400
            
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            app.logger.error("Missing username or password in register request")
            return jsonify({"success": False, "message": "Username and password are required"}), 400
        
        # Check if username exists
        if db.users.find_one({"username": username}):
            app.logger.warning(f"Registration failed: Username {username} already exists")
            return jsonify({"success": False, "message": "Username already exists"}), 400
        
        # Hash the password
        try:
            hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        except Exception as e:
            app.logger.error(f"Password hashing error: {str(e)}")
            return jsonify({"success": False, "message": "Registration error"}), 500
        
        # Create user
        user_id = db.users.insert_one({
            "username": username,
            "password": hashed_password
        }).inserted_id
        
        # Generate auth token
        token = create_authtoken(str(user_id))
        
        app.logger.info(f"User {username} registered successfully")
        return jsonify({"success": True, "token": token, "username": username}), 201
    except Exception as e:
        app.logger.error(f"Registration error: {str(e)}", exc_info=True)
        return jsonify({"success": False, "message": "Registration failed, please try again"}), 500

@socketio.on('connect')
def handle_connect():
    app.logger.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info(f"Client disconnected: {request.sid}")
    # Remove user from active_users if they disconnect
    username_to_remove = None
    for username, sid in active_users.items():
        if sid == request.sid:
            username_to_remove = username
            break
    
    if username_to_remove:
        del active_users[username_to_remove]
        # Broadcast updated active users list
        socketio.emit('active_users_update', list(active_users.keys()))

@socketio.on('user_login')
def handle_user_login(data):
    username = data.get('username')
    if username:
        app.logger.info(f"User logged in: {username}")
        active_users[username] = request.sid
        # Broadcast updated active users list
        socketio.emit('active_users_update', list(active_users.keys()))

@socketio.on('user_logout')
def handle_user_logout(data):
    username = data.get('username')
    if username and username in active_users:
        app.logger.info(f"User logged out: {username}")
        del active_users[username]
        # Broadcast updated active users list
        socketio.emit('active_users_update', list(active_users.keys()))

@app.route('/api/active-users')
def get_active_users():
    return jsonify({"users": list(active_users.keys())})

@app.route('/login', methods=['POST', 'GET'])
def login():
    if request.method == 'GET':
        return render_template('index.html')
    
    try:
        data = request.json
        if not data:
            app.logger.error("No JSON data in login request")
            return jsonify({"success": False, "message": "Invalid request format"}), 400
            
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            app.logger.error("Missing username or password in login request")
            return jsonify({"success": False, "message": "Username and password are required"}), 400
        
        app.logger.info(f"Login attempt for user: {username}")
        
        user_doc = db.users.find_one({"username": username})
        if not user_doc:
            app.logger.warning(f"Login failed: User {username} not found")
            return jsonify({"success": False, "message": "Invalid credentials"}), 401
        
        try:
            pw_check = bcrypt.checkpw(password.encode('utf-8'), user_doc["password"])
        except Exception as e:
            app.logger.error(f"Password check error: {str(e)}")
            return jsonify({"success": False, "message": "Authentication error"}), 500
            
        if pw_check:
            user = User.from_dict(user_doc)
            login_user(user)
            token = create_authtoken(str(user_doc["_id"]))
            
            app.logger.info(f"User {username} logged in successfully")
            return jsonify({"success": True, "token": token, "username": username}), 200
        else:
            app.logger.warning(f"Login failed: Invalid password for user {username}")
            return jsonify({"success": False, "message": "Invalid credentials"}), 401
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}", exc_info=True)
        return jsonify({"success": False, "message": "Login failed, please try again"}), 500

@app.route('/logout')
@login_required
def logout():
    try:
        username = current_user.username if current_user else None
        app.logger.info(f"Logout request for user: {username}")
        
        # Get the auth token from the request headers
        auth_header = request.headers.get('Authorization')
        token = None
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
        else:
            # Try to get token from local storage via query param (fallback)
            token = request.args.get('token')
            
        # If we have a token, delete it
        if token:
            delete_authtoken(token)
            app.logger.info(f"Deleted auth token for user: {username}")
        
        # Logout the user with Flask-Login
        logout_user()
        app.logger.info(f"User {username} logged out successfully")
        
        return jsonify({"success": True, "message": "Logged out successfully"}), 200
    except Exception as e:
        app.logger.error(f"Logout error: {str(e)}", exc_info=True)
        return jsonify({"success": False, "message": "Logout failed"}), 500

@app.route('/lobby')
@login_required
def lobby():
    try:
        app.logger.info(f"Lobby accessed by: {current_user.username}")
        
        # Get all available game rooms
        rooms = list(db.rooms.find({}, {"_id": 1, "name": 1, "players": 1, "max_players": 1}))
        
        # Convert ObjectId to string
        for room in rooms:
            room["_id"] = str(room["_id"])
        
        return render_template('lobby.html', rooms=rooms, username=current_user.username)
    except Exception as e:
        app.logger.error(f"Error accessing lobby: {str(e)}", exc_info=True)
        return jsonify({"success": False, "message": "Error accessing lobby"}), 500

@app.route('/create-room', methods=['POST'])
@login_required
def create_room():
    try:
        data = request.json
        room_name = data.get('name')
        max_players = data.get('max_players', 4)
        
        app.logger.info(f"Room creation by {current_user.username}: {room_name}")
        
        # Validate input
        if not room_name:
            return jsonify({"success": False, "message": "Room name is required"}), 400
            
        # Create room
        room_id = db.rooms.insert_one({
            "name": room_name,
            "players": [current_user.username],
            "max_players": max_players,
            "creator": current_user.username,
            "created_at": datetime.datetime.now()
        }).inserted_id
        
        app.logger.info(f"Room created: {room_id}")
        
        # Emit room update event
        socketio.emit('room_update')
        
        return jsonify({"success": True, "room_id": str(room_id)}), 201
    except Exception as e:
        app.logger.error(f"Error creating room: {str(e)}", exc_info=True)
        return jsonify({"success": False, "message": "Error creating room"}), 500

@app.route('/join-room/<room_id>')
@login_required
def join_room_route(room_id):
    try:
        room = db.rooms.find_one({"_id": ObjectId(room_id)})
        if not room:
            return jsonify({"success": False, "message": "Room not found"}), 404
        
        if len(room["players"]) >= room["max_players"]:
            return jsonify({"success": False, "message": "Room is full"}), 400
        
        # Add player to room if not already in
        if current_user.username not in room["players"]:
            db.rooms.update_one(
                {"_id": ObjectId(room_id)},
                {"$addToSet": {"players": current_user.username}}
            )
            
            # Re-fetch room to get updated players list
            room = db.rooms.find_one({"_id": ObjectId(room_id)})
        
        # Send room_update event to refresh room lists in the lobby
        socketio.emit('room_update')
        
        return render_template('game.html', room=room, room_id=room_id, current_user=current_user)
    except Exception as e:
        app.logger.error(f"Error joining room: {str(e)}", exc_info=True)
        return jsonify({"success": False, "message": f"Error joining room: {str(e)}"}), 500

@app.route('/api/auth/check', methods=['GET'])
def check_auth():
    """Check if the current user is authenticated"""
    try:
        # Check login status from Flask-Login first
        if current_user.is_authenticated:
            return jsonify({
                "success": True, 
                "authenticated": True,
                "username": current_user.username
            }), 200
        
        # Check for auth token in headers or params
        auth_header = request.headers.get('Authorization')
        token = None
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
        else:
            # Try to get token from query param
            token = request.args.get('token')
        
        if token and verify_authtoken(token):
            # Get the user ID from the token
            user_id = get_userid_from_token(token)
            if user_id:
                # Get the username from the user ID
                user = db.users.find_one({"_id": ObjectId(user_id)})
                if user:
                    return jsonify({
                        "success": True, 
                        "authenticated": True,
                        "username": user['username']
                    }), 200
        
        # Not authenticated
        return jsonify({
            "success": True, 
            "authenticated": False
        }), 200
    except Exception as e:
        app.logger.error(f"Auth check error: {str(e)}", exc_info=True)
        return jsonify({
            "success": False, 
            "authenticated": False,
            "message": "Error checking authentication status"
        }), 500

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8080, debug=True)