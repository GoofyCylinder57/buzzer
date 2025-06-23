/**
 @type{{
  resetButton: HTMLButtonElement,
  buzzedInQueue: HTMLUListElement,
  connections: HTMLOListElement,
 }}
 */
const DOM = {
  resetButton: document.getElementById("reset"),
  buzzedInQueue: document.getElementById("buzzedInQueue"),
  connections: document.getElementById("connections"),
};

let ws = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectDelay = 1000; // Start with 1 second
let reconnectTimer = null;
let isConnected = false;

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
        const li = document.createElement("li");
        li.textContent = message.user.name;
        li.title = message.user.uuid;
        DOM.buzzedInQueue.appendChild(li);
        break;
      }
      case "playerListUpdate": {
        DOM.connections.innerHTML = ``;
        message.players.forEach((player) => {
          const li = document.createElement("li");
          li.textContent = player.name;
          li.title = player.uuid;
          DOM.connections.appendChild(li);
        });
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
    const uuids = Array.from(DOM.connections.childNodes).map((
      /** @type{HTMLLIElement} */ conn,
    ) => conn.title);
    const data = JSON.stringify({ "type": "unlock", "who": uuids });
    ws.send(data);
    DOM.buzzedInQueue.innerHTML = ``;
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