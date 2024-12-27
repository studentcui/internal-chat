const wsUrl = 'wss://iciouds.co/ws';

var users = [];
var me = new XChatUser();

// 添加当前传输用户的引用
let currentTransferUser = null;

function setRemote() {
  me.setRemoteSdp(remoteSDP.value);
}
function addLinkItem(uid, file) {
  const chatBox = document.querySelector('.chat-wrapper');
  const chatItem = document.createElement('div');
  chatItem.className = 'chat-item';
  chatItem.innerHTML = `
    <div class="chat-item_user">${uid === me.id ? '（我）': ''}${uid} :</div>
    <div class="chat-item_content"><a class="file" href="${file.url}" download="${file.name}">[文件] ${file.name}</a></div>
  `;
  chatBox.appendChild(chatItem);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function addChatItem(uid, message) {
  const chatBox = document.querySelector('.chat-wrapper');
  const chatItem = document.createElement('div');
  chatItem.className = 'chat-item';
  let msg = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 判断是否url，兼容端口号的网址,http://127.0.0.1:8080/
  if (/(http|https):\/\/[a-zA-Z0-0-9\.\-\/\?=\:_]+/g.test(msg)) {
    msg = msg.replace(/(http|https):\/\/[a-zA-Z0-0-9\.\-\/\?=\:_]+/g, (url) => {
      return `<a href="${url}" target="_blank">${url}</a>`;
    });
  }

  chatItem.innerHTML = `
    <div class="chat-item_user">${uid === me.id ? '（我）': ''}${uid} :
      <svg class="copy-icon" viewBox="0 0 24 24" width="16" height="16" title="复制">
        <path fill="currentColor" d="M19,21H9C7.9,21,7,20.1,7,19V7H9V19H19V21M16,3H5C3.9,3,3,3.9,3,5V17H5V5H16V3Z" />
      </svg>
    </div>
    <div class="chat-item_content">
      <pre>${msg}</pre>
    </div>
  `;
  console.log('Appending chat item:', chatItem.innerHTML); // 调试日志
  chatBox.appendChild(chatItem);
  chatBox.scrollTop = chatBox.scrollHeight;

  // 添加复制功能
  const copyIcon = chatItem.querySelector('.copy-icon');
  console.log('Copy icon:', copyIcon); // 调试日志
  copyIcon.addEventListener('click', () => {
    navigator.clipboard.writeText(message).then(() => {
      alert('消息已复制到剪贴板');
    }).catch(err => {
      console.error('复制失败:', err);
    });
  });
}

function sendMessage(msg) {
  const message = msg ?? messageInput.value;
  addChatItem(me.id, message);
  users.forEach(u => {
    if (u.isMe) {
      return;
    }
    u.sendMessage(message);
  });
  messageInput.value = '';
}

async function sendFile(file) {
  pendingFile = file;
  
  const otherUsers = users.filter(u => !u.isMe);
  
  if (otherUsers.length === 1) {
    const modal = document.getElementById('userSelectModal');
    const progressContainer = modal.querySelector('.progress-container');
    const progressBar = modal.querySelector('.progress-bar-inner');
    const progressText = modal.querySelector('.progress-text');
    
    try {
      const user = otherUsers[0];
      currentTransferUser = user; // 保存当前传输用户的引用
      const fileInfo = { name: file.name, size: file.size };
      
      // 显示进度条
      modal.style.display = 'block';
      document.getElementById('userSelectList').style.display = 'none';
      modal.querySelector('.modal-footer').style.display = 'block';
      modal.querySelector('.modal-footer button:last-child').style.display = 'none';
      progressContainer.style.display = 'block';
      
      // 创建进度回调
      const onProgress = (sent, total) => {
        const progress = (sent / total) * 100;
        progressBar.style.width = progress + '%';
        // 计算传输速度
        const speed = sent / (Date.now() - startTime) * 1000; // 字节/秒
        const speedText = speed > 1024 * 1024 
          ? `${(speed / (1024 * 1024)).toFixed(2)} MB/s`
          : `${(speed / 1024).toFixed(2)} KB/s`;
        progressText.textContent = `正在发送给 ${user.id}... ${speedText}`;
      };
      
      const startTime = Date.now();
      await user.sendFile(fileInfo, file, onProgress);
      addChatItem(me.id, `[文件] ${fileInfo.name} (发送给: ${user.id})`);
    } catch (error) {
      console.error('发送文件失败:', error);
      alert('发送文件失败，请重试');
    } finally {
      currentTransferUser = null; // 清除当前传输用户的引用
      // 恢复界面状态
      modal.style.display = 'none';
      document.getElementById('userSelectList').style.display = 'block';
      modal.querySelector('.modal-footer').style.display = 'block';
      modal.querySelector('.modal-footer button:last-child').style.display = 'inline-block';
      progressContainer.style.display = 'none';
      progressBar.style.width = '0%';
    }
    
    pendingFile = null;
    return;
  }
  
  showUserSelectModal();
}
function registCandidate() {
  for (const ca of JSON.parse(candidate.value)) {
    me.addIceCandidate(ca);
  }
}


function connectAllOther() {
  if (users.length <= 1) {
    return;
  }
  const targets = users.filter(u => u.id !== me.id);
  for (const target of targets) {
    target.onicecandidate = (candidate) => {
      // console.log('candidate', candidate);
      signalingServer.send(JSON.stringify({uid: me.id, targetId: target.id, type: '9001', data: { candidate }}));
    }
    target.createConnection().then(() => {
      // console.log('targetAddr', target.connAddressMe);
      signalingServer.send(JSON.stringify({uid: me.id, targetId: target.id, type: '9002', data: { targetAddr: target.connAddressMe }}));
    })
  }
}


function refreshUsers(data) {
  resUsers = data.map(
    u => {
      let uOld = users.find(uOld => uOld.id === u.id)
      if (uOld) {
        return uOld;
      }
      let xchatUser = new XChatUser();
      xchatUser.id = u.id;
      xchatUser.isMe = u.id === me.id;
      return xchatUser;
    }
  );

  // 找出删除的用户
  const delUsers = users.filter(u => !resUsers.find(u2 => u2.id === u.id));
  delUsers.forEach(u => {
    u.closeConnection();
  });

  users = resUsers;
  for (const u of users) {
    u.onmessage = (msg) => {
      addChatItem(u.id, msg);
    }
    u.onReviceFile = (file) => {
      addLinkItem(u.id, file);
    }
  }
  refreshUsersHTML();
}

function joinedRoom() {
  connectAllOther();
}

function addCandidate(data) {
  users.find(u => u.id === data.targetId).addIceCandidate(data.candidate);
}
async function joinConnection(data) {
  const user = users.find(u => u.id === data.targetId)
  if (!user) {
    return;
  }
  user.onicecandidate = (candidate) => {
    // console.log('candidate', candidate);
    signalingServer.send(JSON.stringify({uid: me.id, targetId: user.id, type: '9001', data: { candidate }}));
  }
  await user.connectTarget(data.offer.sdp)
  signalingServer.send(JSON.stringify({uid: me.id, targetId: user.id, type: '9003', data: { targetAddr: user.connAddressMe }}));
}

async function joinedConnection(data) {
  const target = users.find(u => u.id === data.targetId)
  if (!target) {
    return;
  }
  await target.setRemoteSdp(data.answer.sdp);
}

function refreshUsersHTML() {
  document.querySelector('#users').innerHTML = users.map(u => `<li>${u.id}${u.isMe?'（我）':''}</li>`).join('');
}

function enterTxt(event) {
  if (event.ctrlKey || event.shiftKey) {
    return;
  }
  if (event.keyCode === 13) {
    sendMessage();
    event.preventDefault();
  }
}

// 获取内网IP地址
async function getLocalIP() {
  return new Promise((resolve, reject) => {
    const peerConnection = new RTCPeerConnection({ iceServers: [] });
    peerConnection.createDataChannel('');
    peerConnection.createOffer().then(offer => peerConnection.setLocalDescription(offer));
    peerConnection.onicecandidate = event => {
      if (event && event.candidate && event.candidate.candidate) {
        const candidate = event.candidate.candidate;
        const ipMatch = candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
        if (ipMatch) {
          resolve(ipMatch[0]);
          peerConnection.close();
        }
      }
    };
  });
}

// 连接信令服务器
const signalingServer = new WebSocket(wsUrl);
signalingServer.onopen = async () => {
  console.log('Connected to signaling server');
  setInterval(() => {
    signalingServer.send(JSON.stringify({type: '9999'}));
  }, 1000 * 10);

  // 获取内网IP地址并发送给服务端
  const localIP = await getLocalIP();
  signalingServer.send(JSON.stringify({ type: '1007', data: { localIP } }));
};

signalingServer.onmessage = ({ data: responseStr }) => {
  const response = JSON.parse(responseStr);
  const { type, data } = response;


  if (type === '1001') {
    me.id = data.id;
    return;
  }
  if (type === '1002') {
    refreshUsers(data);
    return;
  }
  if (type === '1003') {
    joinedRoom()
    return;
  }
  if (type === '1004') {
    addCandidate(data);
    return;
  }
  if (type === '1005') {
    joinConnection(data);
    return;
  }
  if (type === '1006') {
    joinedConnection(data);
    return;
  }
}

function showUserSelectModal() {
  const modal = document.getElementById('userSelectModal');
  const userList = document.getElementById('userSelectList');
  
  // 清空之前的列表
  userList.innerHTML = '';
  
  // 添加用户选项
  users.forEach(user => {
    if (!user.isMe) {
      const item = document.createElement('div');
      item.className = 'user-select-item';
      const id = `user-${user.id}`;
      
      // 不使用 label 的 for 属性，改用包裹的方式
      item.innerHTML = `
        <label>
          <input type="checkbox" value="${user.id}">
          <span>${user.id}</span>
        </label>
      `;
      
      // 点击整行时切换复选框状态
      item.addEventListener('click', (e) => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        // 如果点击的是复选框本身，不需要额外处理
        if (e.target === checkbox) return;
        
        checkbox.checked = !checkbox.checked;
        e.preventDefault(); // 阻止事件冒泡
      });
      
      userList.appendChild(item);
    }
  });
  
  modal.style.display = 'block';
}

