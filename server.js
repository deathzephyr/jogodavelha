const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors);

// Armazenamento das salas
const rooms = new Map();
const players = new Map();

// Gera código de sala
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Lógica do jogo
class TicTacToeGame {
    constructor() {
        this.board = Array(9).fill('');
        this.currentPlayer = 'X';
        this.players = {};
        this.gameActive = false;
        this.winner = null;
    }

    makeMove(index, playerId) {
        if (this.board[index] !== '' || !this.gameActive) {
            return false;
        }

        const playerSymbol = this.players[playerId].symbol;
        if (playerSymbol !== this.currentPlayer) {
            return false;
        }

        this.board[index] = playerSymbol;
        
        if (this.checkWinner()) {
            this.winner = playerSymbol;
            this.gameActive = false;
            return true;
        }

        if (this.board.every(cell => cell !== '')) {
            this.winner = 'draw';
            this.gameActive = false;
            return true;
        }

        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        return true;
    }

    checkWinner() {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];

        return winPatterns.some(pattern => {
            const [a, b, c] = pattern;
            return this.board[a] && 
                   this.board[a] === this.board[b] && 
                   this.board[a] === this.board[c];
        });
    }

    reset() {
        this.board = Array(9).fill('');
        this.currentPlayer = 'X';
        this.gameActive = true;
        this.winner = null;
    }
}

// Eventos Socket.io
io.on('connection', (socket) => {
    console.log(`Jogador conectado: ${socket.id}`);

    // Criar sala
    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        const game = new TicTacToeGame();
        
        game.players[socket.id] = {
            name: playerName,
            symbol: 'X',
            isHost: true
        };

        rooms.set(roomCode, {
            game: game,
            players: [socket.id]
        });

        socket.join(roomCode);
        players.set(socket.id, { roomCode, playerName });

        socket.emit('roomCreated', {
            roomCode,
            playerSymbol: 'X',
            playerName
        });

        io.to(roomCode).emit('playerJoined', {
            playerName,
            playerCount: 1
        });
    });

    // Entrar em sala
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', 'Sala não encontrada');
            return;
        }

        if (room.players.length >= 2) {
            socket.emit('error', 'Sala cheia');
            return;
        }

        room.game.players[socket.id] = {
            name: playerName,
            symbol: 'O',
            isHost: false
        };

        room.players.push(socket.id);
        socket.join(roomCode);
        players.set(socket.id, { roomCode, playerName });

        // Iniciar jogo
        room.game.gameActive = true;

        socket.emit('roomJoined', {
            roomCode,
            playerSymbol: 'O',
            playerName,
            opponentName: room.game.players[room.players[0]].name
        });

        // Notificar o outro jogador
        socket.to(roomCode).emit('opponentJoined', {
            opponentName: playerName
        });

        // Enviar estado inicial
        io.to(roomCode).emit('gameState', {
            board: room.game.board,
            currentPlayer: room.game.currentPlayer,
            gameActive: room.game.gameActive,
            players: room.game.players
        });
    });

    // Fazer jogada
    socket.on('makeMove', (index) => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room) return;

        const game = room.game;
        const moveSuccess = game.makeMove(index, socket.id);

        if (moveSuccess) {
            io.to(playerData.roomCode).emit('moveMade', {
                index,
                player: game.players[socket.id].symbol,
                board: game.board,
                currentPlayer: game.currentPlayer,
                gameActive: game.gameActive
            });

            if (!game.gameActive) {
                let winnerName = null;
                if (game.winner !== 'draw') {
                    const winnerId = Object.keys(game.players).find(
                        id => game.players[id].symbol === game.winner
                    );
                    winnerName = game.players[winnerId].name;
                }

                io.to(playerData.roomCode).emit('gameOver', {
                    winner: game.winner,
                    winnerName,
                    board: game.board
                });
            }
        }
    });

    // Reiniciar jogo
    socket.on('resetGame', () => {
        const playerData = players.get(socket.id);
        if (!playerData) return;

        const room = rooms.get(playerData.roomCode);
        if (!room) return;

        room.game.reset();

        io.to(playerData.roomCode).emit('gameReset', {
            board: room.game.board,
            currentPlayer: room.game.currentPlayer,
            gameActive: room.game.gameActive
        });
    });

    // Desconexão
    socket.on('disconnect', () => {
        console.log(`Jogador desconectado: ${socket.id}`);
        
        const playerData = players.get(socket.id);
        if (playerData) {
            const room = rooms.get(playerData.roomCode);
            if (room) {
                socket.to(playerData.roomCode).emit('playerDisconnected', {
                    playerName: playerData.playerName
                });

                room.players = room.players.filter(id => id !== socket.id);
                
                if (room.players.length === 0) {
                    rooms.delete(playerData.roomCode);
                } else {
                    room.game.gameActive = false;
                }
            }
            
            players.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Abra: http://localhost:${PORT}`);
});
