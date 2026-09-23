import * as publicModel from '../../src/public-record.mjs';
// Minimal DOM harness for actual app.js handlers. Layout/input behavior is checked in a browser.
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as wishlistModel from '../../src/wishlist-record.mjs';
import * as wishlistRules from '../../src/wishlist-rules.mjs';
import * as model from '../../src/collection-record.mjs';
import * as rules from '../../src/collection-rules.mjs';
import { GENRES } from '../../src/genres.mjs';
import * as inputs from '../../prototype/input-controls.mjs';

export async function prototypeUI(fetch, { wishlist = false, owner = true } = {}) {
  const elements = new Map();
  const namedInputs = new Map();
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.handlers = {}; this.children = [];
      this.hidden = false; this.disabled = false; this.open = false;
      this.textContent = ''; this.value = ''; this.attributes = {};
    }
    set id(value) { this._id = value; elements.set(`#${value}`, this); }
    get id() { return this._id; }
    set name(value) { this._name = value; namedInputs.set(value, this); }
    get name() { return this._name; }
    get form() { return elements.get(this.id?.startsWith('search-') ? '#search-form' : '#record-form'); }
    addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
    async fire(type, properties = {}) {
      for (const fn of this.handlers[type] ?? []) await fn({ type, target: this, preventDefault() {}, ...properties });
    }
    dispatchEvent(event) { for (const fn of this.handlers[event.type] ?? []) fn(event); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(selector === 'button' && child.tagName === 'BUTTON' ? [child] : []), ...child.querySelectorAll(selector)]); }
    focus() { this.focused = true; }
    reset() { for (const input of [...namedInputs.values(), ...searchInputs.values()]) if (input.form === this) input.value = ''; this.dispatchEvent(new Event('reset')); }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
  }
  const document = {
    handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    body: { dataset: { section: wishlist ? "wishlist" : "collection" } },
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element()
  };
  document.querySelector('#table-container').hidden = true;
  const searchInputs = new Map(['artist', 'album', 'albumYear', 'genre'].map(name => {
    const input = document.querySelector(name === 'albumYear' ? '#search-year' : `#search-${name}`);
    input.id = name === 'albumYear' ? 'search-year' : `search-${name}`; return [name, input];
  }));
  const context = vm.createContext({ document, window: { addEventListener() {} }, fetch, Event, URL,
    FormData: class { constructor(form) { return [...(form === document.querySelector('#search-form') ? searchInputs : namedInputs)].map(([name, input]) => [name, input.value]); } },
    ...publicModel, ...model, ...rules, ...inputs, ...wishlistModel, ...wishlistRules, GENRES });
  const source = (await readFile(new URL('../../prototype/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  vm.runInContext(`applySession(${JSON.stringify(owner ? {role:'owner',csrfToken:'test-csrf'} : {role:'guest'})})`, context);
  return {
    start: () => document.handlers.DOMContentLoaded(),
    get: selector => document.querySelector(selector),
    run: script => vm.runInContext(script, context),
    fill: values => { for (const [field, value] of Object.entries(values)) namedInputs.get(field).value = value == null ? '' : String(value); },
    searchInput: field => searchInputs.get(field),
    input: field => namedInputs.get(field)
  };
}
export const response = data => ({ ok: true, json: async () => data });
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
