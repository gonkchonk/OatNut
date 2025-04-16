# OatNut

**OatNut** is a real-time MMO game project built with **Flask** (Python) and **Flask-SocketIO**.  
It uses **Docker Compose** to run both the web server and a database in separate containers.

## Project Structure
OatNut/
├─ app/
│  ├─ init.py     # Initializes Flask & SocketIO
│  ├─ models/         # Database models & schemas
│  ├─ routes/         # Flask “blueprints” for HTTP endpoints (login, register, etc.)
│  ├─ socket/         # SocketIO event handlers for real-time game logic
│  └─ templates/      # HTML templates (e.g., index.html)
├─ logs/              # Stores application logs outside the Docker container
├─ .env               # Environment variables (DB connection strings, secrets)
├─ .gitignore         # Files and folders for Git to ignore
├─ docker-compose.yml # Defines our Docker services (Flask + DB)
├─ Dockerfile         # Instructions for building the Flask app container
├─ requirements.txt   # Python dependencies (Flask, Flask-SocketIO, etc.)
├─ run.py             # Entry point to run the Flask + SocketIO server
└─ README.md 
### **`app/` Folder**

- **`__init__.py`**  
  This is where we create and configure the Flask app. We also initialize SocketIO (`socketio.init_app(app)`) so our server supports real-time connections.

- **`models/`**  
  Holds any database model code or schema definitions (e.g., a `User` model).

- **`routes/`**  
  Contains Python files with Flask route definitions (`auth.py`, `game.py`, etc.).  
  - For instance, you might have `/register` and `/login` routes in an `auth.py` blueprint.

- **`socket/`**  
  Houses **SocketIO** event-handler files. For example, `game_events.py` might listen for `'move'` events or `'attack'` events and broadcast updated states to all connected players.

- **`templates/`**  
  A directory for HTML template files served by Flask. Right now it has `index.html`, which could be the main page or the game canvas. If you add more pages, they go here.

### **`logs/` Folder**

A local directory for storing server logs. By mapping it as a volume in Docker, you can review your logs even after containers shut down. This includes:
- **app.log** for request/response logs
- **errors.log** for error stack traces
- Possibly a **raw traffic** log if required

### **Other Root Files**

- **`.env`**  
  Where you’ll keep environment-specific variables like `SECRET_KEY`, database credentials, etc. Make sure `.env` is in `.gitignore` so sensitive info isn’t committed.

- **`.gitignore`**  
  Tells Git which files/folders to skip in commits (e.g., `__pycache__`, `.env`, log files, etc.).

- **`docker-compose.yml`**  
  Defines our **services**:
  1. The Flask app container (based on the `Dockerfile`).
  2. A database container (MongoDB/Postgres) with volumes.  
  You’ll run your app using `docker compose up` on port 8080.

- **`Dockerfile`**  
  Tells Docker how to build the Flask app image (install dependencies from `requirements.txt`, copy code, etc.).

- **`requirements.txt`**  
  Lists Python packages needed (Flask, Flask-SocketIO, eventlet or gevent, database drivers, etc.).

- **`run.py`**  
  A simple Python script to import your `create_app()` function and run `socketio.run(app, host="0.0.0.0", port=8080)` so the server listens on port 8080.

---

## How to Use

1. **Install Docker** on your machine (Mac/Windows/Linux).
2. **Clone the Repo**:
   ```bash
   git clone https://github.com/YourTeam/OatNut.git
   cd OatNut