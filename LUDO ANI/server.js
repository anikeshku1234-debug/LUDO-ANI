const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORS enabled taaki frontend kisi bhi URL ya phone browser se connect ho sake
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Port Render ya hosting provider ke environment ke hisab se set hota hai
const PORT = process.env.PORT || 3000;

// Chaaro classic Ludo colours
const COLORS = [
    { name: 'Red', hex: '#dc2626' },
    { name: 'Green', hex: '#16a34a' },
    { name: 'Yellow', hex: '#ca8a04' },
    { name: 'Blue', hex: '#2563eb' }
];

// Active rooms storage: { [roomCode]: { players: [], turnIndex: 0, started: false } }
const rooms = {};

io.on('connection', (socket) => {
    // 1. Join ya Create Room
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const code = roomCode.trim().toUpperCase();
        const name = playerName.trim();

        if (!code || !name) {
            socket.emit('errorMsg', 'Room code aur naam dono zaroori hain!');
            return;
        }

        if (!rooms[code]) {
            rooms[code] = { players: [], turnIndex: 0, started: false };
        }

        const room = rooms[code];

        if (room.players.length >= 4) {
            socket.emit('errorMsg', 'Yeh room full ho chuka hai (Max 4 players)!');
            return;
        }

        if (room.started) {
            socket.emit('errorMsg', 'Game pehle hi start ho chuka hai!');
            return;
        }

        // Assign color based on player count order (0: Red, 1: Green, 2: Yellow, 3: Blue)
        const assignedColor = COLORS[room.players.length];
        const newPlayer = {
            id: socket.id,
            name: name,
            color: assignedColor.name,
            colorHex: assignedColor.hex
        };

        room.players.push(newPlayer);
        socket.join(code);

        io.to(code).emit('roomUpdate', {
            players: room.players,
            roomCode: code
        });
    });

    // 2. Start Game (Min 2, Max 4 players)
    socket.on('startGame', (roomCode) => {
        const code = roomCode.trim().toUpperCase();
        const room = rooms[code];

        if (!room) return;

        if (room.players.length < 2) {
            socket.emit('errorMsg', 'Game start karne ke liye kam se kam 2 players chahiye!');
            return;
        }

        room.started = true;
        room.turnIndex = 0;

        io.to(code).emit('gameStarted', {
            players: room.players,
            currentTurn: room.players[0]
        });
    });

    // 3. Roll Dice (Server-controlled true random 1-6)
    socket.on('rollDice', (roomCode) => {
        const code = roomCode.trim().toUpperCase();
        const room = rooms[code];

        if (!room || !room.started) return;

        const currentTurnPlayer = room.players[room.turnIndex];

        if (socket.id !== currentTurnPlayer.id) {
            socket.emit('errorMsg', 'Abhi aapki turn nahi hai! Intezar karein.');
            return;
        }

        // Server generates a fair random roll
        const diceValue = Math.floor(Math.random() * 6) + 1;

        // Rule: Agar 6 aaye toh same player ki turn rehti hai, warna agle player ko milti hai
        if (diceValue !== 6) {
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
        }

        io.to(code).emit('diceRolled', {
            rolledBy: currentTurnPlayer,
            value: diceValue,
            nextTurn: room.players[room.turnIndex]
        });
    });

    // 4. Disconnect handling
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            const index = room.players.findIndex((p) => p.id === socket.id);

            if (index !== -1) {
                room.players.splice(index, 1);

                if (room.players.length === 0) {
                    delete rooms[code];
                } else {
                    // Adjust turnIndex if needed
                    if (room.turnIndex >= room.players.length) {
                        room.turnIndex = 0;
                    }
                    io.to(code).emit('roomUpdate', {
                        players: room.players,
                        roomCode: code
                    });
                }
                break;
            }
        }
    });
});

app.get('/', (req, res) => {
    res.send('Ludo Server Active and Running!');
});

server.listen(PORT, () => {
    console.log(`Ludo server is live on port ${PORT}`);
});