// Exercise motion lifecycle and integration callbacks without a rendering browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script = fs.readFileSync(new URL('../dist/assets/js/motion.js', import.meta.url), 'utf8');
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
class Element {
  constructor(text = '') { this.textContent = text; this.children = []; this.attrs = {}; this.listeners = new Map(); this.flags = new Set(); this.open = false; this.complete = true; this.classList = { contains: name => this.flags.has(name) }; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, props = {}) { for (const fn of [...(this.listeners.get(type) || [])]) fn(props); }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); child.parent = this; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 100, top: 50, width: 200, height: 148 }; }
}
function run({ width = 1440, height = 900, reduce = false, fine = true, en = false, library = true, smooth = true } = {}) {
  const document = new Element(); document.body = new Element(); document.documentElement = { lang: en ? 'en' : 'ja' };
  const title = new Element('IDFC'), stage = new Element(), header = new Element(), dialog = new Element(), nav = new Element(), photo = new Element(), button = new Element(), tilt = new Element(), home = new Element();
  const selectors = new Map([['.home', home], ['.connection-story', stage], ['.hero h1 > span', title], ['.site-header', header], ['.photo-dialog', dialog], ['.primary-nav', nav], ['.hero-visual>.hero-photo', tilt]]);
  document.querySelector = selector => selectors.get(selector) || null;
  document.querySelectorAll = selector => selector === 'a[data-lightbox]' ? [photo] : selector === '.button, .contact-button' ? [button] : [];
  document.createElement = () => new Element();
  const window = new Element(); Object.assign(window, { innerHeight: height });
  const observers = [], instances = [], contexts = [], timelines = [], moves = [];
  class Observer { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } fire() { this.callback(); } }
  class Lenis {
    constructor(options) { this.options = options; this.events = new Map(); this.stops = 0; this.starts = 0; instances.push(this); }
    on(event, fn) { this.events.set(event, fn); } off(event) { this.events.delete(event); }
    stop() { this.stops++; } start() { this.starts++; }
    raf(time) { this.lastRaf = time; } destroy() { this.destroyed = true; }
  }
  const ticker = new Set();
  const gsap = {
    registerPlugin() {},
    matchMedia() { const callbacks = []; const context = { add(query, fn) {
      const minWidth = Number(/min-width:\s*(\d+)/.exec(query)?.[1] || 0);
      const minHeight = Number(/min-height:\s*(\d+)/.exec(query)?.[1] || 0);
      if (width >= minWidth && height >= minHeight && !reduce && (!query.includes('pointer: fine') || fine)) {
        const cleanup = fn(); if (cleanup) callbacks.push(cleanup);
      }
    }, revert() { callbacks.reverse().forEach(fn => fn()); } }; contexts.push(context); return context; },
    from() {}, utils: { toArray: () => [] },
    ticker: { add: fn => ticker.add(fn), remove: fn => ticker.delete(fn), lagSmoothing() {} },
    timeline(config) { const timeline = { config, from() { return this; }, to() { return this; } }; timelines.push(timeline); return timeline; },
    quickTo: (target, field) => value => { target[field] = value; },
    to(target, vars) { moves.push({ target, vars }); },
    set(target, vars) { Object.assign(target, vars); },
    killTweensOf(target) { target.killed = true; }
  };
  const ScrollTrigger = { update() {}, refresh() {} };
  if (library) Object.assign(window, { gsap, ScrollTrigger, MutationObserver: Observer });
  if (smooth) window.Lenis = Lenis;
  vm.runInNewContext(script, { window, document, gsap, ScrollTrigger, Lenis, MutationObserver: Observer });
  return { document, window, title, stage, dialog, nav, photo, button, tilt, observers, instances, contexts, timelines, ticker, moves };
}
const desktop = run();
check(desktop.title.children.filter(n => n.className === 'kinetic-letter').length === 4, 'Four IDFC letters animate');
check(desktop.title.children[0].textContent === 'IDFC' && !desktop.title.children[0].attrs['aria-hidden'], 'Headline keeps accessible text outside decorative letters');
check(desktop.instances.length === 0 && desktop.ticker.size === 0, 'Desktop uses native scrolling without a smoothing loop');
check(desktop.timelines.length === 0, 'Desktop does not pin or scrub the story');
check(desktop.observers.length === 0, 'Motion does not intercept overlay scrolling');
desktop.photo.emit('pointerenter');
const cursor = desktop.document.body.children[0];
check(cursor.textContent === '見る' && cursor.autoAlpha === 1, 'Japanese photo cursor appears');
desktop.document.emit('pointermove', { clientX: 260, clientY: 110 });
check(cursor.x === 260 && cursor.y === 110, 'Cursor tracks pointer position');
desktop.document.emit('pointerdown');
check(cursor.autoAlpha === 0, 'Cursor hides on photo activation');
desktop.button.emit('pointermove', { clientX: 2000, clientY: 2000 });
check(desktop.button.x === 4 && desktop.button.y === 4, 'Magnetic movement is bounded');
desktop.button.emit('blur');
check(desktop.button.x === 0 && desktop.button.y === 0, 'Keyboard focus restores button position');
for (const type of ['pointerleave', 'pointerdown', 'pointercancel', 'click']) {
  desktop.button.emit('pointermove', { pointerType: 'mouse', clientX: 2000, clientY: 2000 });
  desktop.button.emit(type);
  check(desktop.button.x === 0 && desktop.button.y === 0, type + ' clears magnetic movement');
}
desktop.button.emit('pointermove', { pointerType: 'touch', clientX: 2000, clientY: 2000 });
check(desktop.button.x === 0 && desktop.button.y === 0, 'Hybrid-device touch input does not move buttons');
for (const type of ['blur', 'pagehide']) {
  desktop.button.emit('pointermove', { pointerType: 'mouse', clientX: 2000, clientY: 2000 });
  desktop.window.emit(type);
  check(desktop.button.x === 0 && desktop.button.y === 0, type + ' clears movement before a page is restored');
}
desktop.tilt.emit('pointermove', { clientX: 2000, clientY: 2000 });
check(desktop.moves.at(-1).vars.rotationY === 4 && desktop.moves.at(-1).vars.rotationX === -4, 'Photo tilt is bounded');
desktop.contexts[0].revert();
check(desktop.ticker.size === 0, 'Changing motion settings leaves native scrolling intact');
check(desktop.document.body.children.length === 0 && desktop.title.textContent === 'IDFC', 'Cursor removed and accessible headline restored');
check(desktop.button.listeners.get('pointermove').size === 0 && desktop.tilt.listeners.get('pointermove').size === 0, 'Pointer handlers are removed');
check(desktop.button.killed && desktop.tilt.killed, 'Pending motion tweens are stopped');
const mobile = run({ width: 390, height: 844, fine: false });
check(mobile.instances.length === 0 && mobile.timelines.length === 0, 'Mobile uses native scrolling without pinning');
check(mobile.document.body.children.length === 0, 'Touch devices have no custom cursor');
const reduced = run({ reduce: true });
check(reduced.title.children.length === 0 && reduced.instances.length === 0 && reduced.timelines.length === 0, 'Reduced motion skips visual and scroll effects');
check(reduced.document.body.children.length === 0, 'Reduced motion skips cursor effects');
const short = run({ height: 500 });
check(short.timelines.length === 0 && short.instances.length === 0, 'Short desktop windows keep native scrolling');
const fallback = run({ library: false });
check(fallback.title.textContent === 'IDFC' && fallback.document.body.children.length === 0, 'Unavailable library leaves static content intact');
const noLenis = run({ smooth: false });
check(noLenis.timelines.length === 0 && noLenis.instances.length === 0, 'Smooth-scroll dependency is unnecessary');
const english = run({ en: true });
check(english.document.body.children[0].textContent === 'View', 'English photo cursor is localized');
check(!script.includes('new Lenis') && !script.includes('pin: true'), 'No scroll interception in production motion code');
const result = { result: 'pass', assertions, scope: 'Real motion.js lifecycle callbacks with animation API doubles', rendering_browser_qa: false };
fs.writeFileSync(new URL('../reports/qa-motion.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
