/**
 * ui/app.js — entry point: loads saved state, creates the session and the
 * views, and handles tab navigation.
 */
import { $, $$, esc, initTooltips, term } from './dom.js';
import { loadState, saveState } from '../storage.js';
import { Session } from '../session.js';
import { LEVELS } from '../progression.js';
import { GLOSSARY } from '../glossary.js';
import { PlayView } from './playView.js';
import { TrainerView, DrillsView, QuizView } from './practiceViews.js';
import { ReviewView } from './reviewView.js';
import { StatsView } from './statsView.js';

class GlossaryView {
  constructor(root) {
    root.innerHTML = `
      <div class="row" style="margin-bottom:12px"><h2 style="margin:0">Glossary</h2><span class="spacer"></span>
        <input type="search" placeholder="Search terms…" id="gl-search" aria-label="Search glossary"></div>
      <p class="muted small">Underlined terms anywhere in the app (like ${term('equity')} or ${term('spr', 'SPR')}) show these definitions on hover or tap.</p>
      <div class="glossary-list" id="gl-list"></div>`;
    const list = $('#gl-list', root);
    const render = (q = '') => {
      const ql = q.toLowerCase();
      list.innerHTML = Object.entries(GLOSSARY)
        .filter(([, g]) => !ql || g.term.toLowerCase().includes(ql) || g.def.toLowerCase().includes(ql))
        .sort((a, b) => a[1].term.localeCompare(b[1].term))
        .map(([, g]) => `<div class="panel"><h3>${esc(g.term)}</h3><div class="small">${esc(g.def)}</div></div>`)
        .join('');
    };
    $('#gl-search', root).oninput = (e) => render(e.target.value);
    render();
  }

  activate() {}
}

class App {
  constructor() {
    this.state = loadState();
    this.session = new Session(this.state);
    this.views = {
      play: new PlayView($('#view-play'), this),
      trainer: new TrainerView($('#view-trainer'), this),
      drills: new DrillsView($('#view-drills'), this),
      quiz: new QuizView($('#view-quiz'), this),
      review: new ReviewView($('#view-review'), this),
      stats: new StatsView($('#view-stats'), this),
      glossary: new GlossaryView($('#view-glossary'), this),
    };
    $$('#tabs button').forEach((b) => { b.onclick = () => this.show(b.dataset.view); });
    initTooltips();
    this.refreshBadge();
    const initial = location.hash.slice(1);
    this.show(this.views[initial] ? initial : 'play');
    window.addEventListener('hashchange', () => {
      const v = location.hash.slice(1);
      if (this.views[v] && v !== this.current) this.show(v);
    });
  }

  show(name) {
    this.current = name;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
    this.views[name].activate();
  }

  save() {
    saveState(this.state);
  }

  refreshBadge() {
    const L = LEVELS[this.state.level - 1];
    $('#level-badge').textContent = `Lv ${L.level} · ${L.name}`;
  }

  onHandFinished() {
    this.refreshBadge();
  }

  openReplay(handId) {
    this.show('review');
    this.views.review.open(handId);
  }
}

window.app = new App();
