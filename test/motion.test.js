/* Motion/live-update checks — stubbed DOM, real modules.
   Verifies the playback tick touches only changed Gantt segments and does not
   rebuild the per-process table. Run: node test/motion.test.js */
'use strict';
var assert = require('assert');
var path = require('path');

var mutations = { add: [], remove: [] };

function makeEl(id) {
  var classes = {};
  var el = {
    id: id || '', innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
    style: {}, attrs: {}, files: null,
    classList: {
      add: function (c) { classes[c] = 1; mutations.add.push((el.id || el.tag) + ':' + c); },
      remove: function (c) { delete classes[c]; mutations.remove.push((el.id || el.tag) + ':' + c); },
      toggle: function (c, force) { var on = force === undefined ? !classes[c] : force; if (on) classes[c] = 1; else delete classes[c]; return on; },
      contains: function (c) { return !!classes[c]; }
    },
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute: function (k) { delete this.attrs[k]; },
    addEventListener: function () {},
    focus: function () {},
    appendChild: function () {},
    remove: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; }
  };
  return el;
}

/* Gantt segments: [start, end, type] — the shape the engine emits. */
var SEGMENTS = [[0, 5, 'process'], [5, 8, 'process'], [8, 9, 'context-switch'], [9, 16, 'process']];
var segEls = SEGMENTS.map(function (s, i) {
  var el = makeEl('seg' + i);
  el.tag = 'seg';
  el.attrs['data-start'] = s[0];
  el.attrs['data-end'] = s[1];
  el.attrs['data-type'] = s[2];
  if (s[0] > 0) el.classList.toggle('gantt-seg--future', true);
  return el;
});

var ganttEl = makeEl('gantt');
ganttEl.attrs['data-scale'] = '18';
var tbodyWrites = 0;

/* tbody stub: innerHTML setter materialises rows so the incremental path runs. */
function makeTbody() {
  var el = makeEl('sim-procs-body');
  var html = '';
  var rows = [];
  function makeRow() {
    var tds = [];
    for (var i = 0; i < 7; i++) {
      var td = makeEl('td');
      td.tag = 'td';
      tds.push(td);
    }
    tds[4].firstElementChild = makeEl('status');
    var row = makeEl('tr');
    row.tag = 'tr';
    row.parentNode = el;
    row.querySelectorAll = function () { return tds; };
    return row;
  }
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return html; },
    set: function (v) {
      html = v; tbodyWrites++;
      var n = (v.match(/<tr data-pid=/g) || []).length;
      rows = [];
      for (var i = 0; i < n; i++) rows.push(makeRow());
    }
  });
  el.querySelectorAll = function (sel) { return sel === 'tr' ? rows : []; };
  return el;
}

var elements = {};
var docHandlers = {};
var winHandlers = {};

global.window = global;
global.document = {
  readyState: 'complete',
  title: '',
  hidden: false,
  body: makeEl('body'),
  getElementById: function (id) {
    if (id === 'sim-procs-body') return (elements[id] = elements[id] || makeTbody());
    if (!elements[id]) elements[id] = makeEl(id);
    return elements[id];
  },
  querySelector: function (sel) { return sel === '.gantt[data-scale]' ? ganttEl : null; },
  querySelectorAll: function (sel) { return sel === '.gantt-seg' ? segEls : []; },
  createElement: function (tag) { return makeEl(tag); },
  addEventListener: function (type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); }
};
global.location = { hash: '' };
global.history = { replaceState: function (a, b, h) { global.location.hash = h; } };
global.requestAnimationFrame = function (fn) { fn(); };
global.addEventListener = function (type, fn) { (winHandlers[type] = winHandlers[type] || []).push(fn); };

var scripts = ['components', 'state', 'scheduler', 'playback', 'comparison', 'benchmark', 'reports', 'persistence', 'viewkit', 'screen-overview', 'screen-simulate', 'screen-compare', 'screen-reports', 'app'];
scripts.forEach(function (s) { require(path.resolve(__dirname, '../src/' + s + '.js')); });

var passed = 0;
function check(label, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('  FAIL: ' + label + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

function nav(hash) {
  global.location.hash = hash;
  (winHandlers.hashchange || []).forEach(function (fn) { fn(); });
}

function futureOps(list) {
  return list.filter(function (x) { return x.indexOf('gantt-seg--future') >= 0; });
}

nav('#/simulate');

check('initial paint marks every segment that is not yet reached', function () {
  assert.strictEqual(segEls[0].classList.contains('gantt-seg--future'), false, 't=0 segment reached');
  assert.strictEqual(segEls[3].classList.contains('gantt-seg--future'), true, 'future segment dimmed');
});

check('stepping 6 units reveals only the crossed segment', function () {
  mutations.add.length = 0; mutations.remove.length = 0;
  var pb = global.CSL.sim.playback;
  for (var i = 0; i < 6; i++) pb.stepForward();
  assert.strictEqual(pb.getState().currentTime, 6);
  assert.strictEqual(futureOps(mutations.remove).length, 1, 'one segment crossed, got ' + mutations.remove.join(','));
  assert.strictEqual(futureOps(mutations.add).length, 0, 'nothing re-dimmed');
  assert.strictEqual(segEls[1].classList.contains('gantt-seg--future'), false);
  assert.strictEqual(segEls[2].classList.contains('gantt-seg--future'), true, 'segment at 8 still future');
});

check('a jump to 10 reveals exactly the remaining future segments', function () {
  mutations.add.length = 0; mutations.remove.length = 0;
  global.CSL.sim.playback.seek(10);
  assert.strictEqual(futureOps(mutations.remove).length, 2, 'segments at 8 and 9 revealed');
  assert.strictEqual(segEls[3].classList.contains('gantt-seg--future'), false);
});

check('stepping within one segment writes no segment classes', function () {
  mutations.add.length = 0; mutations.remove.length = 0;
  global.CSL.sim.playback.stepForward();
  assert.strictEqual(futureOps(mutations.remove).length, 0);
  assert.strictEqual(futureOps(mutations.add).length, 0);
});

check('seeking backwards re-dims the segments ahead of the playhead', function () {
  mutations.add.length = 0; mutations.remove.length = 0;
  global.CSL.sim.playback.reset();
  assert.strictEqual(futureOps(mutations.add).length, 3, 'three segments dimmed again, got ' + mutations.add.join(','));
});

check('per-process table is built once, then patched in place', function () {
  assert.strictEqual(tbodyWrites, 1, 'expected one tbody build, got ' + tbodyWrites);
  var pb = global.CSL.sim.playback;
  for (var i = 0; i < 5; i++) pb.stepForward();
  assert.strictEqual(tbodyWrites, 1, 'no rebuild while stepping, got ' + tbodyWrites);
});

console.log('\n' + passed + ' checks passed');
if (process.exitCode) console.error('FAILURES present');
else console.log('all motion checks passed');
