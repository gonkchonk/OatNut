import os
import logging
import traceback
import json
import random
from datetime import datetime
from flask import (
    Flask, render_template, request, jsonify,
    session, send_from_directory
)
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin, login_user,
    login_required, logout_user, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

# ─── BASIC SETUP ────────────────────────────────────────────────────────────────

# Create logs & uploads directories if not exist
os.makedirs('logs', exist_ok=True)
os.makedirs('uploads', exist_ok=True)

# Main application logger
logger = logging.getLogger('app')
logger.setLevel(logging.INFO)
file_handler = logging.FileHandler('logs/app.log')
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s - %(levelname)s - %(message)s'
))
logger.addHandler(file_handler)

# Raw HTTP request/response logger
raw_logger = logging.getLogger('raw')
raw_logger.setLevel(logging.INFO)
raw_handler = logging.FileHandler('logs/http.log')
raw_handler.setFormatter(logging.Formatter(
    '%(asctime)s - %(message)s'
))
raw_logger.addHandler(raw_handler)

app = Flask(__name__)
app.config.update({
    'SECRET_KEY': os.environ.get('SECRET_KEY', 'your-secret-key-here'),
    'SQLALCHEMY_DATABASE_URI': os.environ.get(
        'DATABASE_URL',
        'postgresql://postgres:postgres@db:5432/gridgame'
    ),
    'SQLALCHEMY_TRACK_MODIFICATIONS': False,
    'UPLOAD_FOLDER': 'uploads',
    'MAX_CONTENT_LENGTH': 16 * 1024 * 1024,  # 16MB
    'SESSION_COOKIE_HTTPONLY': True,          # HttpOnly cookie
})

socketio = SocketIO(app, cors_allowed_origins="*")
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}


# ─── HTTP REQUEST/RESPONSE LOGGING ─────────────────────────────────────────────

# ─── REQUEST/RESPONSE LOGGING ────────────────────────────────────────────────
@app.before_request
def log_request():
    request.start_time = datetime.utcnow()
    ip   = request.remote_addr
    user = current_user.username if current_user.is_authenticated else None

    # prepare headers without auth tokens
    headers = dict(request.headers)
    # remove Authorization and session/authtoken cookies
    headers.pop('Authorization', None)
    if 'Cookie' in headers:
        parts = headers['Cookie'].split('; ')
        parts = [c for c in parts
                 if not c.startswith('session=') and not c.startswith('authtoken=')]
        headers['Cookie'] = '; '.join(parts)

    raw_logger.info(f"REQ {request.method} {request.path} from={ip} user={user} headers={headers}")

    # Only log bodies for non-login/register and text content
    if request.data and request.mimetype.startswith('text') \
       and request.path not in ['/login', '/register']:
        body = request.get_data(as_text=True)[:2048]
        raw_logger.info(f"REQ BODY: {body}")


@app.after_request
def log_response(response):
    ip   = request.remote_addr
    user = current_user.username if current_user.is_authenticated else None
    duration = (datetime.utcnow() - request.start_time).total_seconds()

    # Main app.log: include response.status (e.g. "200 OK")
    logger.info(f"{ip} user={user} {request.method} {request.path} -> {response.status} ({duration:.3f}s)")

    # Raw response log
    headers = dict(response.headers)
    headers.pop('Authorization', None)
    if 'Set-Cookie' in headers:
        # strip auth cookies from Set-Cookie
        cookies = headers['Set-Cookie'].split('; ')
        cookies = [c for c in cookies if not c.startswith('session=') and not c.startswith('authtoken=')]
        headers['Set-Cookie'] = '; '.join(cookies)
    raw_logger.info(f"RES {response.status} headers={headers}")

    if not response.direct_passthrough and response.mimetype.startswith('text'):
        data = response.get_data(as_text=True)[:2048]
        raw_logger.info(f"RES BODY: {data}")

    return response