function cancelSendFile() {
  if (currentTransferUser) {
    currentTransferUser.cancelTransfer();
  }
  const modal = document.getElementById('userSelectModal');
  modal.style.display = 'none';
  pendingFile = null;
  currentTransferUser = null;
}

async function confirmSendFile() {
  const modal = document.getElementById('userSelectModal');
  const sendButton = modal.querySelector('.modal-footer button:last-child');
  const progressContainer = modal.querySelector('.progress-container');
  const progressBar = modal.querySelector('.progress-bar-inner');
  const progressText = modal.querySelector('.progress-text');
  const userList = document.getElementById('userSelectList');
  const selectedUsers = Array.from(document.querySelectorAll('#userSelectList input[type="checkbox"]:checked'))
    .map(checkbox => users.find(u => u.id === checkbox.value));
  
  if (selectedUsers.length > 0 && pendingFile) {
    sendButton.disabled = true;
    sendButton.textContent = '发送中...';
    userList.style.display = 'none';
    progressContainer.style.display = 'block';
    
    try {
      const fileInfo = { name: pendingFile.name, size: pendingFile.size };
      const totalUsers = selectedUsers.length;
      const startTime = Date.now();
      
      for (let i = 0; i < selectedUsers.length; i++) {
        const user = selectedUsers[i];
        progressText.textContent = `正在发送给 ${user.id}... (${i + 1}/${totalUsers})`;
        
        const onProgress = (sent, total) => {
          const userProgress = (sent / total) * 100;
          const totalProgress = ((i * 100) + userProgress) / totalUsers;
          progressBar.style.width = totalProgress + '%';
          // 计算传输速度
          const speed = sent / (Date.now() - startTime) * 1000; // 字节/秒
          const speedText = speed > 1024 * 1024 
            ? `${(speed / (1024 * 1024)).toFixed(2)} MB/s`
            : `${(speed / 1024).toFixed(2)} KB/s`;
          progressText.textContent = `正在发送给 ${user.id}... (${i + 1}/${totalUsers}) ${speedText}`;
        };
        
        await user.sendFile(fileInfo, pendingFile, onProgress);
      }
      
      addChatItem(me.id, `[文件] ${fileInfo.name} (发送给: ${selectedUsers.map(u => u.id).join(', ')})`);
    } catch (error) {
      console.error('发送文件失败:', error);
      alert('发送文件失败，请重试');
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = '发送';
      userList.style.display = 'block';
      progressContainer.style.display = 'none';
      progressBar.style.width = '0%';
    }
  }
  
  modal.style.display = 'none';
  pendingFile = null;
}


let droptarget = document.body;
    
async function handleEvent(event) {
  event.preventDefault();
  if (event.type === 'drop') {
    droptarget.classList.remove('dragover');
    if (event.dataTransfer.files.length > 0) {
      await sendFile(event.dataTransfer.files[0]);
    }
  } else if (event.type === 'dragleave') {
    droptarget.classList.remove('dragover');
  } else {
    droptarget.classList.add('dragover');
  }
}

droptarget.addEventListener("dragenter", handleEvent);
droptarget.addEventListener("dragover", handleEvent);
droptarget.addEventListener("drop", handleEvent);
droptarget.addEventListener("dragleave", handleEvent);

document.querySelector('.file-btn').addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async (e) => {
    if (e.target.files.length > 0) {
      await sendFile(e.target.files[0]);
    }
  };
  input.click();
});

document.querySelector('.send-btn').addEventListener('click', () => {
  if (messageInput.value.trim()) {  // 只有当消息不为空时才发送
    sendMessage();
  }
});