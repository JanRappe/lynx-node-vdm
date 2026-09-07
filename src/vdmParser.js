// Color name to CSS mapping
const COLOR_MAP = {
  white: '#FFFFFF',
  lightgray: '#D1D5DB',
  darkgray: '#374151',
  black: '#000000',
  red: '#EF4444',
  green: '#10B981',
  blue: '#3B82F6',
  cyan: '#06B6D4',
  magenta: '#D946EF',
  yellow: '#F59E0B',
  background: 'transparent'
};

function parseColor(raw) {
  if (!raw) return '#FFFFFF';
  const str = raw.trim().toLowerCase();

  if (COLOR_MAP[str]) {
    return COLOR_MAP[str];
  }

  // Check for rgb format
  const parts = str.split(',').map(s => s.trim());
  if (parts.length === 3) {
    const rgb = parts.map(p => {
      if (p.startsWith('0x')) return parseInt(p, 16);
      return parseInt(p, 10);
    });
    if (!rgb.some(isNaN)) {
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
  }

  return raw;
}

class VdmEngine {
  constructor(defaultCols = 16, defaultRows = 4) {
    this.cols = defaultCols;
    this.rows = defaultRows;
    this.layoutBackColor = '#202020';

    this.fontFaceColor = '#FFFFFF';
    this.fontBackColor = 'transparent';
    this.textJustify = 'left';
    this.fontWidth = 100;

    // Cursor position for cell drawing
    this.cursorX = 0;
    this.cursorY = 0;

    this.currentField = null;

    // Drawing buffer (accumulates fields until LayoutFlush)
    this.bufferFields = [];

    // Last committed frame
    this.activeFrame = {
      cols: this.cols,
      rows: this.rows,
      layoutBackColor: this.layoutBackColor,
      fields: []
    };
  }

  /**
   * Reset drawing environment to default layout state
   */
  layoutSetup(cols, rows) {
    this.cols = parseInt(cols, 10) || 16;
    this.rows = parseInt(rows, 10) || 4;
    this.layoutBackColor = '#202020';
    this.fontFaceColor = '#FFFFFF';
    this.fontBackColor = 'transparent';
    this.textJustify = 'left';
    this.cursorX = 0;
    this.cursorY = 0;
    this.currentField = null;
    this.bufferFields = [];
  }

  /**
   * Execute an individual VDM command string
   */
  executeCommand(cmdStr) {
    const eqIdx = cmdStr.indexOf('=');
    const cmdName = (eqIdx === -1 ? cmdStr : cmdStr.slice(0, eqIdx)).trim();
    const cmdArg = eqIdx === -1 ? '' : cmdStr.slice(eqIdx + 1);

    switch (cmdName) {
      case 'LayoutSetup': {
        const [w, h] = cmdArg.split(',').map(s => parseInt(s.trim(), 10));
        this.layoutSetup(w || 16, h || 4);
        break;
      }
      case 'LayoutBackColor': {
        this.layoutBackColor = parseColor(cmdArg);
        break;
      }
      case 'FontFaceColor': {
        const fontFaceColor = parseColor(cmdArg);
        if (this.currentField) {
          this.currentField.fontFaceColor = fontFaceColor;
        } else {
          this.fontFaceColor = fontFaceColor;
        }
        break;
      }
      case 'FontBackColor': {
        const fontBackColor = parseColor(cmdArg);
        if (this.currentField) {
          this.currentField.fontBackColor = fontBackColor;
        } else{
          this.fontBackColor = fontBackColor;
        }
        break;
      }
      case 'FontWidth': {
        const parts = cmdArg.split(',');
        this.fontWidth = parseInt(parts[0], 10) || 100;
        break;
      }
      case 'TextJustify': {
        const textJustify = cmdArg.trim().toLowerCase();
        if (this.currentField) {
          this.currentField.textJustify = textJustify;
        } else {
          this.textJustify = textJustify;
        }
        break;
      }
      case 'TextSetup': {
        const parts = cmdArg.split(',').map(s => s.trim());
        const w = parseInt(parts[0], 10) || 1;
        const h = parts[1] ? parseInt(parts[1], 10) : 1;
        let left = parts[2] !== undefined ? parseInt(parts[2], 10) : this.cursorX;
        let top = parts[3] !== undefined ? parseInt(parts[3], 10) : this.cursorY;

        // If a TextSetup command ist sent while another one is still active, discard the previous one and restore the cursor positions
        if(this.currentField){
          left = this.bufferFields ? this.bufferFields[this.bufferFields.length - 1].left + this.bufferFields[this.bufferFields.length - 1].width : this.cursorX;
          top = this.bufferFields ? this.bufferFields[this.bufferFields.length - 1].top : this.cursorY;
        }

        this.currentField = {
          left,
          top,
          width: w,
          height: h,
          textJustify: this.textJustify,
          fontFaceColor: this.fontFaceColor,
          fontBackColor: this.fontBackColor,
          fontWidth: this.fontWidth,
          text: ''
        };

        // Advance cursor position
        this.cursorX = left + w;
        this.cursorY = top;
        if (this.cursorX >= this.cols) {
          this.cursorX = 0;
          this.cursorY = top + h;
        }
        break;
      }
      case 'TextDraw': {
        if (!this.currentField) {
          this.currentField = {
            left: this.cursorX,
            top: this.cursorY,
            width: 1,
            height: 1,
            textJustify: this.textJustify,
            fontFaceColor: this.fontFaceColor,
            fontBackColor: this.fontBackColor,
            fontWidth: this.fontWidth,
            text: ''
          };
        }
        this.currentField.text = cmdArg;
        this.bufferFields.push({ ...this.currentField });
        this.currentField = null;
        break;
      }
      case 'LayoutFlush': {
        this.flush();
        break;
      }
      default:
        break;
    }
  }

  /**
   * Commits the buffer fields to the active video frame
   */
  flush() {
    this.activeFrame = {
      cols: this.cols,
      rows: this.rows,
      layoutBackColor: this.layoutBackColor,
      fields: [...this.bufferFields]
    };
    return this.activeFrame;
  }

  /**
   * Parse a raw UDP payload that may contain multiple \x12 ... \x14 commands
   */
  parseDatagram(rawBuffer) {
    const raw = typeof rawBuffer === 'string' ? rawBuffer : rawBuffer.toString('latin1');
    let hasVdmCommand = false;
    let pos = 0;

    while (pos < raw.length) {
      const startIdx = raw.indexOf('\x12', pos);
      if (startIdx === -1) break;

      const endIdx = raw.indexOf('\x14', startIdx + 1);
      if (endIdx === -1) break;

      const cmd = raw.slice(startIdx + 1, endIdx);
      this.executeCommand(cmd);
      hasVdmCommand = true;
      pos = endIdx + 1;
    }

    return hasVdmCommand ? this.activeFrame : null;
  }
}

/**
 * Reassembles FinishLynx UDP datagrams split across multiple packets.
 * FinishLynx groups packets using a maximum chunk payload of 536 bytes 
 */
class DatagramReassembler {
  constructor(options = {}) {
    this.maxChunkSize = options.maxChunkSize || 536;
    this.timeoutMs = options.timeoutMs || 1000;
    this.buffers = new Map();
  }

  /**
   * Feed an incoming datagram chunk (Buffer or string).
   * @param {Buffer|string} msg - The packet data
   * @param {object} [rinfo] - UDP remote info (address, port, size)
   * @param {function} [onComplete] - Callback called when a full payload is reassembled: (fullText, senderKey) => void
   * @returns {string|null} - Reassembled text if complete, or null if waiting for more chunks
   */
  feed(msg, rinfo, onComplete) {
    const size = rinfo && typeof rinfo.size === 'number'
      ? rinfo.size
      : (Buffer.isBuffer(msg) ? msg.length : Buffer.byteLength(msg, 'latin1'));
    const text = typeof msg === 'string' ? msg : msg.toString('latin1');
    const senderKey = rinfo ? `${rinfo.address || ''}:${rinfo.port || ''}` : 'default';

    if (size === this.maxChunkSize) {
      // Chunk is full (536 bytes) - more packets follow
      let entry = this.buffers.get(senderKey);
      if (!entry) {
        entry = { text: '', timer: null };
        this.buffers.set(senderKey, entry);
      }

      entry.text += text;

      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        const buffered = entry.text;
        this.buffers.delete(senderKey);
        if (buffered && onComplete) {
          onComplete(buffered, senderKey);
        }
      }, this.timeoutMs);
      if (entry.timer.unref) entry.timer.unref();

      return null;
    } else {
      // Not full (< 536 bytes or standalone packet) - end of transmission
      let fullText = text;
      const entry = this.buffers.get(senderKey);
      if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        fullText = entry.text + text;
        this.buffers.delete(senderKey);
      }

      if (onComplete) {
        onComplete(fullText, senderKey);
      }
      return fullText;
    }
  }

  /**
   * Reset pending buffers and cancel any running timers
   */
  reset() {
    for (const entry of this.buffers.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.buffers.clear();
  }
}

module.exports = {
  VdmEngine,
  parseColor,
  DatagramReassembler
};
