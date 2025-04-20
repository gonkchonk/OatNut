from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_socketio import SocketIO
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

# Initialize SocketIO with gevent
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent')

mongo_uri = os.environ.get('MONGODB_URI', 'mongodb://localhost:27017/game_db')
mongo_client = MongoClient(mongo_uri)
db = mongo_client.game_db

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

# Initialize Login Manager
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

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
if not os.path.exists('../logs'):
    os.makedirs('../logs')

file_handler = RotatingFileHandler('../logs/game.log', maxBytes=10240, backupCount=10)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
))
file_handler.setLevel(logging.INFO)
app.logger.addHandler(file_handler)
app.logger.setLevel(logging.INFO)
app.logger.info('Game startup')

# Import and initialize socket handlers
from sockets.game_handlers import init_socket_handlers
init_socket_handlers(socketio, db)

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
    
    return render_template('lobby.html', rooms=rooms)

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

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8080, debug=True)