@app.errorhandler(Exception)
def handle_exception(e):
    tb = traceback.format_exc()
    ip   = request.remote_addr
    user = current_user.username if current_user.is_authenticated else None
    logger.error(f"Exception on {request.method} {request.path} from={ip} user={user}\n{tb}")
    return jsonify({'error': 'Internal server error'}), 500


# ─── DATABASE MODELS ───────────────────────────────────────────────────────────

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(512), nullable=False)
    avatar = db.Column(db.String(200))
    position = db.Column(db.String(50), default='{"x": 0, "y": 0}')
    health = db.Column(db.Integer, default=100)
    score = db.Column(db.Integer, default=0)
    lifetime_score = db.Column(db.Integer, default=0)
    kills = db.Column(db.Integer, default=0)
    deaths = db.Column(db.Integer, default=0)
    wins = db.Column(db.Integer, default=0)
    current_lobby = db.Column(db.Integer, db.ForeignKey('lobby.id'), nullable=True)
    achievements = db.relationship('UserAchievement', backref='user', lazy=True)

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'avatar': self.avatar,
            'score': self.lifetime_score,
            'kills': self.kills,
            'deaths': self.deaths,
            'wins': self.wins
        }


class Lobby(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    max_players = db.Column(db.Integer, default=4)
    players = db.relationship('User', backref='lobby', lazy=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Achievement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    description = db.Column(db.String(200), nullable=False)
    requirement = db.Column(db.String(50), nullable=False)
    icon = db.Column(db.String(200))


class UserAchievement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    achievement_id = db.Column(db.Integer, db.ForeignKey('achievement.id'), nullable=False)
    achieved_at = db.Column(db.DateTime, default=datetime.utcnow)
    achievement = db.relationship('Achievement', backref='user_achievements', lazy=True)


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# ─── FLASK ROUTES ──────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    # never log data.get('password')

    if User.query.filter_by(username=username).first():
        logger.info(f"register FAIL username={username} — already exists")
        return jsonify({'error': 'Username already exists'}), 400

    user = User(username=username)
    user.set_password(data.get('password'))
    db.session.add(user)
    db.session.commit()
    logger.info(f"register SUCCESS username={username}")
    return jsonify({'message': 'Registration successful'}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    # do NOT log the password

    user = User.query.filter_by(username=username).first()
    if not user:
        logger.warning(f"login FAIL username={username} — user not found")
        return jsonify({'error': 'Invalid username or password'}), 401

    if not user.check_password(data.get('password')):
        logger.warning(f"login FAIL username={username} — wrong password")
        return jsonify({'error': 'Invalid username or password'}), 401

    login_user(user)
    db.session.commit()
    logger.info(f"login SUCCESS username={username}")
    return jsonify({'message': 'Login successful'}), 200


@app.route('/logout')
@login_required
def logout():
    username = current_user.username
    logout_user()
    logger.info(f"logout username={username}")
    return jsonify({'message': 'Logout successful'}), 200


@app.route('/upload_avatar', methods=['POST'])
@login_required
def upload_avatar():
    if 'avatar' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['avatar']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(f"{current_user.id}_{file.filename}")
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        current_user.avatar = filename
        db.session.commit()
        logger.info(f"avatar UPLOAD username={current_user.username} file={filename}")
        return jsonify({'message': 'Avatar uploaded successfully', 'filename': filename})
    return jsonify({'error': 'Invalid file type'}), 400


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/leaderboard')
def leaderboard():
    users = User.query.order_by(User.lifetime_score.desc()).limit(10).all()
    return jsonify([u.to_dict() for u in users])


@app.route('/lobbies')
@login_required
def get_lobbies():
    lobbies = Lobby.query.all()
    return jsonify([
        {
            'id': l.id,
            'name': l.name,
            'player_count': len(l.players),
            'max_players': l.max_players
        } for l in lobbies
    ])


@app.route('/lobbies', methods=['POST'])
@login_required
def create_lobby():
    data = request.get_json()
    name = data.get('name')
    max_players = data.get('max_players', 4)
    lobby = Lobby(name=name, max_players=max_players)
    db.session.add(lobby)
    db.session.commit()
    return jsonify({
        'id': lobby.id,
        'name': lobby.name,
        'max_players': lobby.max_players
    }), 201


@app.route('/achievements')
def get_achievements():
    achs = Achievement.query.all()
    achieved_ids = []
    if current_user.is_authenticated:
        achieved_ids = [
            ua.achievement_id
            for ua in UserAchievement.query.filter_by(user_id=current_user.id)
        ]
    return jsonify([
        {
            'id': a.id,
            'name': a.name,
            'description': a.description,
            'icon': a.icon,
            'achieved': a.id in achieved_ids
        } for a in achs
    ])


# ─── SOCKET.IO EVENTS ──────────────────────────────────────────────────────────

game_state = {'lobbies': {}}
attack_timestamps = {}

@socketio.on('connect')
def handle_connect():
    if not current_user.is_authenticated:
        return
    logger.info(f"Socket CONNECT username={current_user.username}")
    if current_user.current_lobby:
        room = f"lobby_{current_user.current_lobby}"
        join_room(room)
        if current_user.current_lobby not in game_state['lobbies']:
            game_state['lobbies'][current_user.current_lobby] = {'players': {}}
        game_state['lobbies'][current_user.current_lobby]['players'][current_user.id] = {
            'username': current_user.username,
            'avatar': current_user.avatar,
            'position': json.loads(current_user.position),
            'health': current_user.health,
            'lifetime_score': current_user.lifetime_score,
            'wins': current_user.wins
        }
        emit('player_joined', {
            'players': game_state['lobbies'][current_user.current_lobby]['players'],
            'current_user_id': current_user.id
        }, room=room)

@socketio.on('disconnect')
def handle_disconnect():
    if not current_user.is_authenticated or not current_user.current_lobby:
        return
    room = f"lobby_{current_user.current_lobby}"
    logger.info(f"Socket DISCONNECT username={current_user.username} room={room}")
    leave_room(room)
    lobby = game_state['lobbies'].get(current_user.current_lobby, {})
    lobby.get('players', {}).pop(current_user.id, None)
    emit('player_left', {'player_id': current_user.id}, room=room)

@socketio.on('join_lobby')
def handle_join_lobby(data):
    if not current_user.is_authenticated:
        logging.warning('Socket join_lobby: user not authenticated')
        emit('join_error', {'error': 'Not authenticated'})
        return
    
    lobby_id = data.get('lobby_id')
    logging.info(f"Join attempt by {current_user.username} (ID: {current_user.id}) to lobby {lobby_id}")
    
    lobby = Lobby.query.get(lobby_id)
    if not lobby:
        logging.warning(f'Socket join_lobby: lobby {lobby_id} not found')
        emit('join_error', {'error': 'Lobby not found'})
        return
    
    if len(lobby.players) >= lobby.max_players:
        logging.info(f'Socket join_lobby: lobby {lobby_id} full')
        emit('join_error', {'error': 'Lobby is full'})
        return
    
    if current_user.current_lobby:
        logging.info(f"Player {current_user.username} leaving lobby {current_user.current_lobby}")
        leave_room(f'lobby_{current_user.current_lobby}')
        if current_user.current_lobby in game_state['lobbies']:
            if current_user.id in game_state['lobbies'][current_user.current_lobby]['players']:
                del game_state['lobbies'][current_user.current_lobby]['players'][current_user.id]
                logging.info(f"Removed player from old lobby state")
    
    current_user.current_lobby = lobby_id
    db.session.commit()
    join_room(f'lobby_{lobby_id}')
    
    if lobby_id not in game_state['lobbies']:
        game_state['lobbies'][lobby_id] = {'players': {}}
    
    # Re-sync all player positions from the database
    lobby_users = User.query.filter_by(current_lobby=lobby_id).all()
    game_state['lobbies'][lobby_id]['players'] = {}
    for user in lobby_users:
        game_state['lobbies'][lobby_id]['players'][user.id] = {
            'username': user.username,
            'avatar': user.avatar,
            'position': json.loads(user.position),
            'health': user.health,
            'lifetime_score': user.lifetime_score,
            'wins': user.wins
        }
    
    logging.info(f'User {current_user.username} joined lobby {lobby_id}')
    logging.info(f"Updated lobby state: {json.dumps(game_state['lobbies'][lobby_id])}")
    emit('player_joined', {'players': game_state['lobbies'][lobby_id]['players'], 'current_user_id': current_user.id}, room=f'lobby_{lobby_id}')

@socketio.on('move')
def handle_move(data):
    if current_user.is_authenticated and current_user.current_lobby:
        lobby_id = current_user.current_lobby
        if lobby_id in game_state['lobbies']:
            new_pos = data['position']
            # Re-sync all player positions from the database
            lobby_users = User.query.filter_by(current_lobby=lobby_id).all()
            occupied = {(json.loads(user.position)['x'], json.loads(user.position)['y']) for user in lobby_users if user.id != current_user.id}
            # Only allow move if the cell is not occupied
            if (new_pos['x'], new_pos['y']) in occupied:
                return  # Block the move, do not update position
            current_user.position = json.dumps(new_pos)
            db.session.commit()
            # Re-sync all player positions from the database
            lobby_users = User.query.filter_by(current_lobby=lobby_id).all()
            game_state['lobbies'][lobby_id]['players'] = {}
            for user in lobby_users:
                game_state['lobbies'][lobby_id]['players'][user.id] = {
                    'username': user.username,
                    'avatar': user.avatar,
                    'position': json.loads(user.position),
                    'health': user.health,
                    'lifetime_score': user.lifetime_score
                }
            emit('player_moved', {
                'players': game_state['lobbies'][lobby_id]['players'],
                'player_id': current_user.id,
                'position': new_pos
            }, room=f'lobby_{lobby_id}')
        else:
            logging.error(f"Lobby {lobby_id} not found in game state!")

@socketio.on('attack')
def handle_attack(data):
    if not (current_user.is_authenticated and current_user.current_lobby):
        return

    lobby_id = current_user.current_lobby
    if lobby_id not in game_state['lobbies']:
        return

    lobby_players = game_state['lobbies'][lobby_id]['players']
    attacker_pos = json.loads(current_user.position)
    hit_player_id = None

    # Check for hits
    for pid, player in lobby_players.items():
        if int(pid) != current_user.id:
            player_pos = player['position']
            if (abs(player_pos['x'] - attacker_pos['x']) <= 1 and 
                abs(player_pos['y'] - attacker_pos['y']) <= 1):
                hit_player_id = int(pid)
                break

    if hit_player_id:
        target = User.query.get(hit_player_id)
        if target:
            damage = 20
            target.health -= damage

            if target.health <= 0:
                # Update both current game score and lifetime score
                current_user.kills += 1
                current_user.score += 100
                current_user.lifetime_score += 100
                target.deaths += 1
                target.health = 100

                # respawn...
                grid_w, grid_h = 20, 15
                taken = {(p['position']['x'], p['position']['y'])
                         for pid, p in lobby_players.items() if int(pid) != hit_player_id}
                empty = [(x, y) for x in range(grid_w) for y in range(grid_h)
                         if (x, y) not in taken]
                rx, ry = (random.choice(empty) if empty else (0, 0))
                target.position = json.dumps({'x': rx, 'y': ry})
                lobby_players[hit_player_id]['position'] = {'x': rx, 'y': ry}

                check_achievements(current_user)

                # --- WIN CONDITION: first to 10 kills ---
                if current_user.kills >= 10:
                    current_user.wins += 1
                    current_user.lifetime_score += 500  # Bonus points for winning
                    db.session.commit()
                    # Reset only the current game scores, not lifetime scores
                    for pid, p in lobby_players.items():
                        user = User.query.get(int(pid))
                        user.kills = 0
                        user.score = 0
                        db.session.commit()
                    emit('game_won', {'winner': current_user.username}, room=f'lobby_{lobby_id}')

            db.session.commit()

            # Update defender stats
            emit('player_stats_updated', {
                'player_id': hit_player_id,
                'health': target.health,
                'kills': target.kills,
                'deaths': target.deaths,
                'lifetime_score': target.lifetime_score,
                'wins': target.wins,
                'position': json.loads(target.position)
            }, room=f'lobby_{lobby_id}')

            # Update attacker stats
            emit('player_stats_updated', {
                'player_id': current_user.id,
                'health': current_user.health,
                'kills': current_user.kills,
                'deaths': current_user.deaths,
                'lifetime_score': current_user.lifetime_score,
                'wins': current_user.wins
            }, room=f'lobby_{lobby_id}')

    # always broadcast the attack animation
    emit('attack_launched', {
        'player_id':   current_user.id,
        'attack_type': 'melee',
        'position':    attacker_pos
    }, room=f'lobby_{lobby_id}')

@socketio.on('player_hit')
def handle_player_hit(data):
    if current_user.is_authenticated and current_user.current_lobby:
        target_id = data.get('target_id')
        damage = data.get('damage', 10)
        
        target = User.query.get(target_id)
        if target:
            target.health -= damage
            if target.health <= 0:
                current_user.kills += 1
                current_user.score += 100
                target.deaths += 1
                target.health = 100
                
                # Check for achievements
                check_achievements(current_user)
            
            db.session.commit()
            
            emit('player_stats_updated', {
                'player_id': target_id,
                'health': target.health,
                'kills': current_user.kills,
                'deaths': target.deaths,
                'score': current_user.score
            }, room=f'lobby_{current_user.current_lobby}')

@socketio.on('leave_lobby')
def handle_leave_lobby():
    if not (current_user.is_authenticated and current_user.current_lobby):
        return

    lobby_id = current_user.current_lobby
    room_name = f'lobby_{lobby_id}'

    # remove them from the room state
    leave_room(room_name)
    if lobby_id in game_state['lobbies']:
        game_state['lobbies'][lobby_id]['players'].pop(current_user.id, None)

    # clear their current_lobby in DB
    current_user.current_lobby = None
    db.session.commit()

    # tell everyone else they left
    emit('player_left', {'player_id': current_user.id}, room=room_name)

def check_achievements(user):
    achievements = Achievement.query.all()
    for achievement in achievements:
        if not UserAchievement.query.filter_by(user_id=user.id, achievement_id=achievement.id).first():
            if achievement.requirement == 'kills_10' and user.kills >= 10:
                unlock_achievement(user, achievement)
            elif achievement.requirement == 'wins_5' and user.wins >= 5:
                unlock_achievement(user, achievement)
            elif achievement.requirement == 'score_1000' and user.score >= 1000:
                unlock_achievement(user, achievement)

def unlock_achievement(user, achievement):
    user_achievement = UserAchievement(user_id=user.id, achievement_id=achievement.id)
    db.session.add(user_achievement)
    db.session.commit()
    
    emit('achievement_unlocked', {
        'name': achievement.name,
        'description': achievement.description,
        'icon': achievement.icon
    }, room=f'lobby_{user.current_lobby}')


# ─── APP STARTUP ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # Create default achievements if needed…
        if not Achievement.query.first():
            defaults = [
                Achievement(name='Killer', description='Get 10 kills', requirement='kills_10', icon='killer.png'),
                Achievement(name='Champion', description='Win 5 games', requirement='wins_5', icon='champion.png'),
                Achievement(name='Master', description='Reach 1000 points', requirement='score_1000', icon='master.png')
            ]
            db.session.add_all(defaults)
            db.session.commit()

    socketio.run(app, host='0.0.0.0', port=8080, debug=True, allow_unsafe_werkzeug=True)