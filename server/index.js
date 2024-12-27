const WebSocket = require('ws');
const service = require('./data');

const originalLog = console.log;
console.log = function() {
  const date = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}`;
  
  originalLog.apply(console, [`[${timestamp}]`, ...arguments]);
};

// 接收启动参数作为端口号，默认8081
const PORT = process.argv[2] || 8081;
const server = new WebSocket.Server({ port: PORT });

const SEND_TYPE_REG = '1001'; // 注册后发送用户id
const SEND_TYPE_ROOM_INFO = '1002'; // 发送房间信息
const SEND_TYPE_JOINED_ROOM = '1003'; // 加入房间后的通知，比如对于新进用户，Ta需要开始连接其他人
const SEND_TYPE_NEW_CANDIDATE = '1004'; // offer
const SEND_TYPE_NEW_CONNECTION = '1005'; // new connection
const SEND_TYPE_CONNECTED = '1006'; // new connection

const RECEIVE_TYPE_NEW_CANDIDATE = '9001'; // offer
const RECEIVE_TYPE_NEW_CONNECTION = '9002'; // new connection
const RECEIVE_TYPE_CONNECTED = '9003'; // joined
const RECEIVE_TYPE_KEEPALIVE = '9999'; // keep-alive


console.log(`Signaling server running on ws://localhost:${PORT}`);

server.on('connection', (socket, request) => {
  var ip = request.headers['x-forwarded-for'] ?? request.headers['x-real-ip'] ?? socket._socket.remoteAddress.split("::ffff:").join("");
  const currentId = service.registerUser(ip, socket);
  // 向客户端发送自己的id(ws1001)
  socketSend_UserId(socket, currentId);

  console.log(`${currentId}@${ip} connected`);

  service.getUserList(ip).forEach(user => {
    // ws1002
    socketSend_RoomInfo(user.socket, ip);
  });

  // ws1003
  socketSend_JoinedRoom(socket, currentId);

  socket.on('message', (msg, isBinary) => {
    const msgStr = msg.toString();
    if (!msgStr || msgStr.length > 1024 * 10) {
      return;
    }
    let message = null;
    try {
      message = JSON.parse(msgStr);
    } catch (e) {
      console.error('Invalid JSON', msgStr);
      message = null;
    }

    const { uid, targetId, type, data } = message;
    if (!type || !uid || !targetId) {
      return;
    }

    if (type === '1007') {
      // 客户端发送的内网IP地址
      const { localIP } = data;
      service.updateUserIP(currentId, localIP);
      console.log(`Updated IP for ${currentId}: ${localIP}`);
    }
    
    const me = service.getUser(ip, uid)
    const target = service.getUser(ip, targetId)
    if (!me || !target) {
      return;
    }

    if (type === RECEIVE_TYPE_NEW_CANDIDATE) {
      socketSend_Candidate(target.socket, { targetId: uid, candidate: data.candidate });
      return;
    }
    if (type === RECEIVE_TYPE_NEW_CONNECTION) {
      socketSend_ConnectInvite(target.socket, { targetId: uid, offer: data.targetAddr });
      return;
    }
    if (type === RECEIVE_TYPE_CONNECTED) {
      socketSend_Connected(target.socket, { targetId: uid, answer: data.targetAddr });
      return;
    }
    if (type === RECEIVE_TYPE_KEEPALIVE) {
      return;
    }
    
  });

  socket.on('close', () => {
    service.unregisterUser(ip, currentId);
    service.getUserList(ip).forEach(user => {
      socketSend_RoomInfo(user.socket, ip);
    });
    console.log(`${currentId}@${ip} disconnected`);
  });

  socket.on('error', () => {
    service.unregisterUser(ip, currentId);
    service.getUserList(ip).forEach(user => {
      socketSend_RoomInfo(user.socket, ip);
    });
    console.log(`${currentId}@${ip} disconnected`);
  });
});




function send(socket, type, data) {
  socket.send(JSON.stringify({ type, data }));
}

function socketSend_UserId(socket, id) {
  send(socket, SEND_TYPE_REG, { id });
}
function socketSend_RoomInfo(socket, ip, currentId) {
  const result = service.getUserList(ip).map(user => ({ id: user.id }));
  send(socket, SEND_TYPE_ROOM_INFO, result);
}
function socketSend_JoinedRoom(socket, id) {
  send(socket, SEND_TYPE_JOINED_ROOM, { id });
}

function socketSend_Candidate(socket, data) {
  send(socket, SEND_TYPE_NEW_CANDIDATE, data);
}

function socketSend_ConnectInvite(socket, data) {
  send(socket, SEND_TYPE_NEW_CONNECTION, data);
}

function socketSend_Connected(socket, data) {
  send(socket, SEND_TYPE_CONNECTED, data);
}
