import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { TouchControlsManager } from '../../apps/web/src/touch-controls';

function createMockElement(tag = 'div'): any {
  const listeners: Record<string, Function[]> = {};
  const attrs = new Map<string, string>();
  const children: any[] = [];
  const byId = new Map<string, any>();

  const el: any = {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    style: {},
    classList: {
      add: (c: string) => { el.className = `${el.className} ${c}`.trim(); },
      remove: (c: string) => { el.className = el.className.replace(c, '').trim(); },
      contains: (c: string) => el.className.includes(c),
    },
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    appendChild: (child: any) => {
      children.push(child);
      if (child.id) byId.set(child.id, child);
      return child;
    },
    addEventListener: (type: string, handler: Function) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    dispatchEvent: (e: any) => {
      for (const h of listeners[e.type] || []) h(e);
      return true;
    },
    removeEventListener: (type: string, handler: Function) => { listeners[type] = (listeners[type] ?? []).filter(h => h !== handler); },
    querySelectorAll: () => children.filter(c => c.className.includes('active') || c.className.includes('holding')),
    remove: vi.fn(),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 20, top: 20, width: 110, height: 110 }),
    querySelector: (sel: string): any => {
      if (sel.startsWith('#')) {
        const id = sel.slice(1);
        if (el.id === id) return el;
        if (byId.has(id)) return byId.get(id);
        for (const c of children) {
          const found = c.querySelector(sel);
          if (found) return found;
        }
      }
      return null;
    },
  };

  Object.defineProperty(el, 'innerHTML', {
    get: () => '',
    set: (html: string) => {
      const idMatches = html.matchAll(/id="([^"]+)"/g);
      for (const match of idMatches) {
        const childId = match[1]!;
        const child = createMockElement('div');
        child.id = childId;
        children.push(child);
        byId.set(childId, child);
      }
    },
  });

  return el;
}

