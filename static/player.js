/**
 * Player client logic:
 * - Handles joining, buzzing, and UI updates
 * - Manages WebSocket connection and reconnection
 * - Updates player list and buzzer state from server events
 */

/**
 * DOM references for player UI elements.
  @type {{
    join: {
      section: HTMLElement,
      playerName: HTMLInputElement,
      button: HTMLButtonElement
    },
    gameSection: HTMLElement,
    buzzer: HTMLButtonElement,
    connections: HTMLUListElement,
    info: {
      uid: HTMLElement,
      audio: {
        check: HTMLInputElement,
        el: HTMLAudioElement
      }
    }
  }}
 */
const DOM = {
  join: {
    section: document.getElementById("join"),
    playerName: document.getElementById("playerName"),
    button: document.getElementById("joinButton"),
  },
  gameSection: document.getElementById("game"),
  buzzer: document.getElementById("buzzer"),
  connections: document.getElementById("connections"),
  info: {
    uid: document.getElementById("uuid"),
    audio: {
      check: document.getElementById("audio-check"),
      el: document.getElementById("buzzer-sound"),
    },
  },
};

/** WebSocket connection and state variables */
let ws = null;
const player = {
  name: "",
  id: -1,
  locked: true, // Initially locked until server unlocks
};

let currentQuestionType = "pure-buzz"; // Track the current question type

let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

const reconnectDelay = 1000;
let reconnectTimer = null;
let isConnected = false;

DOM.join.playerName.onkeydown = (event) => {
  if (event.key === "Enter") DOM.join.button.click();
};

DOM.join.button.onclick = () => {
  const name = DOM.join.playerName.value.trim();
  if (!name) {
    alert("Please enter your name!");
    return;
  }

  player.name = name;
  DOM.join.section.style.display = "none";
  DOM.gameSection.style.display = "grid";
  connectWebSocket();
};

DOM.buzzer.onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const checked = DOM.info.audio.check.checked;
  const enabled = !player.disabled;

  // Detect if we're in short-answer mode
  const isShortAnswer = currentQuestionType === "short-answer";

  if (isShortAnswer) {
    showShortAnswerDialog((answer) => {
      if (answer && answer.trim()) {
        if (checked && enabled) {
          DOM.info.audio.el.currentTime = 0;
          DOM.info.audio.el.play();
        }
        ws.send(`BUZZ ${answer.trim()}`);
        DOM.buzzer.disabled = true;
        player.locked = true;
      }
      // If cancelled or blank, do nothing
    });
    return;
  }

  if (checked && enabled) {
    DOM.info.audio.el.currentTime = 0;
    DOM.info.audio.el.play();
  }

  ws.send(`BUZZ`);
  DOM.buzzer.disabled = true;
  player.locked = true;
};

/**
 * Show a modal dialog for short answer input
 * @param {(answer: string|null) => void} callback
 */
function showShortAnswerDialog(callback) {
  // Remove any existing dialog
  const existing = document.getElementById("short-answer-dialog");
  if (existing) existing.remove();

  // Overlay
  const overlay = document.createElement("div");
  overlay.id = "short-answer-dialog";
  overlay.className = "short-answer-overlay";

  // Dialog box
  const dialog = document.createElement("div");
  dialog.className = "short-answer-dialog";

  const label = document.createElement("label");
  label.textContent = "Type your answer:";
  label.className = "short-answer-label";
  dialog.appendChild(label);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "short-answer-input";
  dialog.appendChild(input);

  const btnRow = document.createElement("div");
  btnRow.className = "short-answer-btn-row";

  const okBtn = document.createElement("button");
  okBtn.textContent = "Submit";
  okBtn.className = "short-answer-ok";
  okBtn.onclick = () => {
    overlay.remove();
    callback(input.value);
  };

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "short-answer-cancel";
  cancelBtn.onclick = () => {
    overlay.remove();
    callback(null);
  };

  btnRow.appendChild(okBtn);
  btnRow.appendChild(cancelBtn);
  dialog.appendChild(btnRow);

  // Allow Enter to submit, Escape to cancel
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      okBtn.click();
    } else if (e.key === "Escape") {
      cancelBtn.click();
    }
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  input.focus();
}

