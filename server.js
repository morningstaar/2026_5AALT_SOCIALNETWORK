const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    console.log('Un appareil est connecté');
    
    socket.on('sensor_data', (data) => {
        socket.broadcast.emit('sensor_data', data);
    });
});

http.listen(3000, () => console.log('Serveur sur port 3000'));
