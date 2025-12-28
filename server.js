const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище игроков
const players = new Map();

// Таблица лидеров (лучший улов)
let leaderboard = [];

// Цвета для игроков
const colors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#e91e63', '#00bcd4'];

// Обновить таблицу лидеров
function updateLeaderboard(playerName, fish) {
    // Добавляем новый улов
    leaderboard.push({
        name: playerName,
        fish: fish.name,
        emoji: fish.emoji,
        weight: fish.weight,
        time: Date.now()
    });

    // Сортируем по весу (лучшие сверху)
    leaderboard.sort((a, b) => b.weight - a.weight);

    // Оставляем только топ-10
    leaderboard = leaderboard.slice(0, 10);

    // Отправляем всем обновлённую таблицу
    io.emit('leaderboardUpdate', leaderboard);
}

io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);

    // Новый игрок
    socket.on('join', (name) => {
        const color = colors[players.size % colors.length];
        const player = {
            id: socket.id,
            name: name || 'Рыбак',
            color: color,
            x: 0,
            y: 0,
            isFishing: false,
            fishCount: 0,
            totalWeight: 0,
            bestCatch: null
        };

        players.set(socket.id, player);

        // Отправляем игроку его данные и список всех игроков
        socket.emit('joined', {
            player: player,
            players: Array.from(players.values()),
            leaderboard: leaderboard
        });

        // Сообщаем всем о новом игроке
        socket.broadcast.emit('playerJoined', player);

        console.log(`${name} присоединился. Всего игроков: ${players.size}`);
    });

    // Игрок забросил удочку
    socket.on('cast', (data) => {
        const player = players.get(socket.id);
        if (player) {
            player.x = data.x;
            player.y = data.y;
            player.isFishing = true;

            // Сообщаем всем
            io.emit('playerCast', {
                id: socket.id,
                x: data.x,
                y: data.y
            });
        }
    });

    // Игрок начал вытаскивать (мини-игра)
    socket.on('pulling', (data) => {
        const player = players.get(socket.id);
        if (player) {
            io.emit('playerPulling', {
                id: socket.id,
                name: player.name
            });
        }
    });

    // Игрок поймал рыбу
    socket.on('caught', (data) => {
        const player = players.get(socket.id);
        if (player) {
            player.isFishing = false;
            player.fishCount = data.fishCount;
            player.totalWeight = data.totalWeight;

            // Обновляем лучший улов игрока
            if (!player.bestCatch || data.fish.weight > player.bestCatch.weight) {
                player.bestCatch = data.fish;
            }

            // Обновляем таблицу лидеров (только для настоящей рыбы)
            if (data.fish.name !== 'Старый ботинок') {
                updateLeaderboard(player.name, data.fish);
            }

            // Сообщаем всем
            io.emit('playerCaught', {
                id: socket.id,
                name: player.name,
                fish: data.fish,
                fishCount: data.fishCount,
                totalWeight: data.totalWeight
            });
        }
    });

    // Игрок не поймал (провалил мини-игру или сорвалось)
    socket.on('missed', (data) => {
        const player = players.get(socket.id);
        if (player) {
            player.isFishing = false;
            io.emit('playerMissed', {
                id: socket.id,
                name: player.name,
                reason: data?.reason || 'escaped'
            });
        }
    });

    // Запрос таблицы лидеров
    socket.on('getLeaderboard', () => {
        socket.emit('leaderboardUpdate', leaderboard);
    });

    // Отключение
    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        if (player) {
            console.log(`${player.name} отключился`);
            players.delete(socket.id);
            io.emit('playerLeft', socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
