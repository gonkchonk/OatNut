from flask import Flask, render_template
from flask_socketio import SocketIO
from flask_login import LoginManager
from pymongo import MongoClient
import os
import logging
from logging.handlers import RotatingFileHandler

# Initialize Flask app
app = Flask(__name__, 
    template_folder='../frontend/templates',
    static_folder='../frontend/static'
)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev_key_123')  # Change in production

# Initialize SocketIO
socketio = SocketIO(app)

# Initialize MongoDB
mongo_uri = os.environ.get('MONGODB_URI', 'mongodb://localhost:27017/game_db')
mongo_client = MongoClient(mongo_uri)
db = mongo_client.game_db

# Initialize Login Manager
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'auth.login'

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

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8080, debug=True) 