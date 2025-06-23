/**
 @type{{
  players: HTMLUListElement,
  selectAll: HTMLInputElement,
  lockSelected: HTMLButtonElement,
  unlockSelected: HTMLButtonElement,
  selectedCount: HTMLSpanElement,
  selectedCount2: HTMLSpanElement,
 }}
 */
const DOM = {
  players: document.getElementById("players"),
  selectAll: document.getElementById("selectAll"),
  lockSelected: document.getElementById("lockSelected"),
  unlockSelected: document.getElementById("unlockSelected"),
  selectedCount: document.getElementById("selectedCount"),
  selectedCount2: document.getElementById("selectedCount2"),
};

let ws = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectDelay = 1000; // Start with 1 second
let reconnectTimer = null;
let isConnected = false;
let playerList = [];
let buzzedPlayers = new Set();
let playerStates = new Map(); // Track locked/unlocked state for each player
let selectedPlayers = new Set();

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

function updateSelectedCount() {
  const count = selectedPlayers.size;
  DOM.selectedCount.textContent = count;
  DOM.selectedCount2.textContent = count;
  
  // Enable/disable bulk action buttons
  DOM.lockSelected.disabled = count === 0;
  DOM.unlockSelected.disabled = count === 0;
  
  // Update select all checkbox state
  if (count === 0) {
    DOM.selectAll.checked = false;
    DOM.selectAll.indeterminate = false;
  } else if (count === playerList.length) {
    DOM.selectAll.checked = true;
    DOM.selectAll.indeterminate = false;
  } else {
    DOM.selectAll.checked = false;
    DOM.selectAll.indeterminate = true;
  }
}

function togglePlayerSelection(uuid, checked) {
  if (checked) {
    selectedPlayers.add(uuid);
  } else {
    selectedPlayers.delete(uuid);
  }
  updateSelectedCount();
}

function togglePlayerLock(uuid, shouldLock) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const action = shouldLock ? "lock" : "unlock";
    const data = JSON.stringify({ "type": action, "who": [uuid] });
    ws.send(data);
    
    // Update local state
    playerStates.set(uuid, shouldLock ? 'locked' : 'unlocked');
    updatePlayerDisplay();
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
      createPlayerElement(player, index + 1);
    }
  });
  
  // Add unbuzzed players
  unbuzzedPlayers.forEach(player => {
    createPlayerElement(player, null);
  });
  
  updateSelectedCount();
}

function createPlayerElement(player, buzzOrder) {
  const li = document.createElement("li");
  li.className = `player ${buzzOrder ? 'buzzed' : ''}`;
  li.title = player.uuid;
  
  // Checkbox for selection
  const checkboxContainer = document.createElement("label");
  checkboxContainer.className = "checkbox-container";
  
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedPlayers.has(player.uuid);
  checkbox.addEventListener('change', (e) => {
    togglePlayerSelection(player.uuid, e.target.checked);
  });
  
  const checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  
  checkboxContainer.appendChild(checkbox);
  checkboxContainer.appendChild(checkmark);
  
  // Player info section
  const playerInfo = document.createElement("div");
  playerInfo.className = "player-info";
  
  const nameSpan = document.createElement("span");
  nameSpan.className = "player-name";
  nameSpan.textContent = player.name;
  
  playerInfo.appendChild(nameSpan);
  
  if (buzzOrder) {
    const buzzIndicator = document.createElement("span");
    buzzIndicator.className = "buzz-indicator";
    buzzIndicator.textContent = `#${buzzOrder}`;
    playerInfo.appendChild(buzzIndicator);
  }
  
  // Control buttons section
  const controls = document.createElement("div");
  controls.className = "player-controls";
  
  const isLocked = playerStates.get(player.uuid) === 'locked';
  
  const lockToggle = document.createElement("button");
  lockToggle.className = `lock-toggle ${isLocked ? 'locked' : 'unlocked'}`;
  lockToggle.textContent = isLocked ? 'Locked' : 'Unlocked';
  lockToggle.addEventListener('click', () => {
    togglePlayerLock(player.uuid, !isLocked);
  });
  
  controls.appendChild(lockToggle);
  
  // Assemble the player element
  li.appendChild(checkboxContainer);
  li.appendChild(playerInfo);
  li.appendChild(controls);
  
  DOM.players.appendChild(li);
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
        
        // Initialize player states for new players
        playerList.forEach(player => {
          if (!playerStates.has(player.uuid)) {
            playerStates.set(player.uuid, 'unlocked');
          }
        });
        
        // Clean up states for disconnected players
        const currentUuids = new Set(playerList.map(p => p.uuid));
        for (const uuid of playerStates.keys()) {
          if (!currentUuids.has(uuid)) {
            playerStates.delete(uuid);
            selectedPlayers.delete(uuid);
          }
        }
        
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

// Event listeners for bulk actions
DOM.selectAll.addEventListener('change', (e) => {
  const shouldSelectAll = e.target.checked;
  
  if (shouldSelectAll) {
    // Select all players
    playerList.forEach(player => {
      selectedPlayers.add(player.uuid);
    });
  } else {
    // Deselect all players
    selectedPlayers.clear();
  }
  
  updatePlayerDisplay();
});

DOM.lockSelected.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN && selectedPlayers.size > 0) {
    const uuids = Array.from(selectedPlayers);
    const data = JSON.stringify({ "type": "lock", "who": uuids });
    ws.send(data);
    
    // Update local states
    uuids.forEach(uuid => {
      playerStates.set(uuid, 'locked');
    });
    
    updatePlayerDisplay();
  }
});

DOM.unlockSelected.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN && selectedPlayers.size > 0) {
    const uuids = Array.from(selectedPlayers);
    const data = JSON.stringify({ "type": "unlock", "who": uuids });
    ws.send(data);
    
    // Update local states and clear buzz status
    uuids.forEach(uuid => {
      playerStates.set(uuid, 'unlocked');
      buzzedPlayers.delete(uuid);
    });
    
    updatePlayerDisplay();
  }
});

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