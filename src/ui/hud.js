// The in-round HUD: your quarry (or the case file) with the clock, the poise fan between your two abilities, the
// Master of Ceremonies' barks, phase banners, the answer ring, score pops, one-shot hints and the heartbeat. All text
// goes in with textContent. On touch the cluster moves to the top, clear of the platform's thumb controls.
import { bust, glyph, makeCanvas, drawFan, drawRing } from './icons.js';
import { TROUPES, ABILITIES } from '../sim/const.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export function createHud(root, labelsRoot, { onCard, onChip, onHome }) {
  const wrap = el('div', 'hud', root);
  wrap.style.display = 'none';
  // Quarry card.
  const q = el('div', 'card-q panel live', wrap);
  q.setAttribute('role', 'button');
  q.setAttribute('aria-label', 'Map');
  q.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    onCard?.();
  });
  let qCanvas = bust(0, 52);
  q.appendChild(qCanvas);
  const imps = el('div', 'imps', q);
  const qWho = el('div', 'who', q);
  const qWhere = el('div', 'where', q);
  const qWhere2 = el('div', 'where', q);
  const qClock = el('div', 'clock', q);
  // The cluster: ability, fan, ability.
  const cluster = el('div', 'cluster', wrap);
  const chips = [0, 1].map((i) => {
    const c = el('button', 'chip live', null);
    c.type = 'button';
    c.setAttribute('aria-label', `Ability ${i + 1}`);
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 64 64');
    const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circ.setAttribute('cx', '32');
    circ.setAttribute('cy', '32');
    circ.setAttribute('r', '29');
    circ.setAttribute('fill', 'none');
    circ.setAttribute('stroke', '#f2b544');
    circ.setAttribute('stroke-width', '4');
    circ.setAttribute('stroke-dasharray', `${2 * Math.PI * 29}`);
    ring.appendChild(circ);
    c.appendChild(ring);
    const key = el('span', 'key', c, String(i + 1));
    c.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onChip?.(i);
    });
    return { c, circ, key, id: null, glyph: null };
  });
  cluster.appendChild(chips[0].c);
  const [fanC, fanG] = makeCanvas(168, 'fan', 92);
  cluster.appendChild(fanC);
  cluster.appendChild(chips[1].c);
  const bark = el('div', 'bark', wrap);
  const banner = el('div', 'banner', wrap);
  const prompt = el('div', 'prompt', wrap);
  const [ringC, ringG] = makeCanvas(150);
  prompt.appendChild(ringC);
  const promptWord = el('b', '', prompt);
  const hint = el('div', 'hint', wrap);
  const why = el('div', 'why', wrap);
  // Your place, when it's off screen: an arrow at the edge; tap it to fall back in.
  const home = el('button', 'home live', wrap);
  home.type = 'button';
  home.setAttribute('aria-label', 'Back to your place');
  const homeArrow = el('span', 'arrow', home);
  el('span', 'lbl', home, 'Your place');
  home.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    onHome?.();
  });
  const vignette = el('div', 'vignette', root);
  const foot = el('div', 'foot', root);
  foot.style.display = 'none';

  let barkTimer = 0;
  let bannerTimer = 0;
  let hintTimer = 0;
  let whyTimer = 0;
  let lastQ = '';
  let lastFan = '';
  let top = '';
  const tags = new Map();

  const hud = {
    show(on) {
      wrap.style.display = on ? '' : 'none';
      if (!on) {
        prompt.classList.remove('show');
        vignette.classList.remove('beat');
      }
    },
    /** Touch: the cluster goes to the top (the thumbs own the lower corners), below the quarry card when narrow. */
    layout(touch, w) {
      const t = !!touch;
      const narrow = t && w < 560;
      const key = `${t}:${narrow}`;
      if (key === top) return;
      top = key;
      cluster.classList.toggle('top', t);
      cluster.classList.toggle('narrow', narrow);
      hint.classList.toggle('top', t);
      hint.classList.toggle('narrow', narrow);
      document.body.classList.toggle('narrow', narrow);
      for (const ch of chips) ch.key.style.display = t ? 'none' : '';
      fanC.style.width = t ? '126px' : '168px';
      fanC.style.height = t ? '69px' : '92px';
      document.body.classList.toggle('touch', t);
    },
    /** The quarry card. info: { tr, name, where, where2, clock } or { caseFile: [{tr, found}], where, clock } */
    quarry(info) {
      if (!info) {
        q.style.display = 'none';
        return;
      }
      q.style.display = '';
      const key = info.caseFile ? `c:${info.caseFile.map((c) => `${c.tr}${c.found ? 'x' : ''}`).join()}` : `q:${info.tr}`;
      if (key !== lastQ) {
        lastQ = key;
        q.classList.toggle('case', !!info.caseFile);
        imps.replaceChildren();
        if (info.caseFile) {
          qCanvas.style.display = 'none';
          for (const c of info.caseFile) imps.appendChild(bust(c.tr, 38, { cls: c.found ? 'found' : '' }));
        } else {
          const nc = bust(info.tr, 52);
          q.replaceChild(nc, qCanvas);
          qCanvas = nc;
          qCanvas.style.display = '';
        }
      }
      qWho.textContent = info.name ?? '';
      qWho.style.display = info.name ? '' : 'none';
      qWhere.textContent = info.where ?? '';
      qWhere2.textContent = info.where2 ?? '';
      qWhere2.style.display = info.where2 ? '' : 'none';
      qClock.textContent = info.clock ?? '';
      qClock.style.display = info.clock ? '' : 'none';
      imps.style.display = info.caseFile ? '' : 'none';
    },
    poise(p, flustered, time) {
      const key = `${Math.round(p)}:${flustered ? Math.floor(time * 12) : 0}`;
      if (key === lastFan) return;
      lastFan = key;
      drawFan(fanG, 168, 92, p, flustered, time);
    },
    /** chips: [{ id, left (0..1 of cooldown left), on }] */
    chips(list) {
      chips.forEach((ch, i) => {
        const c = list[i];
        ch.c.style.display = c ? '' : 'none';
        if (!c) return;
        if (ch.id !== c.id) {
          ch.id = c.id;
          ch.glyph?.remove();
          ch.glyph = glyph(c.id, 34);
          ch.c.insertBefore(ch.glyph, ch.key);
          ch.c.setAttribute('aria-label', ABILITIES[c.id]?.name ?? c.id);
          ch.c.title = ABILITIES[c.id]?.name ?? '';
        }
        const len = 2 * Math.PI * 29;
        ch.circ.setAttribute('stroke-dashoffset', `${len * (c.left || 0)}`);
        ch.c.classList.toggle('cool', (c.left || 0) > 0.001);
        ch.c.classList.toggle('on', !!c.on);
      });
    },
    showCluster(on) {
      cluster.style.display = on ? '' : 'none';
    },
    bark(text, ms = 2600) {
      bark.textContent = text;
      bark.classList.add('show');
      clearTimeout(barkTimer);
      barkTimer = setTimeout(() => bark.classList.remove('show'), ms);
    },
    banner(text, small = '', ms = 1900) {
      banner.replaceChildren();
      banner.append(document.createTextNode(text));
      if (small) el('small', '', banner, small);
      banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('show'), ms);
    },
    pop(text, good = true) {
      const p = el('div', `pop ${good ? 'good' : 'bad'}`, root, text);
      setTimeout(() => p.remove(), 1700);
    },
    hint(text, ms = 3200) {
      hint.textContent = text;
      hint.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.classList.remove('show'), ms);
    },
    why(text) {
      why.textContent = text;
      why.classList.add('show');
      clearTimeout(whyTimer);
      whyTimer = setTimeout(() => why.classList.remove('show'), 900);
    },
    /** The answer prompt: kind 'wave' | 'look', seconds since it appeared; null hides it. */
    prompt(kind, elapsed) {
      if (!kind) {
        prompt.classList.remove('show');
        return;
      }
      prompt.classList.add('show');
      promptWord.textContent = kind === 'look' ? 'Look!' : 'Wave!';
      drawRing(ringG, 150, elapsed);
    },
    beat() {
      vignette.classList.remove('beat');
      void vignette.offsetWidth;
      vignette.classList.add('beat');
    },
    /** The edge arrow toward your place: screen x, y and the angle to point, or null to hide it. */
    homing(x, y, ang) {
      if (x === null || x === undefined) {
        home.style.display = 'none';
        return;
      }
      home.style.display = 'flex';
      home.style.left = `${x}px`;
      home.style.top = `${y}px`;
      homeArrow.style.transform = `rotate(${ang}rad)`;
    },
    foot(text) {
      foot.style.display = text ? '' : 'none';
      foot.textContent = text || '';
    },
    /** Name tags: [{ key, x, y (screen), text, me }] */
    tags(list) {
      const seen = new Set();
      for (const t of list) {
        seen.add(t.key);
        let e = tags.get(t.key);
        if (!e) {
          e = el('div', 'tag', labelsRoot);
          tags.set(t.key, e);
        }
        if (e.textContent !== t.text) e.textContent = t.text;
        e.classList.toggle('me', !!t.me);
        e.classList.toggle('call', !!t.call);
        e.style.left = `${t.x}px`;
        e.style.top = `${t.y}px`;
        e.style.display = '';
      }
      for (const [k, e] of tags) {
        if (!seen.has(k)) {
          e.remove();
          tags.delete(k);
        }
      }
    },
  };
  return hud;
}

export { TROUPES };
