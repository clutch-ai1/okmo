// js/chat.js
// Chat panel renderer + input handler.

const ChatUI = (function () {
  let logEl, inputEl, formEl, onlineEl;

  function init() {
    logEl = document.getElementById('chat-log');
    inputEl = document.getElementById('chat-input');
    formEl = document.getElementById('chat-form');
    onlineEl = document.getElementById('chat-online');
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (!text) return;
      Net.chat(text);
      inputEl.value = '';
    });
  }

  function isAdmin() {
    return window.Net && Net.state && Net.state.user && Net.state.user.username === 'admin';
  }
  function adminBanBtn(m) {
    if (!isAdmin()) return '';
    if (!m.userId || m.username === 'admin') return '';
    return ' <button class="chat-ban-btn" data-uid="' + m.userId + '" data-uname="' + escape(m.username) + '" title="Ban ' + escape(m.username) + '">🔨</button>';
  }
  function appendMessage(m) {
    const el = document.createElement('div');
    el.className = 'chat-msg type-' + m.type;
    const titleStr = m.title ? '<span class="chat-title">« ' + escape(m.title) + ' »</span> ' : '';
    if (m.type === 'system') {
      el.innerHTML = '<span class="chat-sys">' + escape(m.content) + '</span>';
    } else if (m.type === 'show' && m.payload) {
      const p = GameData.POKEMON_BY_ID[m.payload.pokemonId];
      const tier = ivTier(m.payload.ivTotal / 186);
      const power = Math.round(m.payload.ivTotal / 186 * 100);
      el.innerHTML =
        titleStr +
        '<span class="chat-from chat-username-link" data-uid="' + m.userId + '" data-uname="' + escape(m.username) + '">' + escape(m.username) + '</span>' +
        adminBanBtn(m) + ' ' +
        '<span class="chat-shows">shows their</span> ' +
        '<div class="chat-card" style="border-color:' + tier.color + '">' +
          '<img src="' + (m.payload.isShiny ? p.spriteShinyUrl : p.spriteUrl) + '" alt="" onerror="this.outerHTML=\'' + p.emoji + '\'">' +
          '<div><div class="chat-card-name">' + p.name + (m.payload.isShiny ? ' ✨' : '') + '</div>' +
          '<div class="chat-card-meta" style="color:' + tier.color + '">' + tier.name + ' · IV ' + m.payload.ivTotal + '/186 · Power ' + power + '</div></div>' +
        '</div>';
    } else {
      el.innerHTML = titleStr + '<span class="chat-from chat-username-link" data-uid="' + m.userId + '" data-uname="' + escape(m.username) + '">' + escape(m.username) + ':</span>' + adminBanBtn(m) + ' ' + escape(m.content);
    }
    logEl.appendChild(el);
    // Wire username clicks to profile
    el.querySelectorAll('.chat-username-link').forEach(span => {
      span.style.cursor = 'pointer';
      span.onclick = () => {
        const id = parseInt(span.dataset.uid, 10);
        const uname = span.dataset.uname;
        if (window.UI && UI.openProfile) UI.openProfile(id, uname);
      };
    });
    el.querySelectorAll('.chat-ban-btn').forEach(btn => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        const uid = parseInt(btn.dataset.uid, 10);
        const uname = btn.dataset.uname;
        const reason = prompt('Ban reason for ' + uname + ':', '');
        if (reason === null) return;
        Net.adminBanUser(uid, reason);
      };
    });
    while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setMessages(arr) {
    logEl.innerHTML = '';
    for (const m of arr) appendMessage(m);
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function ivTier(p) {
    if (p >= 0.95) return { name: 'Perfect',   color: '#ffd166' };
    if (p >= 0.80) return { name: 'Excellent', color: '#ff9f43' };
    if (p >= 0.60) return { name: 'Great',     color: '#7bed9f' };
    if (p >= 0.40) return { name: 'Decent',    color: '#74b9ff' };
    if (p >= 0.20) return { name: 'Weak',      color: '#a4b0be' };
    return                { name: 'Pathetic', color: '#636e72' };
  }

  return { init, appendMessage, setMessages };
})();
window.ChatUI = ChatUI;
