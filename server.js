const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Настройки раундов
const TOTAL_ROUNDS = 10;
const ROUND_TIME = 120; // 2 минуты в секундах
const BREAK_TIME = 10; // перерыв между раундами

// Хранилище игроков
const players = new Map();

// Состояние игры
let gameState = {
    currentRound: 0,
    timeLeft: 0,
    isActive: false,
    isBreak: false,
    roundScores: [] // очки за каждый раунд
};

// Таблица лидеров (лучший улов за всё время)
let leaderboard = [];

// Цвета для игроков
const colors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#e91e63', '#00bcd4'];

let gameTimer = null;

// Обновить таблицу лидеров
function updateLeaderboard(playerName, fish) {
    leaderboard.push({
        name: playerName,
        fish: fish.name,
        emoji: fish.emoji,
        weight: fish.weight,
        time: Date.now()
    });

    leaderboard.sort((a, b) => b.weight - a.weight);
    leaderboard = leaderboard.slice(0, 10);

    io.emit('leaderboardUpdate', leaderboard);
}

// Получить рейтинг раунда
function getRoundRanking() {
    const ranking = Array.from(players.values())
        .map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            roundWeight: p.roundWeight,
            roundFish: p.roundFish
        }))
        .sort((a, b) => b.roundWeight - a.roundWeight);

    return ranking;
}

// Получить общий рейтинг
function getTotalRanking() {
    const ranking = Array.from(players.values())
        .map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            totalWeight: p.totalWeight,
            totalFish: p.fishCount
        }))
        .sort((a, b) => b.totalWeight - a.totalWeight);

    return ranking;
}

// Начать новый раунд
function startRound() {
    gameState.currentRound++;
    gameState.timeLeft = ROUND_TIME;
    gameState.isActive = true;
    gameState.isBreak = false;

    // Сброс очков раунда для всех игроков
    players.forEach(player => {
        player.roundWeight = 0;
        player.roundFish = 0;
    });

    io.emit('roundStart', {
        round: gameState.currentRound,
        totalRounds: TOTAL_ROUNDS,
        timeLeft: gameState.timeLeft
    });

    console.log(`Раунд ${gameState.currentRound} начался!`);
}

// Закончить раунд
function endRound() {
    gameState.isActive = false;

    const ranking = getRoundRanking();

    // Сохраняем результаты раунда
    gameState.roundScores.push({
        round: gameState.currentRound,
        ranking: ranking
    });

    io.emit('roundEnd', {
        round: gameState.currentRound,
        ranking: ranking,
        totalRanking: getTotalRanking()
    });

    console.log(`Раунд ${gameState.currentRound} закончился!`);

    if (gameState.currentRound >= TOTAL_ROUNDS) {
        // Игра окончена
        endGame();
    } else {
        // Перерыв перед следующим раундом
        gameState.isBreak = true;
        gameState.timeLeft = BREAK_TIME;

        io.emit('breakStart', {
            timeLeft: BREAK_TIME,
            nextRound: gameState.currentRound + 1
        });
    }
}

// Закончить игру
function endGame() {
    clearInterval(gameTimer);
    gameTimer = null;

    const finalRanking = getTotalRanking();

    io.emit('gameEnd', {
        ranking: finalRanking,
        winner: finalRanking[0] || null
    });

    console.log('Игра окончена!');

    // Сброс для новой игры через 15 секунд
    setTimeout(() => {
        resetGame();
        if (players.size >= 1) {
            startGame();
        }
    }, 15000);
}

// Сброс игры
function resetGame() {
    gameState = {
        currentRound: 0,
        timeLeft: 0,
        isActive: false,
        isBreak: false,
        roundScores: []
    };

    players.forEach(player => {
        player.fishCount = 0;
        player.totalWeight = 0;
        player.roundWeight = 0;
        player.roundFish = 0;
    });

    io.emit('gameReset');
}

// Запуск игры
function startGame() {
    if (gameTimer) return;

    resetGame();

    // Отсчёт до начала
    gameState.timeLeft = 5;
    io.emit('gameStarting', { countdown: 5 });

    setTimeout(() => {
        startRound();

        gameTimer = setInterval(() => {
            gameState.timeLeft--;

            if (gameState.timeLeft <= 0) {
                if (gameState.isBreak) {
                    startRound();
                } else if (gameState.isActive) {
                    endRound();
                }
            } else {
                io.emit('timeUpdate', {
                    timeLeft: gameState.timeLeft,
                    round: gameState.currentRound,
                    isBreak: gameState.isBreak
                });
            }
        }, 1000);
    }, 5000);
}

io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);

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
            roundWeight: 0,
            roundFish: 0,
            bestCatch: null
        };

        players.set(socket.id, player);

        socket.emit('joined', {
            player: player,
            players: Array.from(players.values()),
            leaderboard: leaderboard,
            gameState: {
                currentRound: gameState.currentRound,
                totalRounds: TOTAL_ROUNDS,
                timeLeft: gameState.timeLeft,
                isActive: gameState.isActive,
                isBreak: gameState.isBreak
            }
        });

        socket.broadcast.emit('playerJoined', player);

        console.log(`${name} присоединился. Всего игроков: ${players.size}`);

        // Запуск игры если достаточно игроков и игра не идёт
        if (players.size >= 1 && !gameTimer) {
            startGame();
        }
    });

    socket.on('cast', (data) => {
        const player = players.get(socket.id);
        if (player) {
            player.x = data.x;
            player.y = data.y;
            player.isFishing = true;

            io.emit('playerCast', {
                id: socket.id,
                x: data.x,
                y: data.y
            });
        }
    });

    socket.on('pulling', (data) => {
        const player = players.get(socket.id);
        if (player) {
            io.emit('playerPulling', {
                id: socket.id,
                name: player.name
            });
        }
    });

    socket.on('caught', (data) => {
        const player = players.get(socket.id);
        if (player && gameState.isActive) {
            player.isFishing = false;

            if (data.fish.name !== 'Старый ботинок') {
                player.fishCount++;
                player.totalWeight += data.fish.weight;
                player.roundFish++;
                player.roundWeight += data.fish.weight;

                if (!player.bestCatch || data.fish.weight > player.bestCatch.weight) {
                    player.bestCatch = data.fish;
                }

                updateLeaderboard(player.name, data.fish);
            }

            io.emit('playerCaught', {
                id: socket.id,
                name: player.name,
                fish: data.fish,
                fishCount: player.fishCount,
                totalWeight: player.totalWeight,
                roundFish: player.roundFish,
                roundWeight: player.roundWeight
            });
        }
    });

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

    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        if (player) {
            console.log(`${player.name} отключился`);
            players.delete(socket.id);
            io.emit('playerLeft', socket.id);

            // Остановить игру если никого нет
            if (players.size === 0 && gameTimer) {
                clearInterval(gameTimer);
                gameTimer = null;
                resetGame();
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
