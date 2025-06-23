/**
 @type{{
  resetButton: HTMLButtonElement,
  players: HTMLUListElement,
 }}
 */
const DOM = {
  resetButton: document.getElementById("reset"),
  players: document.getElementById("players"),
};

let ws = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectDelay = 1000; // Start with 1 second
let reconnectTimer = null;
let isConnected = false;
let playerList = [];
let buzzedPlayers = new Set();

function showConnectionStatus(status, message) {
  // Remove any existing status indicator
  const existingStatus = document.getElementById("connection-status");
  if (existingStatus) {
    existingStatus.remove();
  }

  // Create new status indicator
  const statusDiv = document.createElement("div");
  statusDiv.id = "connection-status";
  statusDiv.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    border-radius: 5px;
    font-weight: bold;
    z-index: 1000;
    ${status === 'connected' ? 'background: #4CAF50; color: white;' : 
      status === 'disconnected' ? 'background: #f44336; color: white;' : 
      'background: #ff9800; color: white;'}
  `;
  statusDiv.textContent = message;
  document.body.appendChild(statusDiv);

  // Auto-hide success messages
  if (status === 'connected') {
    setTimeout(() => {
      if (statusDiv.parentNode) {
        statusDiv.remove();
      }
    }, 3000);
  }
}

function updatePlayerDisplay() {
  DOM.players.innerHTML = '';
  
  // Sort players: buzzed players first (in order they buzzed), then unbuzzed players
  const buzzedPlayersList = Array.from(buzzedPlayers);
  const unbuzzedPlayers = playerList.filter(player => !buzzedPlayers.has(player.uuid));
  
  // Add buzzed players first
  buzzedPlayersList.forEach((uuid, index) => {
    const player = playerList.find(p => p.uuid === uuid);
    if (player) {
      const li = document.createElement("li");
      li.className = "player buzzed";
      li.title = player.uuid;
      
      const nameSpan = document.createElement("span");
      nameSpan.className = "player-name";
      nameSpan.textContent = player.name;
      
      const buzzIndicator = document.createElement("span");
      buzzIndicator.className = "buzz-indicator";
      buzzIndicator.textContent = `#${index + 1}`;
      
      li.appendChild(nameSpan);
      li.appendChild(buzzIndicator);
      DOM.players.appendChild(li);
    }
  });
  
  // Add unbuzzed players
  unbuzzedPlayers.forEach(player => {
    const li = document.createElement("li");
    li.className = "player";
    li.title = player.uuid;
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name";
    nameSpan.textContent = player.name;
    
    li.appendChild(nameSpan);
    DOM.players.appendChild(li);
  });
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    console.info("WebSocket connected!");
    isConnected = true;
    reconnectAttempts = 0;
    reconnectDelay = 1000;
    
    showConnectionStatus('connected', 'Host connected!');
  };

  ws.onclose = (event) => {
    console.warn("WebSocket disconnected!", event.code, event.reason);
    isConnected = false;
    
    // Don't show disconnected message if this was intentional
    if (event.code !== 1000) {
      showConnectionStatus('disconnected', 'Connection lost. Attempting to reconnect...');
      attemptReconnect();
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    isConnected = false;
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log("Host received:", message);

    switch (message.type) {
      case "buzz": {
        buzzedPlayers.add(message.user.uuid);
        updatePlayerDisplay();
        break;
      }
      case "playerListUpdate": {
        playerList = message.players;
        updatePlayerDisplay();
        break;
      }
    }
  };
}

function attemptReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  if (reconnectAttempts >= maxReconnectAttempts) {
    showConnectionStatus('disconnected', 'Failed to reconnect. Please refresh the page.');
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(reconnectDelay * Math.pow(1.5, reconnectAttempts - 1), 30000);
  
  showConnectionStatus('reconnecting', `Reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
  
  reconnectTimer = setTimeout(() => {
    if (!isConnected) {
      connectWebSocket();
    }
  }, delay);
}

DOM.resetButton.onclick = () => {
  if (ws && ws.readyState == WebSocket.OPEN) {
    const uuids = playerList.map(player => player.uuid);
    const data = JSON.stringify({ "type": "unlock", "who": uuids });
    ws.send(data);
    buzzedPlayers.clear();
    updatePlayerDisplay();
  }
};

// Initialize connection when page loads
connectWebSocket();

// Handle page visibility changes to reconnect when tab becomes active
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !isConnected) {
    attemptReconnect();
  }
});

// Handle online/offline events
window.addEventListener('online', () => {
  if (!isConnected) {
    setTimeout(() => attemptReconnect(), 1000);
  }
});

window.addEventListener('offline', () => {
  showConnectionStatus('disconnected', 'You are offline');
});