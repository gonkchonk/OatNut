from flask import current_app, request
from flask_socketio import emit, join_room as socket_join_room, leave_room as socket_leave_room
from bson.objectid import ObjectId
import logging

# Initialize logger
logger = logging.getLogger(__name__)

# Store active player positions
player_positions = {}
# Store room_id -> [socket_ids]
room_players = {}

def init_socket_handlers(socketio, db):
    """Initialize all socket event handlers"""
    
    @socketio.on('connect')
    def handle_connect():
        logger.info(f"Client connected: {request.sid}")
    
    @socketio.on('disconnect')
    def handle_disconnect():
        logger.info(f"Client disconnected: {request.sid}")
        # Remove player from any rooms they were in
        for room_id, players in room_players.items():
            if request.sid in players:
                room_players[room_id].remove(request.sid)
                # Notify other players
                emit('player_left', {
                    'sid': request.sid
                }, room=room_id)
    
    @socketio.on('join_room')
    def handle_join_room(data):
        """Handle a player joining a game room"""
        room_id = data.get('room_id')
        username = data.get('username')
        
        if not room_id or not username:
            return
        
        # Join the socket.io room
        socket_join_room(room_id)
        
        # Initialize player position at a random location
        import random
        player_positions[username] = {
            'x': random.randint(50, 750),
            'y': 0
        }
        
        # Add to room players
        if room_id not in room_players:
            room_players[room_id] = []
        room_players[room_id].append(request.sid)
        
        # Get all players in the room from database
        room = db.rooms.find_one({"_id": ObjectId(room_id)})
        if not room:
            return
        
        # Notify all clients in the room
        emit('player_joined', {
            'username': username,
            'position': player_positions[username],
            'players': room['players']
        }, room=room_id)
        
        # Send current game state to the new player
        players_in_room = {}
        for player in room['players']:
            if player in player_positions:
                players_in_room[player] = player_positions[player]
            else:
                players_in_room[player] = {
                    'x': random.randint(50, 750),
                    'y': 0
                }
                
        emit('game_state', {
            'players': players_in_room
        })
        
        logger.info(f"Player {username} joined room {room_id}")
    
    @socketio.on('leave_room')
    def handle_leave_room(data):
        """Handle a player leaving a game room"""
        room_id = data.get('room_id')
        username = data.get('username')
        
        if not room_id or not username:
            return
        
        # Leave the socket.io room
        socket_leave_room(room_id)
        
        # Remove from room players
        if room_id in room_players and request.sid in room_players[room_id]:
            room_players[room_id].remove(request.sid)
        
        # Remove from database
        db.rooms.update_one(
            {"_id": ObjectId(room_id)},
            {"$pull": {"players": username}}
        )
        
        # Check if room is empty
        room = db.rooms.find_one({"_id": ObjectId(room_id)})
        if room and len(room['players']) == 0:
            # Delete empty room
            db.rooms.delete_one({"_id": ObjectId(room_id)})
        
        # Notify all clients in the room
        emit('player_left', {
            'username': username,
            'players': room['players'] if room else []
        }, room=room_id)
        
        # Update lobby with new room list
        emit('room_update', {}, broadcast=True)
        
        logger.info(f"Player {username} left room {room_id}")
    
    @socketio.on('player_move')
    def handle_player_move(data):
        """Handle player movement updates"""
        room_id = data.get('room_id')
        username = data.get('username')
        position = data.get('position')
        
        if not room_id or not username or not position:
            return
        
        # Update player position
        player_positions[username] = position
        
        # Broadcast to all players in the room
        emit('player_moved', {
            'username': username,
            'position': position
        }, room=room_id)
    
    # Add more game-specific event handlers here (attacks, items, etc.) 