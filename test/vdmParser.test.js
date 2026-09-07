const test = require('node:test');
const assert = require('node:assert/strict');
const { VdmEngine, parseColor, DatagramReassembler } = require('../src/vdmParser');

test('parseColor converts VDM color expressions to CSS', () => {
  assert.equal(parseColor('White'), '#FFFFFF');
  assert.equal(parseColor('Green'), '#10B981');
  assert.equal(parseColor('Red'), '#EF4444');
  assert.equal(parseColor('85,0,156'), 'rgb(85, 0, 156)');
  assert.equal(parseColor('0x20,0x20,0x20'), 'rgb(32, 32, 32)');
  assert.equal(parseColor('0x15,0x15,0x15'), 'rgb(21, 21, 21)');
});

test('VdmEngine executes TimeRunning sequence from VDMPlaceNameTime.lss', () => {
  const engine = new VdmEngine();
  const datagram = 
    '\x12LayoutSetup=16,4\x14' +
    '\x12LayoutBackColor=0x20,0x20,0x20\x14' +
    '\x12FontFaceColor=White\x14' +
    '\x12TextJustify=Center\x14' +
    '\x12TextSetup=16\x14' +
    '\x12FontBackColor=85,0,156\x14' +
    '\x12TextDraw=Men 100 Meter Dash\x14' +
    '\x12TextSetup=16,3\x14' +
    '\x12TextDraw=09.58\x14' +
    '\x12LayoutFlush\x14';

  const frame = engine.parseDatagram(datagram);
  assert.ok(frame);
  assert.equal(frame.cols, 16);
  assert.equal(frame.rows, 4);
  assert.equal(frame.layoutBackColor, 'rgb(32, 32, 32)');
  assert.equal(frame.fields.length, 2);

  // Field 0: Header row (purple background, 16 cells wide)
  assert.equal(frame.fields[0].text, 'Men 100 Meter Dash');
  assert.equal(frame.fields[0].width, 16);
  assert.equal(frame.fields[0].height, 1);
  assert.equal(frame.fields[0].left, 0);
  assert.equal(frame.fields[0].top, 0);
  assert.equal(frame.fields[0].fontBackColor, 'rgb(85, 0, 156)');
  assert.equal(frame.fields[0].textJustify, 'center');

  // Field 1: Giant 16x3 race clock
  assert.equal(frame.fields[1].text, '09.58');
  assert.equal(frame.fields[1].width, 16);
  assert.equal(frame.fields[1].height, 3);
  assert.equal(frame.fields[1].left, 0);
  assert.equal(frame.fields[1].top, 1);
});

test('VdmEngine executes exact VDMPlaceNameTime.lss sequence with Wind in Row 0 Column 12', () => {
  const engine = new VdmEngine();
  // Exact sequence emitted by FinishLynx from VDMPlaceNameTime.lss lines 615-686
  const datagram = 
    '\x12LayoutSetup=16,4\x14' +
    '\x12LayoutBackColor=0x20,0x20,0x20\x14' +
    '\x12FontWidth=100,50\x14' +
    '\x12FontFaceColor=White\x14' +
    '\x12FontShadowSize=1\x14' +
    '\x12TextJustify=Center\x14' +
    '\x12TextSetup=12\x14' +
    '\x12FontBackColor=85,0,156\x14' +
    '\x12TextDraw=Men 100M - Final\x14' +
    // Line 664 in VDMPlaceNameTime.lss:
    '\x12TextSetup=12\x14\x12TextSetup=4\x14' +
    '\x12FontBackColor=Green\x14' +
    '\x12TextDraw=+1.4\x14' +
    // Line 670-681 in VDMPlaceNameTime.lss: Result 1
    '\x12FontBackColor=0x30,0x30,0x30\x14' +
    '\x12TextSetup=3\x14\x12TextDraw= 1 \x14' +
    '\x12TextSetup=7\x14\x12TextDraw=Bolt, Usain\x14' +
    '\x12TextSetup=6\x14\x12TextDraw=  9.58\x14' +
    '\x12LayoutFlush\x14';

  const frame = engine.parseDatagram(datagram);
  assert.ok(frame);

  // Field 0: Event Name
  const eventField = frame.fields[0];
  assert.equal(eventField.text, 'Men 100M - Final');
  assert.equal(eventField.left, 0);
  assert.equal(eventField.top, 0);
  assert.equal(eventField.width, 12);

  // Field 1: Wind reading MUST be at left=12, top=0 (last column of the first row!)
  const windField = frame.fields[1];
  assert.equal(windField.text, '+1.4');
  assert.equal(windField.left, 12);
  assert.equal(windField.top, 0);
  assert.equal(windField.width, 4);
  assert.equal(windField.fontBackColor, '#10B981');

  // Field 2: Place 1 MUST be at left=0, top=1 (first column of second row!)
  const placeField = frame.fields[2];
  assert.equal(placeField.text, ' 1 ');
  assert.equal(placeField.left, 0);
  assert.equal(placeField.top, 1);
  assert.equal(placeField.width, 3);

  // Field 3: Athlete Name
  const nameField = frame.fields[3];
  assert.equal(nameField.text, 'Bolt, Usain');
  assert.equal(nameField.left, 3);
  assert.equal(nameField.top, 1);
  assert.equal(nameField.width, 7);

  // Field 4: Time
  const timeField = frame.fields[4];
  assert.equal(timeField.text, '  9.58');
  assert.equal(timeField.left, 10);
  assert.equal(timeField.top, 1);
  assert.equal(timeField.width, 6);
});

