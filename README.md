# Super Smash Bros-like MMO Game

A multiplayer online game built with Flask, WebSocket, and MongoDB.

## Setup

1. Make sure you have Docker installed
3. Run `docker compose up` in the root directory
4. Visit `http://localhost:8080` in your browser

## Development

The project structure is organized as follows:

```
.
├── backend/               # Flask backend
│   ├── __pycache__
│   ├── app.py            # Main Flask application
│   ├── models/           # Database models
│   ├── routes/           # API routes
│   ├── sockets/          # WebSocket handlers
│   └── utils/            # Utility functions
├── frontend/             # Frontend assets
│   ├── static/           # Static files (CSS, JS)
│   │   ├── css/
│   │   ├── js/
│   │   └── assets/      # Game assets (sprites, sounds)
│   └── templates/        # Jinja2 templates
├── logs/                 # Application logs
├── docker-compose.yml    # Docker compose configuration
├── Dockerfile           # Docker configuration
├── requirements.txt     # Python dependencies
└── README.md           
```
