/**
 * ui/tableView.js — renders the 6-max table from a plain view model, so the
 * same renderer serves live play and hand-history replays.
 *
 * View model:
 * {
 *   players: [{name, avatar, stack, committed, folded, allIn, cards: number[]|null,
 *              showCards, position, lastAction, active, winner, handName, tendency, isHero}],
 *   button, board, pot, street, bb
 * }
 */
import { cardHTML, esc, bbFmt } from './dom.js';

// Where bet chips and the dealer button sit for each seat (percent of table).
const BET_POS = [[50, 74], [20, 64], [20, 34], [50, 22], [80, 34], [80, 64]];
const BTN_POS = [[38, 80], [12, 56], [14, 12], [38, 10], [86, 12], [88, 56]];

export class TableView {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      <div class="table-wrap"><div class="table">
        <div class="center"><div class="street-label"></div><div class="board"></div><div class="pot"></div></div>
        <div class="dealer-btn">D</div>
        <div class="seats"></div><div class="bets"></div>
      </div></div>`;
    this.boardEl = root.querySelector('.board');
    this.potEl = root.querySelector('.pot');
    this.streetEl = root.querySelector('.street-label');
    this.seatsEl = root.querySelector('.seats');
    this.betsEl = root.querySelector('.bets');
    this.btnEl = root.querySelector('.dealer-btn');
    this.shown = { board: [], cards: {} }; // what's already on screen (animate only new cards)
  }

  /** Forget animation state (new hand / new replay). */
  reset() {
    this.shown = { board: [], cards: {} };
  }

  render(vm) {
    const bb = vm.bb ?? 100;
    // Board: animate newly dealt cards, staggered.
    let newIdx = 0;
    const boardHTML = [];
    for (let i = 0; i < 5; i++) {
      const c = vm.board[i];
      if (c === undefined) { boardHTML.push('<div class="slot"></div>'); continue; }
      const isNew = this.shown.board[i] !== c;
      boardHTML.push(cardHTML(c, isNew ? { anim: 'deal', delay: newIdx++ * 140 } : {}));
    }
    this.boardEl.innerHTML = boardHTML.join('');
    this.shown.board = [...vm.board];
    this.potEl.textContent = `Pot ${bbFmt(vm.pot, bb)}`;
    this.streetEl.textContent = vm.street && vm.street !== 'showdown' ? vm.street : vm.street === 'showdown' ? 'showdown' : '';

    // Seats.
    this.seatsEl.innerHTML = vm.players.map((p, i) => {
      const cls = ['seat', `p${i}`];
      if (p.isHero) cls.push('hero');
      if (p.folded) cls.push('folded');
      if (p.active) cls.push('active');
      if (p.winner) cls.push('winner');
      let cards = '';
      if (p.cards && p.cards.length) {
        const key = p.cards.join(',') + (p.showCards ? 'u' : 'd');
        const prev = this.shown.cards[i];
        const anim = prev === key ? null : prev && prev.startsWith(p.cards.join(',')) ? 'flip' : 'deal';
        this.shown.cards[i] = key;
        cards = p.cards.map((c, k) => cardHTML(c, { back: !p.showCards, anim, delay: anim === 'deal' ? i * 60 + k * 360 : 0 })).join('');
      } else this.shown.cards[i] = null;
      const bubble = p.lastAction ? actionBubble(p.lastAction, bb) : '';
      const tendency = p.tendency ? `<div class="tendency${p.tendency.unknown ? ' unknown' : ''}" ${p.tendency.title ? `title="${esc(p.tendency.title)}"` : ''}>${esc(p.tendency.text)}</div>` : '';
      const handName = p.handName ? `<div class="hand-name">${esc(p.handName)}</div>` : '';
      return `<div class="${cls.join(' ')}">
        <div class="hole">${cards}</div>
        <div class="plate">${bubble}
          <div class="name">${esc(p.avatar ? `${p.avatar} ` : '')}${esc(p.name)}</div>
          <div class="stack">${p.allIn ? 'ALL-IN' : bbFmt(p.stack, bb)}</div>
          <div class="pos">${esc(p.position)}</div>
        </div>${handName}${tendency}
      </div>`;
    }).join('');

    // Chips in front of players for the current street.
    this.betsEl.innerHTML = vm.players.map((p, i) => (p.committed > 0
      ? `<div class="bet-chip" style="left:${BET_POS[i][0]}%;top:${BET_POS[i][1]}%">${bbFmt(p.committed, bb)}</div>`
      : '')).join('');

    const [bx, by] = BTN_POS[vm.button] ?? BTN_POS[0];
    this.btnEl.style.left = `${bx}%`;
    this.btnEl.style.top = `${by}%`;
  }
}

function actionBubble(a, bb) {
  const t = a.type;
  let text;
  if (t === 'post') text = `${a.label} ${bbFmt(a.amount, bb)}`;
  else if (t === 'fold') text = 'Fold';
  else if (t === 'check') text = 'Check';
  else if (t === 'call') text = `Call ${bbFmt(a.amount, bb)}`;
  else if (t === 'bet') text = `Bet ${bbFmt(a.to, bb)}`;
  else if (t === 'raise') text = `Raise ${bbFmt(a.to, bb)}`;
  else text = t;
  if (a.allIn && t !== 'fold') text = `${text.split(' ')[0]} · All-in`;
  return `<div class="bubble ${a.allIn ? 'allin' : t}">${esc(text)}</div>`;
}
