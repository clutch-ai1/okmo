// js/avatars-ui.js
// Avatar shop UI — rendered inside the Shop modal's Crystal Shop tab.
// Players spend crystals to buy avatars; equipping one is free.

const AvatarUI = (function () {
  // Fallback catalog used if server doesn't respond. Mirrors server/avatars.js.
  const FALLBACK_CATALOG = [
    { id: 'default',  name: 'Default Trainer', priceCrystals: 0,    rarity: 'free',      sprite: null,
      description: 'The default trainer based on your gender selection.' },
    { id: 'geckot',   name: 'Geckot',          priceCrystals: 200,  rarity: 'rare',      sprite: 'assets/avatars/geckot.png',
      description: 'A bold gecko-themed trainer.' },
    { id: 'lucario',  name: 'Lucario',         priceCrystals: 200,  rarity: 'rare',      sprite: 'assets/avatars/lucario.png',
      description: 'Channel your inner aura.' },
    { id: 'skepoke',  name: 'Skepoke',         priceCrystals: 200,  rarity: 'rare',      sprite: 'assets/avatars/skepoke.png',
      description: 'Mysterious skeleton vibe.' },
    { id: 'spacechu', name: 'Spacechu',        priceCrystals: 200,  rarity: 'rare',      sprite: 'assets/avatars/spacechu.png',
      description: 'Pikachu, but cosmic.' },
    { id: 'goldmew',  name: 'Gold Mew',        priceCrystals: 250,  rarity: 'epic',      sprite: 'assets/avatars/goldmew.png',
      description: 'A shimmering golden mythical.' },
    { id: 'goldt',    name: 'Gold T',          priceCrystals: 500,  rarity: 'legendary', sprite: 'assets/avatars/goldt.png',
      description: 'The prestige gold avatar.' },
  ];
  let _catalog = [];
  let _fallbackTimer = null;

  function init() {
    Net.on('avatar_catalog', (avatars) => {
      _catalog = avatars || [];
      AvatarUI._catalog = _catalog;
      renderAvatarTab();
      if (UI.renderAvatarSwitcher) UI.renderAvatarSwitcher();
    });
    Net.on('avatar_result', (msg) => {
      if (msg.ok) {
        if (msg.action === 'bought') UI.toast('🎨 Avatar unlocked!', 'success');
        else if (msg.action === 'equipped') UI.toast('✓ Avatar equipped', 'success');
        if (msg.user) Net.state.user = msg.user;
        if (UI.refreshHud) UI.refreshHud();
        renderAvatarTab();
        if (UI.renderAvatarSwitcher) UI.renderAvatarSwitcher();
        if (UI.renderProfile && Net.state.user && document.getElementById('profile-modal') && !document.getElementById('profile-modal').classList.contains('hidden')) {
          // Refresh profile so the avatar updates
          Net.requestProfile(Net.state.user.id);
        }
      } else {
        UI.toast('❌ ' + (msg.reason || 'Avatar action failed'), 'error');
      }
    });
  }

  function fetchCatalog() {
    Net.send('request_avatars');
    // Fallback after 2.5s if no server response — use embedded catalog so the UI works
    if (_fallbackTimer) clearTimeout(_fallbackTimer);
    _fallbackTimer = setTimeout(() => {
      if (!_catalog.length) {
        console.warn('[avatars] server did not respond, using fallback catalog');
        _catalog = FALLBACK_CATALOG.slice();
        AvatarUI._catalog = _catalog;
        renderAvatarTab();
        if (UI.renderAvatarSwitcher) UI.renderAvatarSwitcher();
      }
    }, 2500);
  }

  function rarityColor(r) {
    return ({ free:'#6c7796', common:'#a4b0be', rare:'#74b9ff', epic:'#a040d8',
              legendary:'#ffd166', mythical:'#ff6b6b' })[r] || '#cbd5f0';
  }

  function renderAvatarTab() {
    const grid = document.getElementById('avatar-shop-grid');
    if (!grid) return;
    const u = Net.state.user || {};
    const owned = new Set(['default', ...(u.ownedAvatars || [])]);
    const equipped = u.avatar || 'default';
    const userGenderSprite = (u.gender === 'female') ? 'assets/trainers/female.png' : 'assets/trainers/male.png';

    if (!_catalog.length) {
      grid.innerHTML = '<div class="empty-state">Loading avatars… <button id="av-retry" class="secondary-btn" style="margin-left:8px;">↻ Retry</button></div>';
      const retryBtn = document.getElementById('av-retry');
      if (retryBtn) retryBtn.onclick = () => fetchCatalog();
      // Auto-retry once after 2s if still empty
      setTimeout(() => { if (!_catalog.length) fetchCatalog(); }, 2000);
      return;
    }

    grid.innerHTML = _catalog.map(av => {
      const isOwned = owned.has(av.id);
      const isEquipped = av.id === equipped;
      const sprite = av.sprite || userGenderSprite;
      const rColor = rarityColor(av.rarity);
      let actionBtn;
      if (isEquipped) {
        actionBtn = '<button class="av-btn equipped" disabled>✓ Equipped</button>';
      } else if (isOwned) {
        actionBtn = '<button class="av-btn equip" data-id="' + av.id + '">Equip</button>';
      } else {
        actionBtn = '<button class="av-btn buy" data-id="' + av.id + '">💎 ' + av.priceCrystals + '</button>';
      }
      return '<div class="avatar-card' + (isEquipped ? ' equipped' : '') + (isOwned ? ' owned' : '') + '" style="border-color:' + rColor + '40">' +
        '<div class="av-rarity" style="color:' + rColor + '">' + av.rarity.toUpperCase() + '</div>' +
        '<div class="av-image"><img src="' + sprite + '" alt="' + av.name + '" loading="lazy"></div>' +
        '<div class="av-name">' + av.name + '</div>' +
        '<div class="av-desc">' + (av.description || '') + '</div>' +
        actionBtn +
      '</div>';
    }).join('');

    grid.querySelectorAll('.av-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (!id) return;
        if (btn.classList.contains('buy')) {
          const av = _catalog.find(a => a.id === id);
          if (!av) return;
          if ((u.crystals || 0) < av.priceCrystals) {
            UI.toast('Not enough crystals — get more in 💎 Get Crystals', 'error');
            return;
          }
          if (!confirm('Buy "' + av.name + '" for 💎 ' + av.priceCrystals + '?\n(Crystals balance: ' + (u.crystals || 0) + ')')) return;
          Net.send('buy_avatar', { avatarId: id });
        } else if (btn.classList.contains('equip')) {
          Net.send('equip_avatar', { avatarId: id });
        }
      };
    });
  }

  function open() {
    fetchCatalog();
    renderAvatarTab();
  }

  return { init, open, renderAvatarTab, fetchCatalog };
})();
window.AvatarUI = AvatarUI;
