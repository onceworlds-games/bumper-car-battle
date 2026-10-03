// The cards between moments: the title, the assignment (your costume, your quarry, your two tricks), the Powder Room,
// the results, the final podium, a closed room. One overlay at a time; text always through textContent.
import { bust, glyph, makeCanvas, drawBust } from './icons.js';
import { TROUPES, ABILITIES, ABILITY_IDS } from '../sim/const.js';
import { avatarUrl } from '../platform.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};
const button = (parent, text, cls, onClick, key) => {
  const b = el('button', `btn ${cls || ''}`, parent);
  b.type = 'button';
  b.append(document.createTextNode(text));
  if (key) el('kbd', '', b, key);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
};

/** A name with its owner's banner hanging before it. */
const named = (parent, cls, name, colors) => {
  const n = el(parent.tagName === 'TR' ? 'td' : 'div', cls, parent);
  if (colors) {
    const p = el('i', 'pennant', n);
    p.style.setProperty('--pa', colors[0]);
    p.style.setProperty('--pb', colors[1]);
  }
  n.append(document.createTextNode(name));
  return n;
};

export function createScreens(root) {
  let current = null;
  let kind = '';
  const open = (k, build, { dim = true } = {}) => {
    close();
    kind = k;
    const o = el('div', `overlay ${dim ? 'dim' : ''}`, root);
    build(o);
    current = o;
    requestAnimationFrame(() => o.classList.add('show'));
    return o;
  };
  function close() {
    if (!current) return;
    const o = current;
    current = null;
    kind = '';
    o.classList.remove('show');
    setTimeout(() => o.remove(), 380);
  }
  const s = {
    get kind() {
      return kind;
    },
    close,
    title({ onEnter }) {
      return open(
        'title',
        (o) => {
          o.className = 'title';
          el('h1', '', o, 'Carnevale');
          el('div', 'rule', o);
          const row = el('div', 'row', o);
          const enter = button(row, 'Enter', 'big', onEnter, 'Enter');
          setTimeout(() => enter.focus({ preventScroll: true }), 50);
        },
        { dim: false },
      );
    },
    /** The assignment card. a: { tr, quarry: { name, tr } | null, caseFile: [tr...] | null, picks: [{id, unlocked}], chosen: [a, b], chaos, onPick(list), left } */
    assign(a) {
      let chosen = [...a.chosen];
      const o = open('assign', (ov) => {
        const card = el('div', 'card stock assign', ov);
        const cols = el('div', 'cols', card);
        const you = el('div', 'sect', cols);
        el('div', 'caps', you, 'Tonight you are');
        const b = makeCanvas(112, 'bust');
        drawBust(b[1], a.tr, 0, 0, 112);
        you.appendChild(b[0]);
        el('h2', '', you, TROUPES[a.tr].name);
        if (a.quarry) {
          const q = el('div', 'sect', cols);
          el('div', 'caps', q, 'Your quarry');
          const duo = el('div', 'duo', q);
          const d = el('div', '', duo);
          d.appendChild(bust(a.quarry.tr, 72));
          el('div', 'name', d, a.quarry.name);
          el('div', 'sub', d, `a ${TROUPES[a.quarry.tr].name}`);
        } else if (a.caseFile) {
          const q = el('div', 'sect', cols);
          el('div', 'caps', q, 'The case');
          const duo = el('div', 'duo', q);
          for (const tr of a.caseFile) duo.appendChild(bust(tr, 64));
          el('div', 'sub', q, `${a.caseFile.length} impostors`);
        }
        if (a.picks.length) {
          const pk = el('div', 'sect', cols);
          el('div', 'caps', pk, a.chaos ? 'Chaos: your tricks' : 'Pick two');
          const row = el('div', 'picks', pk);
          const btns = [];
          for (const p of a.picks) {
            const btn = el('button', 'pick live', row);
            btn.type = 'button';
            btn.appendChild(glyph(p.id, 30));
            el('span', '', btn, ABILITIES[p.id].short);
            btn.disabled = a.chaos || !p.unlocked;
            if (!p.unlocked) btn.title = `Level ${ABILITIES[p.id].unlock}`;
            btn.addEventListener('pointerdown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (a.chaos || !p.unlocked) return;
              if (chosen.includes(p.id)) return;
              chosen = [chosen[1], p.id];
              refresh();
              a.onPick?.(chosen);
            });
            btns.push([btn, p.id]);
          }
          const refresh = () => btns.forEach(([btn, id]) => btn.classList.toggle('on', chosen.includes(id)));
          refresh();
        }
        const tm = el('div', 'timer', card);
        el('i', '', tm);
      });
      const bar = o.querySelector('.timer i');
      return {
        progress(left01) {
          if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left01))})`;
        },
      };
    },
    powder({ seconds }) {
      const o = open('powder', (ov) => {
        const card = el('div', 'card stock powder', ov);
        el('div', 'caps', card, 'Unmasked');
        el('h2', '', card, 'The Powder Room');
        const [c, g] = makeCanvas(150, 'mirror', 190);
        mirror(g, 150, 190);
        card.appendChild(c);
        el('div', 'sub', card, 'A fresh face, a new costume');
        el('div', 'caps next', card);
      });
      const left = o.querySelector('.caps.next');
      return {
        tick(sec) {
          if (left) left.textContent = `Back in ${Math.max(0, Math.ceil(sec))}`;
        },
      };
    },
    /** Round results: rows [{ id, name, bot, tr, pts, unm, faux, me, place }] */
    results({ title, sub, rows, next, nextLabel }) {
      const o = open('results', (ov) => {
        const card = el('div', 'card stock results', ov);
        const head = el('div', 'head', card);
        el('div', 'caps', head, sub);
        el('h2', '', head, title);
        const t = el('table', 'board', card);
        for (const r of rows.slice(0, 12)) {
          const tr = el('tr', r.me ? 'me' : '', t);
          el('td', 'rank', tr, String(r.place));
          const tdI = el('td', '', tr);
          tdI.appendChild(bust(r.tr, 28));
          const n = named(tr, 'n', r.name, r.banner);
          if (r.bot) el('span', 'bot', n, ' (bot)');
          el('td', '', tr, r.unm ? `${r.unm} unmasked` : '');
          el('td', '', tr, String(r.pts));
        }
        const f = el('div', 'caps next', card);
        f.dataset.next = '1';
      });
      const f = o.querySelector('[data-next]');
      return {
        tick(sec) {
          if (f) f.textContent = `${nextLabel || 'Next'} in ${Math.max(0, Math.ceil(sec))}`;
        },
      };
    },
    /** The final podium: top: [{ id, name, pts, tr }], awards: [{ title, name }], onContinue for a private host. */
    final({ top, awards, onContinue, rows }) {
      const o = open('final', (ov) => {
        const card = el('div', 'card stock final', ov);
        const head = el('div', 'head', card);
        el('h2', '', head, top[0] ? top[0].name : 'Midnight');
        const pod = el('div', 'podium', head);
        const order = [top[1], top[0], top[2]];
        order.forEach((p, i) => {
          const col = el('div', '', pod);
          if (!p) return;
          const img = new Image();
          img.alt = '';
          img.crossOrigin = 'anonymous';
          const fallback = () => {
            const c = bust(p.tr, 64);
            img.replaceWith(c);
          };
          img.onerror = fallback;
          col.appendChild(img);
          if (p.bot) fallback();
          else Promise.resolve(avatarUrl(p.id)).then((u) => (u ? (img.src = u) : fallback())).catch(fallback);
          named(col, 'nm', p.name, p.banner);
          const st = el('div', 'step', col, String([2, 1, 3][i]));
          st.style.height = `${[46, 64, 34][i]}px`;
        });
        if (awards.length) {
          const aw = el('div', 'awards', head);
          for (const a of awards) {
            const d = el('div', 'award', aw);
            el('b', '', d, a.title);
            el('span', '', d, a.name);
          }
        }
        const body = el('div', 'body', card);
        if (rows?.length > 3) {
          const t = el('table', 'board', body);
          for (const r of rows.slice(3, 10)) {
            const tr = el('tr', r.me ? 'me' : '', t);
            el('td', 'rank', tr, String(r.place));
            named(tr, 'n', r.name + (r.bot ? ' (bot)' : ''), r.banner);
            el('td', '', tr, String(r.pts));
          }
        }
        const f = el('div', 'caps next', body);
        f.dataset.next = '1';
        if (onContinue) {
          const row = el('div', 'go', body);
          button(row, 'Continue', '', onContinue, 'Enter');
        }
      });
      const f = o.querySelector('[data-next]');
      return {
        tick(sec) {
          if (f) f.textContent = `Lobby in ${Math.max(0, Math.ceil(sec))}`;
        },
      };
    },
    closed({ text, action, onAction }) {
      return open('closed', (ov) => {
        const card = el('div', 'card stock closed', ov);
        el('h2', '', card, text);
        const row = el('div', 'go', card);
        button(row, action, 'big', onAction, 'Enter');
      });
    },
    tapToPlay(onTap) {
      return open(
        'tap',
        (ov) => {
          ov.className = 'tapcover';
          const b = button(ov, 'Tap to play', 'big', onTap);
          ov.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            onTap();
          });
          void b;
        },
        { dim: false },
      );
    },
  };
  return s;
}

/** A gilt mirror with a dressing light round it. */
function mirror(g, w, h) {
  g.fillStyle = '#f2b544';
  g.beginPath();
  g.ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2);
  g.fill();
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#2c5862');
  grad.addColorStop(1, '#0e2d36');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(w / 2, h / 2, w / 2 - 14, h / 2 - 14, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.ellipse(w / 2 - 20, h / 2 - 30, 12, 40, 0.5, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillStyle = '#fff3d6';
    g.beginPath();
    g.arc(w / 2 + Math.cos(a) * (w / 2 - 8), h / 2 + Math.sin(a) * (h / 2 - 8), 3.2, 0, Math.PI * 2);
    g.fill();
  }
}

export { ABILITY_IDS };