class MockPointerEvent {
  type: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault = vi.fn();
  constructor(type: string, init?: any) {
    this.type = type;
    this.pointerId = init?.pointerId ?? 1;
    this.clientX = init?.clientX ?? 0;
    this.clientY = init?.clientY ?? 0;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('touchscreen overlay controller', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
    });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, createElement: (tag: string) => createMockElement(tag) }));
    vi.stubGlobal('PointerEvent', MockPointerEvent);
  });

  it('releases a burn on blur and removes its style, controls and listeners on disposal', () => {
    const manager = new TouchControlsManager(), container = createMockElement('div');
    manager.saveMode('always'); manager.attach(container);
    const burn = container.querySelector('#touch-burn');
    burn.dispatchEvent(new MockPointerEvent('pointerdown'));
    expect(manager.pollFlight().engine).toBe(true);
    window.dispatchEvent(new Event('blur')); expect(manager.pollFlight().engine).toBe(false);
    const callback = vi.fn(); manager.onShortcut(callback);
    manager.dispose(); manager.dispose();
    container.querySelector('#touch-warp-up').dispatchEvent(new MockPointerEvent('pointerdown'));
    expect(callback).not.toHaveBeenCalled(); expect(container.querySelector('#touch-overlay').remove).toHaveBeenCalledOnce();
    expect(() => manager.attach(container)).toThrow('disposed');
  });
  it('initializes with auto mode by default', () => {
    const manager = new TouchControlsManager();
    expect(manager.getMode()).toBe('auto');
  });

  it('persists mode selection in localStorage', () => {
    const manager = new TouchControlsManager();
    manager.saveMode('always');
    expect(manager.getMode()).toBe('always');

    const reloaded = new TouchControlsManager();
    expect(reloaded.getMode()).toBe('always');
  });

  it('attaches DOM overlay structure to target container', () => {
    const container = createMockElement('div');
    const manager = new TouchControlsManager();
    manager.saveMode('always');
    manager.attach(container);

    const overlay = container.querySelector('#touch-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('#touch-stick-zone')).not.toBeNull();
    expect(overlay?.querySelector('#touch-stick-knob')).not.toBeNull();
    expect(overlay?.querySelector('#touch-burn')).not.toBeNull();
    expect(overlay?.querySelector('#touch-warp-down')).not.toBeNull();
    expect(overlay?.querySelector('#touch-warp-up')).not.toBeNull();
    expect(manager.isVisible()).toBe(true);
  });

  it('hides overlay when mode is never', () => {
    const container = createMockElement('div');
    const manager = new TouchControlsManager();
    manager.saveMode('never');
    manager.attach(container);

    expect(manager.isVisible()).toBe(false);
    const flight = manager.pollFlight();
    expect(flight).toEqual({ turn: 0, throttle: 0, engine: false });
  });

  it('activates engine burn on burn button pointerdown and releases on pointerup', () => {
    const container = createMockElement('div');
    const manager = new TouchControlsManager();
    manager.saveMode('always');
    manager.attach(container);

    const burnBtn = container.querySelector('#touch-burn') as any;

    // Before touch
    expect(manager.pollFlight().engine).toBe(false);

    // Pointer down
    burnBtn.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 1 }));
    expect(manager.pollFlight().engine).toBe(true);

    // Pointer up
    burnBtn.dispatchEvent(new MockPointerEvent('pointerup', { pointerId: 1 }));
    expect(manager.pollFlight().engine).toBe(false);
  });

  it('fires shortcut events on auxiliary button taps', () => {
    const container = createMockElement('div');
    const manager = new TouchControlsManager();
    manager.saveMode('always');
    manager.attach(container);

    let lastShortcut = '';
    manager.onShortcut((action) => {
      lastShortcut = action;
    });

    const warpUpBtn = container.querySelector('#touch-warp-up') as any;
    warpUpBtn.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 2 }));
    expect(lastShortcut).toBe('warpUp');

    const warpDownBtn = container.querySelector('#touch-warp-down') as any;
    warpDownBtn.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 3 }));
    expect(lastShortcut).toBe('warpDown');

    const pauseBtn = container.querySelector('#touch-pause') as any;
    pauseBtn.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 4 }));
    expect(lastShortcut).toBe('pause');
  });

  it('triggers onZoom on zoom in and zoom out button taps', () => {
    const container = createMockElement('div');
    const manager = new TouchControlsManager();
    manager.saveMode('always');
    manager.attach(container);

    const zoomFactors: number[] = [];
    manager.onZoom((factor) => {
      zoomFactors.push(factor);
    });

    const zoomInBtn = container.querySelector('#touch-zoom-in') as any;
    expect(zoomInBtn).not.toBeNull();
    zoomInBtn.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 5 }));
    expect(zoomFactors.length).toBe(1);
    expect(zoomFactors[0]).toBeGreaterThan(1); // Zoom in factor > 1

    const zoomOutBtn = container.querySelector('#touch-zoom-out') as any;
    expect(zoomOutBtn).not.toBeNull();
    zoomOutBtn.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 6 }));
    expect(zoomFactors.length).toBe(2);
    expect(zoomFactors[1]).toBeLessThan(1); // Zoom out factor < 1
  });

  it('triggers onZoom on vertical drag on touch zoom strip', () => {
    const container = createMockElement('div');
    const manager = new TouchControlsManager();
    manager.saveMode('always');
    manager.attach(container);

    const zoomFactors: number[] = [];
    manager.onZoom((factor) => {
      zoomFactors.push(factor);
    });

    const zoomStrip = container.querySelector('#touch-zoom-strip') as any;
    expect(zoomStrip).not.toBeNull();

    // Pointer down at y=100
    zoomStrip.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 7, clientY: 100 }));
    // Drag up to y=70 (dy = -30, should zoom in)
    zoomStrip.dispatchEvent(new MockPointerEvent('pointermove', { pointerId: 7, clientY: 70 }));
    expect(zoomFactors.length).toBe(1);
    expect(zoomFactors[0]).toBeGreaterThan(1);

    // Drag down to y=110 (dy = +40, should zoom out / unzoom)
    zoomStrip.dispatchEvent(new MockPointerEvent('pointermove', { pointerId: 7, clientY: 110 }));
    expect(zoomFactors.length).toBe(2);
    expect(zoomFactors[1]).toBeLessThan(1);

    // Release
    zoomStrip.dispatchEvent(new MockPointerEvent('pointerup', { pointerId: 7, clientY: 110 }));
  });
});

