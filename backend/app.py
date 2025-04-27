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

# Initialize SocketIO with cors_allowed_origins="*" to allow all origins
socketio = SocketIO(app, cors_allowed_origins="*", logger=True, engineio_logger=True)

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
        
        # Join the socket room
        join_room(room_id)
        
        # Initialize game state for the room if it doesn't exist
        if room_id not in game_states:
            game_states[room_id] = {
                'players': {},
                'active': True
            }
        
        # Add player to game state
        game_states[room_id]['players'][username] = {
            'x': 400,
            'y': 500,
            'score': 0
        }
        
        # Update room in database
        db.rooms.update_one(
            {"_id": ObjectId(room_id)},
            {"$addToSet": {"players": username}}
        )
        
        # Emit game state to all players in the room
        socketio.emit('game_state', {
            'players': game_states[room_id]['players']
        }, room=room_id)
        
        app.logger.info(f"Current game state: {game_states[room_id]}")
        
    except Exception as e:
        app.logger.error(f"Error in handle_join_room: {str(e)}")

@socketio.on('player_move')
def handle_player_move(data):
    try:
        room_id = data['room_id']
        username = data['username']
        position = data['position']
        
        if room_id in game_states and username in game_states[room_id]['players']:
            # Update player position
            game_states[room_id]['players'][username].update(position)
            # Broadcast updated game state to all players in the room
            socketio.emit('game_state', {
                'players': game_states[room_id]['players']
            }, room=room_id)
            
    except Exception as e:
        app.logger.error(f"Error in handle_player_move: {str(e)}")

@socketio.on('player_attack')
def handle_player_attack(data):
    room, attacker = data['room_id'], data['username']
    state = game_states.get(room)
    if not state or not state['active']: return

    state['players'][attacker]['score'] += 1

    if state['players'][attacker]['score'] >= 5:
        state['active'] = False
        socketio.emit('game_over', {
            'winner': attacker,
            'finalScores': {
                u: info['score']
                for u, info in state['players'].items()
            }
        }, room=room)
    else:
        socketio.emit('game_state', state, room=room)


# --- AUTHTOKEN SETUP ---
user_tokens = db.user_authtokens
user_tokens.create_index('userid')

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_authtoken(userid: str) -> str:
    token = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
    user_tokens.insert_one({
        'userid':    userid,
        'authtoken': _hash_token(token)
    })
    return token


def verify_authtoken(token: str) -> bool:
    return user_tokens.find_one({'authtoken': _hash_token(token)}) is not None


def delete_authtoken(token: str) -> None:
    user_tokens.delete_one({'authtoken': _hash_token(token)})
# --- END AUTHTOKEN SETUP ---

class User(UserMixin):
    def __init__(self, _id, username):
        self.id = str(_id)
        self.username = username

    @classmethod
    def from_dict(cls, data):
        return cls(data["_id"], data["username"])
    
@login_manager.user_loader
def load_user(user_id):
    doc = db.users.find_one({"_id": ObjectId(user_id)})
    if not doc:
        return None
    return User.from_dict(doc)

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
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    # Check if username exists
    if db.users.find_one({"username": username}):
        return jsonify({"success": False, "message": "Username already exists"}), 400
    
    # Hash the password
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
    
    # Create user
    user_id = db.users.insert_one({
        "username": username,
        "password": hashed_password
    }).inserted_id
    
    # Generate auth token
    token = create_authtoken(str(user_id))
    
    return jsonify({"success": True, "token": token, "username": username}), 201

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
        # For redirects from @login_required, just render the index page
        return render_template('index.html')
    
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    # Find user
    user_doc = db.users.find_one({"username": username})
    if not user_doc:
        return jsonify({"success": False, "message": "Invalid credentials"}), 401
    
    # Check password
    if bcrypt.checkpw(password.encode('utf-8'), user_doc["password"]):
        # Create user object
        user = User.from_dict(user_doc)
        
        # Login user
        login_user(user)
        
        # Generate auth token
        token = create_authtoken(str(user_doc["_id"]))
        
        return jsonify({"success": True, "token": token, "username": username}), 200
    
    return jsonify({"success": False, "message": "Invalid credentials"}), 401

@app.route('/logout')
@login_required
def logout():
    # User is already logged out by Flask-Login's logout_user
    logout_user()
    return jsonify({"success": True})

@app.route('/lobby')
@login_required
def lobby():
    # Get all available game rooms
    rooms = list(db.rooms.find({}, {"_id": 1, "name": 1, "players": 1, "max_players": 1}))
    
    # Convert ObjectId to string
    for room in rooms:
        room["_id"] = str(room["_id"])
    
    return render_template('lobby.html', rooms=rooms, username=current_user.username)

@app.route('/create-room', methods=['POST'])
@login_required
def create_room():
    data = request.json
    room_name = data.get('name')
    max_players = data.get('max_players', 4)
    
    room_id = db.rooms.insert_one({
        "name": room_name,
        "players": [current_user.username],
        "max_players": max_players,
        "creator": current_user.username
    }).inserted_id
    
    return jsonify({"success": True, "room_id": str(room_id)})

@app.route('/join-room/<room_id>')
@login_required
def join_room(room_id):
    room = db.rooms.find_one({"_id": ObjectId(room_id)})
    if not room:
        return jsonify({"success": False, "message": "Room not found"}), 404
    
    if len(room["players"]) >= room["max_players"]:
        return jsonify({"success": False, "message": "Room is full"}), 400
    
    # Add player to room if not already in
    if current_user.username not in room["players"]:
        db.rooms.update_one(
            {"_id": ObjectId(room_id)},
            {"$push": {"players": current_user.username}}
        )
    
    return render_template('game.html', room=room, room_id=room_id)

@app.route('/api/rooms')
@login_required
def get_rooms():
    # Get all available game rooms
    rooms = list(db.rooms.find({}, {"_id": 1, "name": 1, "players": 1, "max_players": 1}))
    
    # Convert ObjectId to string
    for room in rooms:
        room["_id"] = str(room["_id"])
    
    return jsonify({"success": True, "rooms": rooms})

@socketio.on('leave_room')
def handle_leave_room(data):
    try:
        room_id = data['room_id']
        username = data['username']
        
        app.logger.info(f"Player {username} leaving room {room_id}")
        
        # Remove player from game state
        if room_id in game_states and username in game_states[room_id]['players']:
            del game_states[room_id]['players'][username]
            
            # If room is empty, clean it up
            if not game_states[room_id]['players']:
                del game_states[room_id]
                # Also remove from database
                db.rooms.delete_one({"_id": ObjectId(room_id)})
            else:
                # Broadcast updated game state to remaining players
                socketio.emit('game_state', game_states[room_id], room=room_id)
        
        # Leave the socket room
        leave_room(room_id)
        
        # Notify others about the player leaving
        remaining_players = list(game_states[room_id]['players'].keys()) if room_id in game_states else []
        socketio.emit('player_left', {
            'username': username,
            'players': remaining_players
        }, room=room_id)
        
        app.logger.info(f"Player {username} successfully left room {room_id}")
        
    except Exception as e:
        app.logger.error(f"Error in handle_leave_room: {str(e)}")
        emit('error', {'message': 'Error leaving room'})

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8080, debug=True)