test('DatagramReassembler processes standalone packets (< 536 bytes) immediately', () => {
  const assembler = new DatagramReassembler();
  const datagram = '\x12LayoutSetup=16,4\x14\x12LayoutFlush\x14';
  let emitted = null;

  const result = assembler.feed(Buffer.from(datagram, 'latin1'), { size: Buffer.byteLength(datagram, 'latin1') }, (fullPayload) => {
    emitted = fullPayload;
  });

  assert.equal(result, datagram);
  assert.equal(emitted, datagram);
});

test('DatagramReassembler groups multi-packet datagrams when chunk size is 536 bytes', () => {
  const assembler = new DatagramReassembler();

  // Create a 536-byte chunk and a remainder chunk
  const part1 = 'A'.repeat(536);
  const part2 = 'B'.repeat(100);
  let emitted = null;

  // Feed first 536-byte chunk
  const res1 = assembler.feed(Buffer.from(part1, 'latin1'), { size: 536 }, (fullPayload) => {
    emitted = fullPayload;
  });

  assert.equal(res1, null, 'Should return null while waiting for subsequent chunks');
  assert.equal(emitted, null, 'Callback should not be called while waiting for subsequent chunks');

  // Feed final 100-byte chunk (< 536 bytes)
  const res2 = assembler.feed(Buffer.from(part2, 'latin1'), { size: 100 }, (fullPayload) => {
    emitted = fullPayload;
  });

  assert.equal(res2, part1 + part2);
  assert.equal(emitted, part1 + part2);
});

test('DatagramReassembler flushes buffer on safety timeout if terminating packet is dropped', async () => {
  const assembler = new DatagramReassembler({ timeoutMs: 50 });
  const part1 = 'X'.repeat(536);
  let emitted = null;

  assembler.feed(Buffer.from(part1, 'latin1'), { size: 536 }, (fullPayload) => {
    emitted = fullPayload;
  });

  assert.equal(emitted, null);

  // Wait for safety timeout to expire
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.equal(emitted, part1);
});

test('DatagramReassembler separates packets from different senders', () => {
  const assembler = new DatagramReassembler();
  const sender1 = { address: '192.168.1.10', port: 43278, size: 536 };
  const sender2 = { address: '192.168.1.20', port: 43278, size: 150 };

  const chunk1 = '1'.repeat(536);
  const chunk2 = '2'.repeat(150);

  let emitted = [];
  assembler.feed(Buffer.from(chunk1, 'latin1'), sender1, (payload) => {
    emitted.push({ sender: '1', payload });
  });

  assembler.feed(Buffer.from(chunk2, 'latin1'), sender2, (payload) => {
    emitted.push({ sender: '2', payload });
  });

  // sender2 (< 536 bytes) finishes immediately without sender1 data
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].sender, '2');
  assert.equal(emitted[0].payload, chunk2);
});

test('DatagramReassembler correctly reassembles split FinishLynx VDM commands across 536-byte boundary', () => {
  const assembler = new DatagramReassembler();
  const engine = new VdmEngine();

  // Construct a large VDM payload that exceeds 536 bytes
  const header = '\x12LayoutSetup=16,4\x14\x12LayoutBackColor=0x20,0x20,0x20\x14';
  const padding = '\x12TextSetup=16\x14\x12TextDraw=' + 'Z'.repeat(500) + '\x14';
  const trailer = '\x12TextSetup=16,3\x14\x12TextDraw=Reassembled!\x14\x12LayoutFlush\x14';
  const fullMessage = header + padding + trailer;

  // Split at exactly 536 bytes (cutting right in the middle of padding)
  const chunk1 = fullMessage.slice(0, 536);
  const chunk2 = fullMessage.slice(536);

  assert.equal(Buffer.byteLength(chunk1, 'latin1'), 536);
  assert.ok(Buffer.byteLength(chunk2, 'latin1') < 536);

  let reassembledPayload = null;
  assembler.feed(Buffer.from(chunk1, 'latin1'), { size: 536 }, (payload) => {
    reassembledPayload = payload;
  });
  assert.equal(reassembledPayload, null);

  assembler.feed(Buffer.from(chunk2, 'latin1'), { size: Buffer.byteLength(chunk2, 'latin1') }, (payload) => {
    reassembledPayload = payload;
  });
  assert.equal(reassembledPayload, fullMessage);

  const frame = engine.parseDatagram(reassembledPayload);
  assert.ok(frame);
  assert.equal(frame.fields[1].text, 'Reassembled!');
});