/** Show connection status messages */
function showConnectionStatus(status, message) {
  // Remove any existing status indicator
  const existingStatus = document.getElementById("connection-status");
  if (existingStatus) existingStatus.remove();

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
    ${status === "connected"
      ? "background: #4CAF50; color: white;"
      : status === "disconnected"
        ? "background: #f44336; color: white;"
        : "background: #ff9800; color: white;"
    }
  `;
  statusDiv.textContent = message;
  document.body.appendChild(statusDiv);

  // Auto-hide success messages
  if (status === "connected") {
    setTimeout(() => {
      if (statusDiv.parentNode) statusDiv.remove();
    }, 3000);
  }
}

/** Connect to the server WebSocket */
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    console.info("WebSocket connected!");
    isConnected = true;
    reconnectAttempts = 0;

    showConnectionStatus("connected", "Connected to game!");

    // Tells the server to give us an ID 
    ws.send(`JOIN ${player.name}`);
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    isConnected = false;
  };

  ws.onclose = (event) => {
    console.warn("WebSocket disconnected!", event.code, event.reason);
    isConnected = false;

    // Don't show disconnected message if this was intentional
    if (event.code !== 1000) {
      showConnectionStatus(
        "disconnected",
        "Connection lost. Attempting to reconnect...",
      );
      attemptReconnect();
    }
  };

  /** Handle messages from the server */
  ws.onmessage = (/** @type{MessageEvent<string>} */event) => {
    const [type, ...rest] = event.data.split(" ");
    const data = rest.join(" ");
    switch (type) {
      case "PLU": {
        DOM.connections.innerHTML = ``;
        const { players } = JSON.parse(data);

        players.forEach((player) => {
          const li = document.createElement("li");

          // Rank emblem (fixed width for alignment)
          const rankSpan = document.createElement("span");
          rankSpan.className = player.rank ? "buzz-indicator" : "rank-span";
          if (player.rank) {
            rankSpan.textContent = `#${player.rank}`;
          }
          li.appendChild(rankSpan);

          // Player name (centered)
          const nameSpan = document.createElement("span");
          nameSpan.className = "player-name-span";
          nameSpan.textContent = player.name;
          li.appendChild(nameSpan);

          DOM.connections.appendChild(li);
        });
        break;
      }
      case "UNLOCK":
        DOM.buzzer.disabled = false;
        document.querySelectorAll(".multiple-choice-btn").forEach(btn => {
          btn.disabled = false;
        });
        player.locked = false;
        break;
      case "LOCK":
        DOM.buzzer.disabled = true;
        document.querySelectorAll(".multiple-choice-btn").forEach(btn => {
          btn.disabled = true;
        });
        player.locked = true;
        break;
      case "ACK":
        // Show player UID
        DOM.info.uid.innerText = data;
        player.id = data;
        break;
      case "QUESTION_TYPE":
        swapQuestionType(data || "pure-buzz");
        break;
    }
  };
}

/** Attempt to reconnect with exponential backoff */
function attemptReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  if (reconnectAttempts >= maxReconnectAttempts) {
    showConnectionStatus(
      "disconnected",
      "Failed to reconnect. Please refresh the page.",
    );
    return;
  }

  reconnectAttempts++;

  showConnectionStatus(
    "reconnecting",
    `Reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`,
  );

  reconnectTimer = setTimeout(() => {
    if (!isConnected) {
      connectWebSocket(); // TODO: #8 Change to a reconnect that keeps id
    }
  }, reconnectDelay);
}

/**
 * Swap the question type UI for the player.
 * @param {string} type - The question type (e.g., 'multiple-choice', 'short-answer', 'pure-buzz' or 'multiple-choice n')
 */
function swapQuestionType(type) {
  currentQuestionType = type.split(" ")[0];
  const buzzerWrapper = document.getElementById("buzzer-wrapper");
  if (!buzzerWrapper) return;
  buzzerWrapper.innerHTML = "";

  let [qType, nChoices] = type.split(" ");
  nChoices = parseInt(nChoices);

  if (qType === "multiple-choice" && nChoices && nChoices >= 2 && nChoices <= 6) {
    for (let i = 1; i <= nChoices; i++) {
      const btn = document.createElement("button");
      btn.textContent = String.fromCharCode(64 + i); // A, B, C, ...
      btn.className = `multiple-choice-btn choice-${i}`;
      btn.disabled = player.locked;

      btn.onclick = () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const checked = DOM.info.audio.check.checked;
        const enabled = !player.disabled;

        if (checked && enabled) {
          DOM.info.audio.el.currentTime = 0;
          DOM.info.audio.el.play();
        }

        ws.send(`BUZZ ${String.fromCharCode(64 + i)}`);
        Array.from(buzzerWrapper.children).forEach(b => b.disabled = true);
        player.locked = true;
      };

      buzzerWrapper.appendChild(btn);
    }
  } else {
    const btn = document.createElement("button");
    btn.id = "buzzer";
    btn.textContent = "BUZZ!";
    btn.disabled = player.locked;
    btn.onclick = DOM.buzzer.onclick;
    buzzerWrapper.appendChild(btn);

    DOM.buzzer = btn; // Update reference to new buzzer button
  }
}

// Handle page visibility changes to reconnect when tab becomes active
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !isConnected && player.name) attemptReconnect();
});

// Handle online/offline events
addEventListener("online", () => {
  if (!isConnected && player.name) 
    setTimeout(() => attemptReconnect(), 1000);
});

addEventListener("offline", () => {
  showConnectionStatus("disconnected", "You are offline");
});
