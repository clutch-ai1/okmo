// client/js/battle.js
// UI-Steuerung fuer Wild-Encounter-Battles.

const MOVE_LABELS = {
  tackle:'Tackle', scratch:'Scratch', ember:'Ember', flamethrower:'Flammenwurf',
  watergun:'Wasserpistole', hydropump:'Hydropumpe', vinewhip:'Rankenhieb',
  solarbeam:'Solarstrahl', thundershock:'Donnerschock', thunderbolt:'Donnerblitz',
  bite:'Biss', quickattack:'Ruckzuckhieb',
};

class BattleUI {
  constructor(net) {
    this.net = net;
    this.overlay = document.getElementById('battle-overlay');
    this.logEl   = document.getElementById('battle-log');
    this.moveBtns= document.getElementById('move-buttons');
    this.fleeBtn = document.getElementById('flee-btn');
    this.contBtn = document.getElementById('continue-btn');
    this.onClose = null;

    this.fleeBtn.addEventListener('click', () => this._action({ action: 'flee' }));
    this.contBtn.addEventListener('click', () => this._close());

    this.lastLogLen = 0;
    this.busy = false;
  }

  open(state) {
    this.overlay.classList.remove('hidden');
    this.contBtn.classList.add('hidden');
    this.fleeBtn.disabled = false;
    this.lastLogLen = 0;
    this.logEl.innerHTML = '';
    this._render(state);
  }

  update(state) { this._render(state); }

  end(state) {
    this._render(state);
    this.moveBtns.innerHTML = '';
    this.fleeBtn.classList.add('hidden');
    this.contBtn.classList.remove('hidden');
  }

  _close() {
    this.overlay.classList.add('hidden');
    this.fleeBtn.classList.remove('hidden');
    if (this.onClose) this.onClose();
  }

  _action(payload) {
    if (this.busy) return;
    this.busy = true;
    this.net.send('battle_action', payload);
    setTimeout(() => { this.busy = false; }, 300);
  }

  _render(state) {
    const p = state.player;
    const w = state.wild;

    document.getElementById('wild-name').textContent  = w.name;
    document.getElementById('wild-level').textContent = `Lv.${w.level} (${w.type})`;
    document.getElementById('player-name').textContent  = p.name;
    document.getElementById('player-level').textContent = `Lv.${p.level} (${p.type})`;

    setHpBar('wild-hp', w.hp, w.maxHp);
    setHpBar('player-hp', p.hp, p.maxHp);
    document.getElementById('player-hp-text').textContent = `HP ${p.hp} / ${p.maxHp}`;

    // EXP-Balken (gegen die Schwelle des aktuellen Levels)
    const expNeed = Math.floor(Math.pow(p.level, 2.5) + 10);
    const expPct = Math.max(0, Math.min(100, (p.exp / expNeed) * 100));
    document.getElementById('player-exp').style.width = expPct + '%';

    // Move-Buttons aufbauen
    this.moveBtns.innerHTML = '';
    if (!state.over) {
      for (const m of p.moves) {
        const btn = document.createElement('button');
        btn.textContent = MOVE_LABELS[m] || m;
        btn.addEventListener('click', () => this._action({ action: 'move', moveKey: m }));
        this.moveBtns.appendChild(btn);
      }
    }

    // Neue Log-Eintraege anhaengen
    const newLines = state.log.slice(this.lastLogLen);
    for (const line of newLines) {
      const el = document.createElement('div');
      el.textContent = line;
      this.logEl.appendChild(el);
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
    this.lastLogLen = state.log.length;
  }
}

function setHpBar(id, hp, max) {
  const fill = document.getElementById(id);
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  fill.style.width = pct + '%';
  fill.classList.remove('low', 'critical');
  if (pct <= 20) fill.classList.add('critical');
  else if (pct <= 50) fill.classList.add('low');
}

window.BattleUI = BattleUI;
