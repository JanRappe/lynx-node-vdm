const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WebSocketServer, WebSocket } = require('ws');
const { VdmEngine } = require('./src/vdmParser');

// Configuration
const HTTP_PORT = parseInt(process.env.PORT, 10) || 8050;
const HTTP_HOST = process.env.HOST || '0.0.0.0';
const RESULTS_PORT = parseInt(process.env.RESULTS_PORT, 10) || 43278;
const TIME_PORT = parseInt(process.env.TIME_PORT, 10) || 43279;

// Instantiate VDM Engine
const vdmEngine = new VdmEngine(16, 4);


const metrics = {
  resultsPackets: 0,
  lastUpdate: new Date().toISOString()
};


function getLANAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      const isIPv4 = net.family === 'IPv4' || net.family === 4;
      if (isIPv4 && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ---------------------------------------------------------------------------
// HTTP Server (Display-Only Scoreboard)
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // REST API Endpoints
  if (pathname === '/api/status') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({
      status: 'online',
      uptime: process.uptime(),
      connectedClients: wss.clients.size,
      lanAddresses: getLANAddresses(),
      ports: {
        http: HTTP_PORT,
        resultsTcp: RESULTS_PORT
      },
      metrics,
      activeFrame: vdmEngine.activeFrame
    }));
  }

  if (pathname === '/api/vdm') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify(vdmEngine.activeFrame));
  }



  // Static File Serving
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  const publicPath = path.join(__dirname, 'public', pathname);

  let targetFile = null;
  if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
    targetFile = publicPath;
  }

  if (!targetFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('404 Not Found');
  }

  const ext = path.extname(targetFile).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(targetFile, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('500 Internal Server Error');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// WebSocket Server (ws)
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

function broadcastFrame() {
  const message = JSON.stringify({
    type: 'vdm_frame',
    frame: vdmEngine.activeFrame,
    timestamp: Date.now()
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.send(JSON.stringify({
    type: 'vdm_frame',
    frame: vdmEngine.activeFrame,
    timestamp: Date.now()
  }));
});

const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
if (heartbeatInterval.unref) heartbeatInterval.unref();

// ---------------------------------------------------------------------------
// FinishLynx TCP Listener
// ---------------------------------------------------------------------------
const tcpResults = net.createServer((socket) =>{
    console.log("TCP Server: Client connected:", socket.remoteAddress);
    socket.on('data', (data) => {
        metrics.resultsPackets++;
        processIncomingDatagram(data);
        
    });
});


function processIncomingDatagram(msg) {
  const text = typeof msg === 'string' ? msg : msg.toString('latin1');

  // If packet contains VDM command delimiters (\x12 and \x14), parse directly with VdmEngine
  if (text.includes('\x12') && text.includes('\x14')) {
    vdmEngine.parseDatagram(text);
    broadcastFrame();
    return;
  }
}


// ---------------------------------------------------------------------------
// Server Start
// ---------------------------------------------------------------------------
function startServer() {
    tcpResults.listen(RESULTS_PORT, HTTP_HOST, ()=> {
        console.log(`[TCP Results] Listening on port ${RESULTS_PORT}`);
    })

  server.listen(HTTP_PORT, HTTP_HOST, () => {
    const lanIPs = getLANAddresses();
    console.log('\n========================================================');
    console.log('     FinishLynx Video Display Module (VDM) Simulator');
    console.log('========================================================');
    console.log('  Display Output (Display-Only, Non-Interactable):');
    console.log(`    ➜ Local:   http://localhost:${HTTP_PORT}/`);
    if (lanIPs.length > 0) {
      lanIPs.forEach(ip => {
        console.log(`    ➜ Network: http://${ip}:${HTTP_PORT}/`);
      });
    }
    console.log('\n  FinishLynx TCP Port:');
    console.log(`    ➜ Results: Port ${RESULTS_PORT}`);
    console.log('========================================================\n');
  });
}

function shutdown() {
  console.log('\nShutting down VDM server...');
  clearInterval(heartbeatInterval);
  tcpResults.close();
  wss.close();
  server.close(() => {
    console.log('Server stopped.');
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

  startServer();