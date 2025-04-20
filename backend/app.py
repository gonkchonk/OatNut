import os
import re
import logging
import hashlib
import random
import string
from logging.handlers import RotatingFileHandler
from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    make_response
)
from flask_socketio import SocketIO
from flask_login import (
    LoginManager,
    UserMixin,
    login_user,
    logout_user,
    current_user
)
from pymongo import MongoClient
from bson.objectid import ObjectId
from werkzeug.security import generate_password_hash, check_password_hash

# ─── Flask app setup ───────────────────────────────────────────────────────────
app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static"
)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev_key_123")

socketio = SocketIO(app)

mongo_uri    = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/game_db")
mongo_client = MongoClient(mongo_uri)
db           = mongo_client.game_db

# ─── Auth‑token setup ──────────────────────────────────────────────────────────
user_tokens = db.user_authtokens
user_tokens.create_index("userid")

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def create_authtoken(userid: str) -> str:
    token = "".join(random.choices(string.ascii_letters + string.digits, k=32))
    user_tokens.insert_one({
        "userid":    userid,
        "authtoken": _hash_token(token)
    })
    return token

def verify_authtoken(token: str) -> bool:
    return user_tokens.find_one({"authtoken": _hash_token(token)}) is not None

def delete_authtoken(token: str) -> None:
    user_tokens.delete_one({"authtoken": _hash_token(token)})

# ─── Flask-Login setup ────────────────────────────────────────────────────────
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "auth.login"

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

# ─── Logging setup ─────────────────────────────────────────────────────────────
log_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../logs"))
os.makedirs(log_dir, exist_ok=True)

handler = RotatingFileHandler(
    os.path.join(log_dir, "game.log"),
    maxBytes=10_240,
    backupCount=10
)
handler.setFormatter(logging.Formatter(
    "%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]"
))
handler.setLevel(logging.INFO)
app.logger.addHandler(handler)
app.logger.setLevel(logging.INFO)
app.logger.info("Game startup")

@app.before_request
def log_request():
    ip     = request.remote_addr or "-"
    method = request.method
    path   = request.path
    app.logger.info(f"[{ip}] {method} {path}")

# ─── Registration endpoint ────────────────────────────────────────────────────
@app.route("/register", methods=["POST"])
def register():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    # validate
    if not username or not email or not password:
        return jsonify({"error": "Missing username, email, or password"}), 400

    if (
        len(password) < 8 or
        not re.search(r"[A-Z]", password) or
        not re.search(r"[a-z]", password) or
        not re.search(r"[0-9]", password) or
        not re.search(r"[^A-Za-z0-9]", password)
    ):
        return jsonify({
            "error":
            "Password must be ≥8 chars, include uppercase, lowercase, number & special char"
        }), 400

    if db.user_collection.find_one({"username": username}) or \
       db.user_collection.find_one({"email": email}):
        return jsonify({"error": "Username or email already taken"}), 400

    pw_hash = generate_password_hash(password)
    res     = db.user_collection.insert_one({
        "username": username,
        "email":    email,
        "password": pw_hash
    })
    user_id = str(res.inserted_id)
    app.logger.info(f"New user registered: {username} ({email}) id={user_id}")

    token = create_authtoken(user_id)
    app.logger.info(f"Authtoken generated for {username}")

    resp = make_response(jsonify({"username": username}), 201)
    resp.set_cookie("authtoken", token, httponly=True)
    return resp

# ─── Login endpoint ────────────────────────────────────────────────────────────
@app.route("/login", methods=["POST"])
def login():
    data     = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Missing username or password"}), 400

    user_doc = db.user_collection.find_one({"username": username})
    if not user_doc or not check_password_hash(user_doc["password"], password):
        app.logger.info(f"Failed login for {username} from {request.remote_addr}")
        return jsonify({"error": "Invalid credentials"}), 401

    user = User.from_dict(user_doc)
    login_user(user)
    token = create_authtoken(user.id)
    app.logger.info(f"User {username} logged in, authtoken issued")

    resp = make_response(jsonify({"username": username}))
    resp.set_cookie("authtoken", token, httponly=True)
    return resp

# ─── Logout endpoint ───────────────────────────────────────────────────────────
@app.route("/logout", methods=["POST"])
def logout():
    token = request.cookies.get("authtoken", "")
    if token:
        delete_authtoken(token)
    logout_user()
    resp = make_response(jsonify({"message": "Logged out"}))
    resp.delete_cookie("authtoken")
    return resp

# ─── Main page ─────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8080, debug=True)