/**
 * FinishLynx Video Display Module (VDM) - Frontend Renderer
 */

(function () {
  'use strict';

  const elScreen = document.getElementById('vdm-screen');
  const elStatusDot = document.getElementById('vdm-status-dot');
  const elStatusText = document.getElementById('vdm-status-text');
  const elBezel = document.getElementById('vdm-bezel');

  let ws = null;
  let reconnectDelay = 1000;
  let currentFrame = null;

  // -------------------------------------------------------------------------
  // WebSocket Connection
  // -------------------------------------------------------------------------
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      if (elStatusDot) elStatusDot.className = 'status-dot';
      if (elStatusText) elStatusText.textContent = 'LIVE';
      reconnectDelay = 1000;
    };

    ws.onmessage = function (event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'vdm_frame' && msg.frame) {
          currentFrame = msg.frame;
          renderFrame(msg.frame);
        }
      } catch (err) {}
    };

    ws.onclose = function () {
      if (elStatusDot) elStatusDot.className = 'status-dot disconnected';
      if (elStatusText) elStatusText.textContent = 'OFFLINE';
      scheduleReconnect();
    };

    ws.onerror = function () {
      ws.close();
    };
  }

  function scheduleReconnect() {
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, 6000);
      connectWebSocket();
    }, reconnectDelay);
  }

  // -------------------------------------------------------------------------
  // Frame Rendering
  // -------------------------------------------------------------------------
  function renderFrame(frame) {
    if (!elScreen || !frame) return;

    const cols = frame.cols || 16;
    const rows = frame.rows || 4;

    elScreen.style.backgroundColor = frame.layoutBackColor || '#202020';

    // Clear previous fields
    elScreen.innerHTML = '';

    const fields = frame.fields || [];
    const screenHeight = elScreen.clientHeight || 400;
    const rowHeight = screenHeight / rows;

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.width <= 0 || f.height <= 0) continue;

      const fieldEl = document.createElement('div');
      fieldEl.className = `vdm-field align-${f.textJustify || 'left'}`;

      // If it's a 3-row height clock field
      if (f.height >= 3) {
        fieldEl.classList.add('field-clock');
      }

      // Grid Placement
      const colStart = (f.left !== undefined ? f.left : 0) + 1;
      const rowStart = (f.top !== undefined ? f.top : 0) + 1;
      fieldEl.style.gridColumn = `${colStart} / span ${f.width}`;
      fieldEl.style.gridRow = `${rowStart} / span ${f.height}`;

      // Styling & Colors
      if (f.fontBackColor && f.fontBackColor !== 'transparent') {
        fieldEl.style.backgroundColor = f.fontBackColor;
      }
      if (f.fontFaceColor) {
        fieldEl.style.color = f.fontFaceColor;
      }

      // Dynamic Font Sizing
      let fontSize = rowHeight * 0.65;
      if (f.height >= 3) {
        fontSize = (rowHeight * f.height) * 0.72;
      }
      fieldEl.style.fontSize = `${Math.round(fontSize)}px`;

      fieldEl.textContent = f.text || '';
      elScreen.appendChild(fieldEl);
    }
  }

  function resizeDisplay() {
    if (!elBezel || !elScreen) return;

    const windowWidth = window.innerWidth * 0.96;
    const windowHeight = window.innerHeight * 0.94;
    const targetAspect = 16 / 4; // 4.0 aspect ratio

    let boardWidth, boardHeight;

    if (windowWidth / windowHeight > targetAspect) {
      boardHeight = windowHeight;
      boardWidth = boardHeight * targetAspect;
    } else {
      boardWidth = windowWidth;
      boardHeight = boardWidth / targetAspect;
    }

    elBezel.style.width = `${Math.round(boardWidth)}px`;
    elBezel.style.height = `${Math.round(boardHeight)}px`;

    elScreen.style.width = '100%';
    elScreen.style.height = '100%';

    // Re-render current frame with updated sizes
    if (currentFrame) {
      renderFrame(currentFrame);
    }
  }

  window.addEventListener('resize', resizeDisplay);

  document.addEventListener('DOMContentLoaded', () => {
    resizeDisplay();
    connectWebSocket();
  });
})();
