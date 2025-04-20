from flask import Flask, render_template, request
from flask_socketio import SocketIO
from flask_login import LoginManager, UserMixin
from pymongo import MongoClient
from bson.objectid import ObjectId
import os
import logging
from logging.handlers import RotatingFileHandler
import hashlib
import random
import string


# Initialize Flask app
app = Flask(__name__, 
    template_folder='../frontend/templates',
    static_folder='../frontend/static'
)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev_key_123')  # Change in production

# Initialize SocketIO
socketio = SocketIO(app)

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
login_manager.login_view = 'auth.login'

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

@app.before_request
def log_request():
    ip     = request.remote_addr or '-'
    method = request.method
    path   = request.path
    app.logger.info(f"[{ip}] {method} {path}")

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8080, debug=True)