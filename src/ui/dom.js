/**
 * ui/dom.js — small DOM helpers shared by all views: escaping, card markup,
 * glossary tooltips, modals, toasts and the 13×13 range grid.
 */
import { RANKS, SUIT_SYMBOLS, cardRank, cardSuit } from '../deck.js';
import { GLOSSARY } from '../glossary.js';
import { gridClass } from '../ranges.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Card markup. opts: {size:'sm'|'md'|'lg', back, anim:'deal'|'flip', delay, dim, highlight} */
export function cardHTML(card, opts = {}) {
  const cls = ['card'];
  if (opts.size) cls.push(opts.size);
  if (opts.anim) cls.push(opts.anim);
  if (opts.dim) cls.push('dim');
  if (opts.highlight) cls.push('highlight');
  const style = opts.delay ? ` style="animation-delay:${opts.delay}ms"` : '';
  if (opts.back || card === null || card === undefined) return `<div class="${cls.join(' ')} back"${style}></div>`;
  const s = cardSuit(card);
  if (s === 1 || s === 2) cls.push('red');
  const r = RANKS[cardRank(card)] === 'T' ? '10' : RANKS[cardRank(card)];
  return `<div class="${cls.join(' ')}"${style} aria-label="${r}${'cdhs'[s]}"><span class="r">${r}</span><span class="s">${SUIT_SYMBOLS[s]}</span></div>`;
}

export const cardsHTML = (cards, opts = {}) => `<span class="cards">${cards.map((c) => cardHTML(c, opts)).join('')}</span>`;

/** Glossary term with hover tooltip. */
export const term = (key, text) => `<span class="term" data-term="${key}" tabindex="0">${esc(text ?? GLOSSARY[key]?.term ?? key)}</span>`;

export const pct = (x, digits = 0) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(digits)}%`);
export const bbFmt = (chips, bb = 100) => {
  const v = chips / bb;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}bb`;
};
export const signed = (x, d = 1) => `${x > 0 ? '+' : ''}${x.toFixed(d)}`;

// ---------------------------------------------------------------- tooltips

/** One global listener shows glossary definitions for any [data-term]. */
export function initTooltips() {
  const tip = $('#tooltip');
  let current = null;
  const show = (el) => {
    const g = GLOSSARY[el.dataset.term];
    if (!g) return;
    current = el;
    tip.innerHTML = `<b>${esc(g.term)}</b>${esc(g.def)}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    let top = r.bottom + 8;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = r.top - tip.offsetHeight - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => { tip.hidden = true; current = null; };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-term]');
    if (el) show(el);
    else if (current) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-term]');
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  // Tap support on touch devices.
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-term]');
    if (el) { e.preventDefault(); if (current === el) hide(); else show(el); } else if (current) hide();
  });
  window.addEventListener('scroll', hide, { passive: true });
}

// ------------------------------------------------------------- modal/toast

export function modal(html, { onClose } = {}) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  root.appendChild(wrap);
  wrap.querySelector('[data-close]')?.focus();
  return { el: wrap, close };
}

export function toast(html, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// -------------------------------------------------------------- range grid

/**
 * 13×13 chart grid. chart = {raise:Set, call:Set}; highlight = hand class.
 */
export function rangeGridHTML(chart, highlight, { mini = false } = {}) {
  let cells = '';
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const cls = gridClass(i, j);
      const k = chart.raise.has(cls) ? 'raise' : chart.call.has(cls) ? 'call' : '';
      cells += `<div class="${k}${cls === highlight ? ' me' : ''}" title="${cls}">${cls}</div>`;
    }
  }
  const hasCall = chart.call.size > 0;
  return `<div class="range-grid${mini ? ' mini' : ''}">${cells}</div>
    <div class="legend"><span><i style="background:#b8462e"></i>Raise</span>${hasCall ? '<span><i style="background:#2f7d55"></i>Call</span>' : ''}<span><i style="background:#1b2420;border:1px solid #2c3a34"></i>Fold</span></div>`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
