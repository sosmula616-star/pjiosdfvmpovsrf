// Musicium Staff Dashboard Client Logic
(function () {
  let currentGuildId = null;
  let activeTab = 'overview';
  let guildData = null;
  let currentRolePermissions = []; // { channelId, allow: [], deny: [] }
  let allLogs = [];
  let currentLogCategory = 'all';

  // Automatically attach auth token from localStorage if available
  const originalFetch = window.fetch;
  window.fetch = function (url, options = {}) {
    options = options || {};
    const token = localStorage.getItem('musicium_admin_token');
    if (token) {
      if (!options.headers) {
        options.headers = {};
      }
      if (options.headers instanceof Headers) {
        if (!options.headers.has('Authorization')) {
          options.headers.set('Authorization', `Bearer ${token}`);
        }
      } else if (Array.isArray(options.headers)) {
        const hasAuth = options.headers.some(([k]) => k.toLowerCase() === 'authorization');
        if (!hasAuth) {
          options.headers.push(['Authorization', `Bearer ${token}`]);
        }
      } else {
        if (!options.headers['Authorization'] && !options.headers['authorization']) {
          options.headers['Authorization'] = `Bearer ${token}`;
        }
      }
    }
    return originalFetch(url, options);
  };

  // Elements
  const loginScreen = document.getElementById('login-screen');
  const dashboardApp = document.getElementById('dashboard-app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const togglePwdBtn = document.getElementById('toggle-pwd-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const guildSelect = document.getElementById('guild-select');
  const refreshDataBtn = document.getElementById('refresh-data-btn');

  // Toasts
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';
    if (type === 'warning') icon = 'fa-circle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Toggle password visibility
  if (togglePwdBtn && passwordInput) {
    togglePwdBtn.addEventListener('click', () => {
      const isPwd = passwordInput.type === 'password';
      passwordInput.type = isPwd ? 'text' : 'password';
      togglePwdBtn.innerHTML = isPwd ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    });
  }

  // Check initial Auth
  async function checkAuth() {
    try {
      const res = await fetch('/api/me');
      const data = await res.json();

      // Bot Status in Login screen
      const botDot = document.getElementById('login-bot-status-dot');
      const botText = document.getElementById('login-bot-status-text');
      const dbInfo = (data.db && data.db.connected) ? ' • 🗄️ PostgreSQL подключена' : '';
      if (data.bot && data.bot.ready) {
        if (botDot) botDot.classList.add('online');
        if (botText) botText.textContent = `Бот подключен (${data.bot.guildCount} серверов, пинг ${data.bot.ping}ms)${dbInfo}`;
      } else {
        if (botText) botText.textContent = `Бот ожидает токен в .env${dbInfo}`;
      }

      if (data.authenticated) {
        loginScreen.classList.add('hidden');
        dashboardApp.classList.remove('hidden');
        updateBotUI(data.bot);
        loadGuilds();
      } else {
        loginScreen.classList.remove('hidden');
        dashboardApp.classList.add('hidden');
      }
    } catch (err) {
      console.error('Auth check error:', err);
    }
  }

  function updateBotUI(bot) {
    if (!bot) return;
    const nameEl = document.getElementById('bot-username');
    const pingEl = document.getElementById('bot-ping');
    const avatarEl = document.getElementById('bot-avatar');
    if (nameEl) nameEl.textContent = bot.username;
    if (pingEl) pingEl.textContent = `Пинг: ${bot.ping}ms`;
    if (avatarEl && bot.avatar) avatarEl.src = bot.avatar;
  }

  // Login submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = passwordInput.value;
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (data.success) {
          if (data.token) {
            localStorage.setItem('musicium_admin_token', data.token);
          }
          showToast('Успешный вход в панель Musicium Staff', 'success');
          checkAuth();
        } else {
          showToast(data.error || 'Неверный пароль', 'error');
        }
      } catch (err) {
        showToast('Ошибка сети при авторизации', 'error');
      }
    });
  }

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      localStorage.removeItem('musicium_admin_token');
      await fetch('/api/logout', { method: 'POST' });
      showToast('Вы вышли из системы');
      checkAuth();
    });
  }

  // Tab switching
  window.switchTab = function (tabName) {
    activeTab = tabName;
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabName}`);
    });

    const titles = {
      overview: { title: 'Обзор сервера', sub: 'Мониторинг защиты и активности сообщества' },
      permissions: { title: 'Управление правами ролей', sub: 'Настройте доступ для любой роли в каждом канале сообщества' },
      anticrash: { title: 'Параметры Антикраша', sub: 'Защитные пороги и автоматические меры реагирования' },
      moderation: { title: 'Модерация & Варны', sub: 'Управление временными банами, мутами и предупреждениями' },
      profiles: { title: 'Профили & Уровни', sub: 'Карточки участников, кастомизация фона, учет времени в войсе и лидерборд' },
      logs: { title: 'Журналы аудита', sub: '6 категорий подробного мониторинга событий сервера' },
      tickets: { title: 'Тикеты & Баг-репорты', sub: 'Управление обращениями участников и баг-трекером сообщества' },
      setup: { title: 'Автонастройка сервера', sub: '1-Click создание каналов для музыкального сообщества' }
    };

    const header = titles[tabName] || { title: 'Панель управления', sub: '' };
    document.getElementById('page-title').textContent = header.title;
    document.getElementById('page-subtitle').textContent = header.sub;

    if (currentGuildId) {
      if (tabName === 'permissions') loadPermissionsTab();
      if (tabName === 'anticrash') loadAntiCrashTab();
      if (tabName === 'moderation') loadModerationTab();
      if (tabName === 'profiles') loadProfilesTab();
      if (tabName === 'logs') loadLogsTab();
      if (tabName === 'tickets') loadTicketsTab();
    }
  };

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      window.switchTab(btn.dataset.tab);
    });
  });

  // Load Guilds
  async function loadGuilds() {
    try {
      const res = await fetch('/api/guilds');
      const data = await res.json();
      guildSelect.innerHTML = '';

      if (!data.guilds || data.guilds.length === 0) {
        guildSelect.innerHTML = '<option value="">Нет доступных серверов</option>';
        showToast('Бот не добавлен ни на один сервер Discord', 'warning');
        return;
      }

      data.guilds.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} (${g.memberCount} уч.)`;
        guildSelect.appendChild(opt);
      });

      currentGuildId = data.guilds[0].id;
      guildSelect.value = currentGuildId;
      onGuildSelected(currentGuildId);
    } catch (err) {
      console.error(err);
      showToast('Ошибка загрузки списка серверов', 'error');
    }
  }

  guildSelect.addEventListener('change', () => {
    currentGuildId = guildSelect.value;
    onGuildSelected(currentGuildId);
  });

  if (refreshDataBtn) {
    refreshDataBtn.addEventListener('click', () => {
      if (currentGuildId) {
        showToast('Обновление данных...', 'info');
        onGuildSelected(currentGuildId);
      }
    });
  }

  async function onGuildSelected(guildId) {
    try {
      const res = await fetch(`/api/guild/${guildId}`);
      guildData = await res.json();

      document.getElementById('current-server-name').textContent = guildData.name;
      document.getElementById('stat-members').textContent = guildData.memberCount;
      document.getElementById('stat-channels').textContent = guildData.channels.length;
      document.getElementById('stat-roles').textContent = guildData.roles.length;

      // Populate Role select in permissions tab
      const permRoleSelect = document.getElementById('perm-role-select');
      permRoleSelect.innerHTML = '';
      guildData.roles.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.isEveryone ? '@everyone (Все участники)' : `@${r.name}`;
        permRoleSelect.appendChild(opt);
      });

      // Load active tab data
      window.switchTab(activeTab);
    } catch (err) {
      console.error(err);
    }
  }

  // ----------------------------------------------------
  // PERMISSIONS MANAGER ("где я буду выбирать для какой роли что где открыть а что запретить")
  // ----------------------------------------------------
  const permRoleSelect = document.getElementById('perm-role-select');
  if (permRoleSelect) {
    permRoleSelect.addEventListener('change', () => {
      loadPermissionsForSelectedRole();
    });
  }

  async function loadPermissionsTab() {
    if (!permRoleSelect.value && guildData && guildData.roles.length > 0) {
      permRoleSelect.value = guildData.roles[0].id;
    }
    loadPermissionsForSelectedRole();
  }

  async function loadPermissionsForSelectedRole() {
    const roleId = permRoleSelect.value;
    if (!roleId || !currentGuildId) return;

    const container = document.getElementById('permissions-container');
    container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Получение прав из Discord...</div>';

    try {
      const res = await fetch(`/api/guild/${currentGuildId}/roles/${roleId}/permissions`);
      const data = await res.json();
      currentRolePermissions = data.overwrites || [];

      renderPermissionsMatrix(container, currentRolePermissions);
    } catch (err) {
      container.innerHTML = `<div class="text-danger">Ошибка загрузки прав: ${err.message}</div>`;
    }
  }

  // Key permission keys to toggle
  const KEY_PERMS = [
    { key: 'ViewChannel', label: 'Просмотр', icon: 'fa-eye' },
    { key: 'SendMessages', label: 'Сообщения', icon: 'fa-comment' },
    { key: 'AttachFiles', label: 'Файлы', icon: 'fa-paperclip' },
    { key: 'Connect', label: 'Голос', icon: 'fa-headphones' },
    { key: 'Speak', label: 'Говорить', icon: 'fa-microphone' },
    { key: 'ManageChannels', label: 'Управление', icon: 'fa-gear' }
  ];

  function renderPermissionsMatrix(container, overwrites) {
    container.innerHTML = '';

    if (!guildData || !guildData.channels) {
      container.innerHTML = '<div class="text-muted">Нет каналов</div>';
      return;
    }

    // Map channels
    guildData.channels.forEach(ch => {
      const ow = overwrites.find(o => o.channelId === ch.id) || { allow: [], deny: [] };
      const row = document.createElement('div');
      const isCat = ch.type === 4;
      row.className = `channel-perm-row ${isCat ? 'is-category' : ''}`;
      row.dataset.channelId = ch.id;

      let icon = 'fa-hashtag';
      if (ch.type === 2) icon = 'fa-volume-high';
      if (isCat) icon = 'fa-folder';

      let togglesHtml = '';
      KEY_PERMS.forEach(p => {
        const isAllow = ow.allow && ow.allow.includes(p.key);
        const isDeny = ow.deny && ow.deny.includes(p.key);
        const state = isAllow ? 'allow' : isDeny ? 'deny' : 'inherit';
        const iconState = isAllow ? 'fa-check' : isDeny ? 'fa-xmark' : 'fa-minus';

        togglesHtml += `
          <div class="perm-toggle-item" title="${p.label}: кликните для смены (Разрешить / Запретить / Наследовать)">
            <button type="button" class="tri-state-btn ${state}" data-perm="${p.key}" data-channel="${ch.id}">
              <i class="fa-solid ${iconState}"></i>
            </button>
            <span>${p.label}</span>
          </div>
        `;
      });

      row.innerHTML = `
        <div class="channel-info">
          <i class="fa-solid ${icon} channel-icon"></i>
          <span class="channel-name">${isCat ? '📁 ' + ch.name.toUpperCase() : ch.name}</span>
        </div>
        <div class="perm-buttons-group">
          ${togglesHtml}
        </div>
      `;

      container.appendChild(row);
    });

    // Add click listeners to tri-state buttons
    container.querySelectorAll('.tri-state-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const permKey = btn.dataset.perm;
        const channelId = btn.dataset.channel;
        let ow = currentRolePermissions.find(o => o.channelId === channelId);
        if (!ow) {
          ow = { channelId, allow: [], deny: [] };
          currentRolePermissions.push(ow);
        }

        // Cycle: inherit -> allow -> deny -> inherit
        if (btn.classList.contains('allow')) {
          // Switch to deny
          btn.className = 'tri-state-btn deny';
          btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
          ow.allow = ow.allow.filter(k => k !== permKey);
          if (!ow.deny.includes(permKey)) ow.deny.push(permKey);
        } else if (btn.classList.contains('deny')) {
          // Switch to inherit
          btn.className = 'tri-state-btn';
          btn.innerHTML = '<i class="fa-solid fa-minus"></i>';
          ow.allow = ow.allow.filter(k => k !== permKey);
          ow.deny = ow.deny.filter(k => k !== permKey);
        } else {
          // Switch to allow
          btn.className = 'tri-state-btn allow';
          btn.innerHTML = '<i class="fa-solid fa-check"></i>';
          if (!ow.allow.includes(permKey)) ow.allow.push(permKey);
          ow.deny = ow.deny.filter(k => k !== permKey);
        }
      });
    });
  }

  // Save Permissions button
  const savePermBtn = document.getElementById('save-permissions-btn');
  if (savePermBtn) {
    savePermBtn.addEventListener('click', async () => {
      const roleId = permRoleSelect.value;
      if (!roleId || !currentGuildId) return;

      savePermBtn.disabled = true;
      savePermBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Сохранение в Discord...';

      try {
        const res = await fetch(`/api/guild/${currentGuildId}/roles/${roleId}/permissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelPermissions: currentRolePermissions })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Права успешно сохранены для ${data.updatedCount} каналов!`, 'success');
        } else {
          showToast('Ошибка при сохранении прав', 'error');
        }
      } catch (err) {
        showToast('Сбой сети при сохранении прав', 'error');
      } finally {
        savePermBtn.disabled = false;
        savePermBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Сохранить права в Discord';
      }
    });
  }

  // ----------------------------------------------------
  // ANTI-CRASH LIMITS ("так же лимиты изменений для антикраша")
  // ----------------------------------------------------
  const sliders = [
    { id: 'limit-channel-delete', valId: 'val-ch-del' },
    { id: 'limit-channel-create', valId: 'val-ch-create' },
    { id: 'limit-role-delete', valId: 'val-role-del' },
    { id: 'limit-role-create', valId: 'val-role-create' },
    { id: 'limit-ban-add', valId: 'val-ban-add' },
    { id: 'limit-kick', valId: 'val-kick' },
    { id: 'limit-webhook', valId: 'val-webhook' },
    { id: 'limit-window', valId: 'val-window' }
  ];

  sliders.forEach(s => {
    const el = document.getElementById(s.id);
    const valEl = document.getElementById(s.valId);
    if (el && valEl) {
      el.addEventListener('input', () => {
        valEl.textContent = el.value;
      });
    }
  });

  async function loadAntiCrashTab() {
    if (!currentGuildId) return;
    try {
      const res = await fetch(`/api/guild/${currentGuildId}/anticrash`);
      const ac = await res.json();

      document.getElementById('ac-enable-toggle').checked = ac.enabled !== false;
      document.getElementById('ac-status-label').textContent = ac.enabled !== false ? 'Щит включен' : 'Щит выключен';

      if (ac.limits) {
        setSlider('limit-channel-delete', 'val-ch-del', ac.limits.channelDelete || 2);
        setSlider('limit-channel-create', 'val-ch-create', ac.limits.channelCreate || 3);
        setSlider('limit-role-delete', 'val-role-del', ac.limits.roleDelete || 2);
        setSlider('limit-role-create', 'val-role-create', ac.limits.roleCreate || 3);
        setSlider('limit-ban-add', 'val-ban-add', ac.limits.banAdd || 3);
        setSlider('limit-kick', 'val-kick', ac.limits.memberKick || 3);
        setSlider('limit-webhook', 'val-webhook', ac.limits.webhookCreate || 2);
      }
      setSlider('limit-window', 'val-window', ac.windowSeconds || 60);

      // Action radio
      const radio = document.querySelector(`input[name="ac-action"][value="${ac.action || 'quarantine'}"]`);
      if (radio) radio.checked = true;

      // Whitelist
      document.getElementById('ac-whitelist-roles').value = (ac.whitelistRoles || []).join(', ');
      document.getElementById('ac-whitelist-users').value = (ac.whitelistUsers || []).join(', ');

      // Load Special Roles (Mute, Ban, Verified)
      await loadSpecialRoles();
      // Load Anti-Crash Offenders recorded in Database
      await loadAntiCrashUsers();
      // Load 1-Hour Recent Actions for Rollback
      await loadRecentActions();
    } catch (err) {
      console.error(err);
    }
  }

  async function loadSpecialRoles() {
    try {
      const res = await fetch(`/api/guild/${currentGuildId}/special-roles`);
      const data = await res.json();
      const roles = data.specialRoles || {};

      const muteInput = document.getElementById('role-mute-id');
      const banInput = document.getElementById('role-ban-id');
      const verifiedInput = document.getElementById('role-verified-id');

      if (muteInput) muteInput.value = roles.muteRoleId || '';
      if (banInput) banInput.value = roles.banRoleId || '';
      if (verifiedInput) verifiedInput.value = roles.verifiedRoleId || '';
    } catch (e) {
      console.error(e);
    }
  }

  async function loadRecentActions() {
    try {
      const res = await fetch(`/api/guild/${currentGuildId}/recent-actions`);
      const data = await res.json();
      const tbody = document.getElementById('recent-actions-tbody');
      if (!tbody) return;

      const actions = data.actions || [];
      if (actions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Нет опасных действий за последний час</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      actions.forEach(a => {
        const tr = document.createElement('tr');
        const time = new Date(a.timestamp).toLocaleTimeString('ru-RU');
        tr.innerHTML = `
          <td><code>${time}</code></td>
          <td><small class="text-muted">\`${a.executorId}\`</small></td>
          <td><span class="badge badge-staff">${a.actionType}</span> ${a.details}</td>
          <td>
            <button class="btn btn-sm btn-danger rollback-btn" data-id="${a.executorId}">
              <i class="fa-solid fa-rotate-left"></i> Откатить
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.rollback-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const executorId = btn.dataset.id;
          const confirmRollback = confirm(`Откатить все действия пользователя ${executorId} за последний час?`);
          if (!confirmRollback) return;

          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

          try {
            const res = await fetch(`/api/guild/${currentGuildId}/rollback/${executorId}`, { method: 'POST' });
            const result = await res.json();
            if (result.success) {
              const r = result.result;
              showToast(`Откат завершен! Восстановлено каналов: ${r.restoredChannels}, ролей: ${r.restoredRoles}, разбанено: ${r.unbannedUsers}`, 'success');
              loadRecentActions();
              onGuildSelected(currentGuildId);
            } else {
              showToast('Ошибка при откате действий', 'error');
            }
          } catch (e) {
            showToast('Сетевой сбой при откате', 'error');
          } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Откатить';
          }
        });
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Load Anti-Crash Offenders from PostgreSQL / DB
  async function loadAntiCrashUsers() {
    if (!currentGuildId) return;
    try {
      const res = await fetch(`/api/guild/${currentGuildId}/anticrash-users`);
      const data = await res.json();
      const tbody = document.getElementById('ac-users-tbody');
      if (!tbody) return;

      const users = data.users || [];
      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted"><i class="fa-solid fa-shield-halved text-green"></i> Нарушителей не зафиксировано. Все спокойно, антикраш ведет круглосуточный мониторинг.</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        const time = new Date(u.timestamp).toLocaleString('ru-RU');
        const avatar = u.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
        const isActive = u.status === 'active';
        const statusBadge = isActive 
          ? '<span class="badge badge-danger"><i class="fa-solid fa-shield-virus"></i> Под санкциями</span>'
          : `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Снято (${u.releasedBy || 'Админ'})</span>`;

        tr.innerHTML = `
          <td>
            <div class="user-cell">
              <img src="${avatar}" class="table-avatar" alt="Avatar">
              <div>
                <strong>${u.userTag}</strong>
                <small class="text-muted d-block">\`${u.userId}\`</small>
              </div>
            </div>
          </td>
          <td>
            <span class="badge badge-staff">${u.actionType}</span>
            <small class="d-block text-muted">${u.count} из ${u.limit} в мин</small>
          </td>
          <td><span class="text-warning"><strong>${u.punishment}</strong></span></td>
          <td><small class="text-muted">${u.rollbackSummary || 'Откат применен'}</small></td>
          <td><small><code>${time}</code></small></td>
          <td>${statusBadge}</td>
          <td>
            <div class="table-actions">
              ${isActive ? `
                <button class="btn btn-sm btn-outline-warning release-ac-btn" data-id="${u.id}" title="Снять санкции">
                  <i class="fa-solid fa-unlock"></i> Снять
                </button>
              ` : ''}
              <button class="btn btn-sm btn-danger delete-ac-btn" data-id="${u.id}" title="Удалить запись из БД">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind release buttons
      tbody.querySelectorAll('.release-ac-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          btn.disabled = true;
          try {
            const res = await fetch(`/api/guild/${currentGuildId}/anticrash-users/${id}/release`, { method: 'POST' });
            const result = await res.json();
            if (result.success) {
              showToast('Статус санкций обновлен в базе данных', 'success');
              loadAntiCrashUsers();
            } else {
              showToast(result.error || 'Ошибка обновления статуса', 'error');
            }
          } catch (e) {
            showToast('Ошибка сети', 'error');
          }
        });
      });

      // Bind delete buttons
      tbody.querySelectorAll('.delete-ac-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('Удалить эту запись нарушителя из постоянной базы данных PostgreSQL?')) return;
          btn.disabled = true;
          try {
            const res = await fetch(`/api/guild/${currentGuildId}/anticrash-users/${id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
              showToast('Запись удалена из базы данных', 'success');
              loadAntiCrashUsers();
            } else {
              showToast(result.error || 'Ошибка удаления', 'error');
            }
          } catch (e) {
            showToast('Ошибка сети', 'error');
          }
        });
      });

    } catch (e) {
      console.error(e);
    }
  }

  // Refresh Anticrash Users Button
  const refreshAcUsersBtn = document.getElementById('refresh-ac-users-btn');
  if (refreshAcUsersBtn) {
    refreshAcUsersBtn.addEventListener('click', () => {
      loadAntiCrashUsers();
    });
  }

  function setSlider(sliderId, valId, val) {
    const s = document.getElementById(sliderId);
    const v = document.getElementById(valId);
    if (s && v) {
      s.value = val;
      v.textContent = val;
    }
  }

  // Save Special Roles Button
  const saveSpecialRolesBtn = document.getElementById('save-special-roles-btn');
  if (saveSpecialRolesBtn) {
    saveSpecialRolesBtn.addEventListener('click', async () => {
      if (!currentGuildId) return;

      const muteRoleId = document.getElementById('role-mute-id')?.value.trim();
      const banRoleId = document.getElementById('role-ban-id')?.value.trim();
      const verifiedRoleId = document.getElementById('role-verified-id')?.value.trim();

      saveSpecialRolesBtn.disabled = true;
      saveSpecialRolesBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Синхронизация каналов...';

      try {
        const res = await fetch(`/api/guild/${currentGuildId}/special-roles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ muteRoleId, banRoleId, verifiedRoleId })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'Роли сохранены и права каналов обновлены!', 'success');
        } else {
          showToast(data.error || 'Ошибка при настройке ролей', 'error');
        }
      } catch (e) {
        showToast('Сетевая ошибка при настройке ролей', 'error');
      } finally {
        saveSpecialRolesBtn.disabled = false;
        saveSpecialRolesBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Применить роли и настроить каналы';
      }
    });
  }

  // Run Channel Check Button
  const runChannelCheckBtn = document.getElementById('run-channel-check-btn');
  if (runChannelCheckBtn) {
    runChannelCheckBtn.addEventListener('click', async () => {
      if (!currentGuildId) return;

      runChannelCheckBtn.disabled = true;
      runChannelCheckBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Проверка каналов...';

      try {
        const res = await fetch(`/api/guild/${currentGuildId}/check-channels`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          const st = data.status;
          showToast(`Проверено каналов: ${st.checked}. Восстановлено: ${st.restored}.`, st.restored > 0 ? 'warning' : 'success');
          onGuildSelected(currentGuildId);
        }
      } catch (e) {
        showToast('Ошибка при проверке каналов', 'error');
      } finally {
        runChannelCheckBtn.disabled = false;
        runChannelCheckBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Проверить и восстановить каналы сейчас';
      }
    });
  }

  const saveAcBtn = document.getElementById('save-anticrash-btn');
  if (saveAcBtn) {
    saveAcBtn.addEventListener('click', async () => {
      if (!currentGuildId) return;

      const actionChosen = document.querySelector('input[name="ac-action"]:checked')?.value || 'quarantine';
      const payload = {
        enabled: document.getElementById('ac-enable-toggle').checked,
        action: actionChosen,
        windowSeconds: parseInt(document.getElementById('limit-window').value, 10),
        limits: {
          channelDelete: parseInt(document.getElementById('limit-channel-delete').value, 10),
          channelCreate: parseInt(document.getElementById('limit-channel-create').value, 10),
          roleDelete: parseInt(document.getElementById('limit-role-delete').value, 10),
          roleCreate: parseInt(document.getElementById('limit-role-create').value, 10),
          banAdd: parseInt(document.getElementById('limit-ban-add').value, 10),
          memberKick: parseInt(document.getElementById('limit-kick').value, 10),
          webhookCreate: parseInt(document.getElementById('limit-webhook').value, 10)
        },
        whitelistRoles: document.getElementById('ac-whitelist-roles').value.split(',').map(s => s.trim()).filter(Boolean),
        whitelistUsers: document.getElementById('ac-whitelist-users').value.split(',').map(s => s.trim()).filter(Boolean)
      };

      try {
        const res = await fetch(`/api/guild/${currentGuildId}/anticrash`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('Лимиты и параметры Антикраша успешно сохранены!', 'success');
        }
      } catch (err) {
        showToast('Ошибка при сохранении антикраша', 'error');
      }
    });
  }

  // ----------------------------------------------------
  // MODERATION & WARNS ("систему варнов и т.п., всё это выводить мне на сайт")
  // ----------------------------------------------------
  async function loadModerationTab() {
    if (!currentGuildId) return;
    loadActiveBans();
    loadActiveMutes();
    loadWarns();
  }

  async function loadActiveBans() {
    try {
      const res = await fetch(`/api/guild/${currentGuildId}/active-bans`);
      const data = await res.json();
      const tbody = document.getElementById('bans-table-body');
      const countEl = document.getElementById('active-bans-count');

      const bans = data.bans || [];
      countEl.textContent = bans.length;

      if (bans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Нет активных временных банов</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      bans.forEach(b => {
        const tr = document.createElement('tr');
        const expireText = b.expiresAt ? new Date(b.expiresAt).toLocaleString('ru-RU') : 'Навсегда';
        tr.innerHTML = `
          <td><strong>${b.userTag || b.userId}</strong><br><small class="text-muted">\`${b.userId}\`</small></td>
          <td><span class="badge ${b.expiresAt ? 'badge-yellow' : 'badge-danger'}">${expireText}</span></td>
          <td>${b.reason || '—'}</td>
          <td><button class="btn btn-sm btn-secondary unban-btn" data-id="${b.userId}"><i class="fa-solid fa-unlock"></i> Разбан</button></td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.unban-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = btn.dataset.id;
          await fetch(`/api/guild/${currentGuildId}/mod-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unban', targetId: userId, reason: 'Разбан через веб-панель' })
          });
          showToast(`Пользователь ${userId} разбанен`, 'success');
          loadActiveBans();
        });
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function loadActiveMutes() {
    try {
      const res = await fetch(`/api/guild/${currentGuildId}/active-mutes`);
      const data = await res.json();
      const tbody = document.getElementById('mutes-table-body');
      const countEl = document.getElementById('active-mutes-count');

      const mutes = data.mutes || [];
      countEl.textContent = mutes.length;

      if (mutes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Нет активных мутов</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      mutes.forEach(m => {
        const tr = document.createElement('tr');
        const typeBadge = m.type === 'voice' ? '🎙️ Голос' : '💬 Текст';
        const expireText = m.expiresAt ? new Date(m.expiresAt).toLocaleTimeString('ru-RU') : 'Навсегда';
        tr.innerHTML = `
          <td><strong>${m.userTag || m.userId}</strong><br><small class="text-muted">\`${m.userId}\`</small></td>
          <td><span class="badge badge-staff">${typeBadge}</span></td>
          <td>${expireText}</td>
          <td><button class="btn btn-sm btn-secondary unmute-btn" data-id="${m.userId}" data-type="${m.type}"><i class="fa-solid fa-volume-high"></i> Снять</button></td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.unmute-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = btn.dataset.id;
          const type = btn.dataset.type;
          await fetch(`/api/guild/${currentGuildId}/mod-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unmute', targetId: userId, type, reason: 'Снятие мута через веб-панель' })
          });
          showToast(`Мут снят для ${userId}`, 'success');
          loadActiveMutes();
        });
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function loadWarns(filterUserId = null) {
    try {
      const url = filterUserId
        ? `/api/guild/${currentGuildId}/warns?userId=${filterUserId}`
        : `/api/guild/${currentGuildId}/warns`;
      const res = await fetch(url);
      const data = await res.json();
      const tbody = document.getElementById('warns-table-body');
      const statWarns = document.getElementById('stat-warns');

      const warns = data.warns || [];
      if (statWarns) statWarns.textContent = warns.length;

      if (warns.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Предупреждений не найдено</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      warns.forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code>${w.id}</code></td>
          <td><strong>${w.userTag || w.userId}</strong><br><small class="text-muted">${w.userId}</small></td>
          <td>${w.modTag || w.modId}</td>
          <td>${w.reason}</td>
          <td>${new Date(w.timestamp).toLocaleString('ru-RU')}</td>
          <td><button class="btn btn-sm btn-danger del-warn-btn" data-id="${w.id}"><i class="fa-solid fa-trash"></i> Удалить</button></td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.del-warn-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          await fetch(`/api/warns/${id}`, { method: 'DELETE' });
          showToast('Предупреждение удалено', 'success');
          loadWarns();
        });
      });
    } catch (e) {
      console.error(e);
    }
  }

  const warnSearchInput = document.getElementById('warn-search-input');
  if (warnSearchInput) {
    warnSearchInput.addEventListener('input', () => {
      loadWarns(warnSearchInput.value.trim());
    });
  }

  // Quick Mod Action Form
  const quickModForm = document.getElementById('quick-mod-form');
  if (quickModForm) {
    quickModForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetId = document.getElementById('mod-target-id').value.trim();
      const actionType = document.getElementById('mod-action-type').value;
      const duration = document.getElementById('mod-duration').value.trim();
      const reason = document.getElementById('mod-reason').value.trim();

      let action = 'warn';
      let type = null;

      if (actionType === 'warn') action = 'warn';
      if (actionType === 'mute-text') { action = 'mute'; type = 'text'; }
      if (actionType === 'mute-voice') { action = 'mute'; type = 'voice'; }
      if (actionType === 'ban') action = 'ban';
      if (actionType === 'unmute-all') action = 'unmute';
      if (actionType === 'unban') action = 'unban';

      try {
        const res = await fetch(`/api/guild/${currentGuildId}/mod-action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, targetId, duration, reason, type })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'Действие успешно применено!', 'success');
          loadModerationTab();
        } else {
          showToast(data.error || 'Ошибка применения действия', 'error');
        }
      } catch (err) {
        showToast('Сетевая ошибка при выполнении модерации', 'error');
      }
    });
  }

  // ----------------------------------------------------
  // PROFILES & LEVEL SYSTEM ("сделай систему профилей красивую с фоном...")
  // ----------------------------------------------------
  let currentProfileUserId = null;
  let allProfilesList = [];
  let currentProfileSort = 'xp';
  let presetBannersList = [];

  function formatVoiceSeconds(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return '0 мин.';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts = [];
    if (hours > 0) parts.push(`${hours} ч.`);
    if (minutes > 0) parts.push(`${minutes} мин.`);
    if (seconds > 0 && hours === 0) parts.push(`${seconds} сек.`);

    return parts.join(' ') || '0 мин.';
  }

  async function loadPresetBanners() {
    if (presetBannersList.length > 0) return;
    try {
      const res = await fetch('/api/banners');
      const data = await res.json();
      presetBannersList = data.banners || [];

      const grid = document.getElementById('preset-banners-grid');
      if (!grid) return;
      grid.innerHTML = '';

      presetBannersList.forEach(b => {
        const item = document.createElement('div');
        item.className = 'preset-banner-item';
        item.style.backgroundImage = `url('${b.url}')`;
        item.title = b.name;
        item.innerHTML = `<span class="preset-banner-title">${b.name}</span>`;

        item.addEventListener('click', () => {
          document.querySelectorAll('.preset-banner-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          document.getElementById('custom-banner-input').value = b.url;
          // Live update visual card
          document.getElementById('card-banner-bg').style.backgroundImage = `url('${b.url}')`;
        });

        grid.appendChild(item);
      });
    } catch (e) {
      console.error('Error loading preset banners:', e);
    }
  }

  async function loadProfilesTab() {
    if (!currentGuildId) return;
    await loadPresetBanners();

    try {
      const res = await fetch(`/api/guild/${currentGuildId}/profiles?sort=${currentProfileSort}&limit=100`);
      const data = await res.json();
      allProfilesList = data.profiles || [];

      renderLeaderboard(allProfilesList);

      // Select top profile or current selected profile
      if (allProfilesList.length > 0) {
        const target = currentProfileUserId
          ? (allProfilesList.find(p => p.userId === currentProfileUserId) || allProfilesList[0])
          : allProfilesList[0];
        const rank = allProfilesList.findIndex(p => p.userId === target.userId) + 1;
        selectProfileForCard(target, rank || 1);
      } else {
        // Fallback default card
        selectProfileForCard({
          userId: '000000000000000000',
          userTag: 'Пример Участника#0001',
          avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
          level: 1,
          xp: 25,
          nextLevelXp: 100,
          progressPercent: 25,
          voiceTimeSeconds: 1800,
          messages: 12,
          customTitle: 'Новичок',
          bio: 'Общайтесь в чатах и слушайте музыку в голосовых комнатах для прокачки профиля!',
          badges: ['🎵 Меломан'],
          bannerUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80'
        }, 1);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function selectProfileForCard(p, rank = 1) {
    if (!p) return;
    currentProfileUserId = p.userId;

    // Visual card update
    const cardBannerBg = document.getElementById('card-banner-bg');
    const cardRankBadge = document.getElementById('card-rank-badge');
    const cardAvatar = document.getElementById('card-avatar');
    const cardLevelNum = document.getElementById('card-level-num');
    const cardUsername = document.getElementById('card-username');
    const cardTitleTag = document.getElementById('card-title-tag');
    const cardBioText = document.getElementById('card-bio-text');
    const cardXpNumbers = document.getElementById('card-xp-numbers');
    const cardXpBarFill = document.getElementById('card-xp-bar-fill');
    const cardVoiceTime = document.getElementById('card-voice-time');
    const cardMessagesCount = document.getElementById('card-messages-count');
    const cardTotalXp = document.getElementById('card-total-xp');
    const cardBadgesContainer = document.getElementById('card-badges-container');

    if (cardBannerBg) cardBannerBg.style.backgroundImage = `url('${p.bannerUrl || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80'}')`;
    if (cardRankBadge) cardRankBadge.textContent = `🏆 Ранг #${rank}`;
    if (cardAvatar) cardAvatar.src = p.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    if (cardLevelNum) cardLevelNum.textContent = p.level || 1;
    if (cardUsername) cardUsername.textContent = p.userTag || p.userId;
    if (cardTitleTag) cardTitleTag.textContent = p.customTitle || 'Слушатель';
    if (cardBioText) cardBioText.textContent = p.bio || 'Меломан сообщества Musicium 🎧';
    if (cardXpNumbers) cardXpNumbers.textContent = `${p.xp || 0} / ${p.nextLevelXp || 100} XP (${p.progressPercent || 0}%)`;
    if (cardXpBarFill) cardXpBarFill.style.width = `${p.progressPercent || 0}%`;
    if (cardVoiceTime) cardVoiceTime.textContent = formatVoiceSeconds(p.voiceTimeSeconds);
    if (cardMessagesCount) cardMessagesCount.textContent = p.messages || 0;
    if (cardTotalXp) cardTotalXp.textContent = p.xp || 0;

    // Badges
    if (cardBadgesContainer) {
      cardBadgesContainer.innerHTML = '';
      const badges = p.badges && p.badges.length > 0 ? p.badges : ['🎵 Меломан'];
      badges.forEach(b => {
        const span = document.createElement('span');
        span.className = 'badge-chip';
        span.textContent = b;
        cardBadgesContainer.appendChild(span);
      });
    }

    // Customizer form inputs
    const bannerInput = document.getElementById('custom-banner-input');
    const titleInput = document.getElementById('custom-title-input');
    const bioInput = document.getElementById('custom-bio-input');

    if (bannerInput) bannerInput.value = p.bannerUrl || '';
    if (titleInput) titleInput.value = p.customTitle || 'Слушатель';
    if (bioInput) bioInput.value = p.bio || '';

    // Highlight preset banner if matching
    document.querySelectorAll('.preset-banner-item').forEach(item => {
      const match = item.style.backgroundImage.includes(p.bannerUrl);
      item.classList.toggle('active', !!match);
    });
  }

  function renderLeaderboard(profiles) {
    const tbody = document.getElementById('leaderboard-tbody');
    const searchVal = (document.getElementById('leaderboard-search')?.value || '').toLowerCase();

    let list = profiles;
    if (searchVal) {
      list = list.filter(p =>
        (p.userTag && p.userTag.toLowerCase().includes(searchVal)) ||
        (p.userId && p.userId.includes(searchVal)) ||
        (p.customTitle && p.customTitle.toLowerCase().includes(searchVal))
      );
    }

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Пользователи не найдены</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];

    list.forEach((p, idx) => {
      const rank = idx + 1;
      const medal = medals[idx] || `#${rank}`;
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td><strong class="${idx < 3 ? 'text-yellow' : ''}">${medal}</strong></td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <img src="${p.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width: 28px; height: 28px; border-radius: 50%;">
            <div>
              <strong>${p.userTag || p.userId}</strong>
              <small class="text-muted" style="display: block; font-size: 0.72rem;">${p.customTitle || 'Слушатель'}</small>
            </div>
          </div>
        </td>
        <td><span class="badge badge-staff">Ур. ${p.level}</span></td>
        <td><i class="fa-solid fa-headphones text-cyan"></i> ${formatVoiceSeconds(p.voiceTimeSeconds)}</td>
        <td>${p.messages || 0}</td>
        <td><strong>${p.xp || 0}</strong> XP</td>
        <td>
          <button class="btn btn-sm btn-secondary view-profile-btn" data-id="${p.userId}">
            <i class="fa-solid fa-eye"></i> Карточка
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.view-profile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.id;
        const target = allProfilesList.find(p => p.userId === uid);
        const rank = allProfilesList.findIndex(p => p.userId === uid) + 1;
        if (target) {
          selectProfileForCard(target, rank || 1);
          // Scroll smoothly to card on small screens
          document.getElementById('visual-profile-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  }

  // Leaderboard Sorting Buttons
  const sortXpBtn = document.getElementById('btn-sort-xp');
  const sortVoiceBtn = document.getElementById('btn-sort-voice');
  const sortMsgBtn = document.getElementById('btn-sort-messages');

  function updateSortButtons(activeSort) {
    currentProfileSort = activeSort;
    [sortXpBtn, sortVoiceBtn, sortMsgBtn].forEach(b => {
      if (b) b.classList.toggle('active', b.dataset.sort === activeSort);
    });
    loadProfilesTab();
  }

  if (sortXpBtn) sortXpBtn.addEventListener('click', () => updateSortButtons('xp'));
  if (sortVoiceBtn) sortVoiceBtn.addEventListener('click', () => updateSortButtons('voice'));
  if (sortMsgBtn) sortMsgBtn.addEventListener('click', () => updateSortButtons('messages'));

  const lbSearch = document.getElementById('leaderboard-search');
  if (lbSearch) {
    lbSearch.addEventListener('input', () => {
      renderLeaderboard(allProfilesList);
    });
  }

  // Live input update for custom banner
  const customBannerInput = document.getElementById('custom-banner-input');
  if (customBannerInput) {
    customBannerInput.addEventListener('input', () => {
      const url = customBannerInput.value.trim();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        document.getElementById('card-banner-bg').style.backgroundImage = `url('${url}')`;
      }
    });
  }

  const customTitleInput = document.getElementById('custom-title-input');
  if (customTitleInput) {
    customTitleInput.addEventListener('input', () => {
      document.getElementById('card-title-tag').textContent = customTitleInput.value || 'Слушатель';
    });
  }

  const customBioInput = document.getElementById('custom-bio-input');
  if (customBioInput) {
    customBioInput.addEventListener('input', () => {
      document.getElementById('card-bio-text').textContent = customBioInput.value || 'Меломан сообщества Musicium 🎧';
    });
  }

  // Save Profile Button
  const saveProfileBtn = document.getElementById('save-profile-btn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
      if (!currentGuildId || !currentProfileUserId) {
        showToast('Пользователь не выбран', 'warning');
        return;
      }

      saveProfileBtn.disabled = true;
      saveProfileBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Сохранение...';

      const bannerUrl = document.getElementById('custom-banner-input').value.trim();
      const customTitle = document.getElementById('custom-title-input').value.trim();
      const bio = document.getElementById('custom-bio-input').value.trim();

      try {
        const res = await fetch(`/api/guild/${currentGuildId}/profiles/${currentProfileUserId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bannerUrl, customTitle, bio })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Профиль участника успешно обновлен!', 'success');
          loadProfilesTab();
        } else {
          showToast('Не удалось сохранить профиль', 'error');
        }
      } catch (e) {
        showToast('Ошибка сети при сохранении профиля', 'error');
      } finally {
        saveProfileBtn.disabled = false;
        saveProfileBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Сохранить профиль';
      }
    });
  }

  // ----------------------------------------------------
  // LOGS CATEGORIZED VIEWER ("категорию логов по каждой из возможных категорий")
  // ----------------------------------------------------
  async function loadLogsTab() {
    if (!currentGuildId) return;
    const feed = document.getElementById('logs-feed');
    feed.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка журнала логов...</div>';

    try {
      const res = await fetch(`/api/guild/${currentGuildId}/logs?category=${currentLogCategory}&limit=150`);
      const data = await res.json();
      allLogs = data.logs || [];
      renderLogs();
    } catch (e) {
      feed.innerHTML = '<div class="text-danger">Ошибка получения логов</div>';
    }
  }

  function renderLogs() {
    const feed = document.getElementById('logs-feed');
    const searchFilter = (document.getElementById('logs-search')?.value || '').toLowerCase();

    let filtered = allLogs;
    if (searchFilter) {
      filtered = filtered.filter(l =>
        (l.title && l.title.toLowerCase().includes(searchFilter)) ||
        (l.description && l.description.toLowerCase().includes(searchFilter)) ||
        (l.action && l.action.toLowerCase().includes(searchFilter))
      );
    }

    if (filtered.length === 0) {
      feed.innerHTML = '<div class="text-center text-muted" style="padding: 30px;">Логи в этой категории отсутствуют.</div>';
      return;
    }

    feed.innerHTML = '';
    filtered.forEach(log => {
      const card = document.createElement('div');
      card.className = `log-entry-card ${log.category}`;

      let catBadgeName = log.category.toUpperCase();
      if (log.category === 'anticrash') catBadgeName = '🚨 АНТИКРАШ';
      if (log.category === 'moderation') catBadgeName = '🔨 МОДЕРАЦИЯ';
      if (log.category === 'messages') catBadgeName = '💬 СООБЩЕНИЯ';
      if (log.category === 'members') catBadgeName = '👥 УЧАСТНИКИ';
      if (log.category === 'channels_roles') catBadgeName = '🛠️ КАНАЛЫ/РОЛИ';
      if (log.category === 'voice') catBadgeName = '🎙️ ГОЛОСОВЫЕ';

      let metaHtml = '';
      if (log.executor) {
        metaHtml += `<span class="log-field-item">👤 <strong>Инициатор:</strong> ${log.executor.tag || log.executor.id}</span>`;
      }
      if (log.target) {
        metaHtml += `<span class="log-field-item">🎯 <strong>Цель:</strong> ${log.target.tag || log.target.name || log.target.id}</span>`;
      }
      if (log.extraFields) {
        log.extraFields.forEach(f => {
          metaHtml += `<span class="log-field-item"><strong>${f.name}:</strong> ${f.value}</span>`;
        });
      }

      card.innerHTML = `
        <div class="log-top-line">
          <div class="log-badge-and-title">
            <span class="log-category-badge">${catBadgeName}</span>
            <span class="log-title">${log.title}</span>
          </div>
          <span class="log-time">${new Date(log.timestamp).toLocaleString('ru-RU')}</span>
        </div>
        <div class="log-desc">${log.description}</div>
        ${metaHtml ? `<div class="log-meta-fields">${metaHtml}</div>` : ''}
      `;

      feed.appendChild(card);
    });
  }

  // Category pill clicks
  document.querySelectorAll('.category-pills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.category-pills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentLogCategory = pill.dataset.category;
      loadLogsTab();
    });
  });

  const logsSearch = document.getElementById('logs-search');
  if (logsSearch) {
    logsSearch.addEventListener('input', () => {
      renderLogs();
    });
  }

  // ----------------------------------------------------
  // 1-CLICK SERVER SETUP ("каналы создай сам, тут будет сообщество по моему музыкальному боту...")
  // ----------------------------------------------------
  const runSetupBtn = document.getElementById('run-setup-btn');
  const setupProgressBox = document.getElementById('setup-progress-box');
  const setupLogsPre = document.getElementById('setup-progress-logs');
  const setupStatusTag = document.getElementById('setup-status-tag');

  if (runSetupBtn) {
    runSetupBtn.addEventListener('click', async () => {
      if (!currentGuildId) {
        showToast('Пожалуйста, выберите сервер', 'warning');
        return;
      }

      const confirmed = confirm('Вы уверены, что хотите запустить автонастройку? Бот создаст 6 категорий (Инфо, РУ-сообщество, EN-сообщество, Поддержка, Персонал, Логи) и опубликует правила.');
      if (!confirmed) return;

      runSetupBtn.disabled = true;
      runSetupBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Развертывание каналов и правил...';
      setupProgressBox.classList.remove('hidden');
      setupLogsPre.textContent = 'Подготовка к созданию структуры...\n';
      setupStatusTag.textContent = 'Выполняется...';
      setupStatusTag.className = 'badge badge-warning';

      try {
        const res = await fetch(`/api/guild/${currentGuildId}/setup-server`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.success) {
          setupLogsPre.textContent = (data.logs || []).join('\n') + '\n\n✅ УСПЕШНО ЗАВЕРШЕНО! Сервер полностью укомплектован.';
          setupStatusTag.textContent = 'Успешно завершено!';
          setupStatusTag.className = 'badge badge-success';
          showToast('Сообщество Musicium успешно развернуто на сервере!', 'success');
          // Reload guild data
          onGuildSelected(currentGuildId);
        } else {
          setupLogsPre.textContent += `\n❌ Ошибка: ${data.error}`;
          setupStatusTag.textContent = 'Ошибка';
          setupStatusTag.className = 'badge badge-danger';
          showToast(data.error || 'Ошибка при создании каналов', 'error');
        }
      } catch (err) {
        setupLogsPre.textContent += `\n❌ Сетевая ошибка: ${err.message}`;
        showToast('Сетевой сбой при создании сервера', 'error');
      } finally {
        runSetupBtn.disabled = false;
        runSetupBtn.innerHTML = '<i class="fa-solid fa-rocket"></i> Запустить автонастройку сервера';
      }
    });
  }

  // ----------------------------------------------------
  // TICKETS & BUG REPORTS TAB
  // ----------------------------------------------------
  async function loadTicketsTab() {
    if (!currentGuildId) return;
    await Promise.all([loadTicketsList(), loadBugReportsList()]);
  }

  async function loadTicketsList() {
    try {
      const res = await fetch(`/api/guild/${currentGuildId}/tickets`);
      const data = await res.json();
      const tbody = document.getElementById('tickets-tbody');
      if (!tbody) return;

      const tickets = data.tickets || [];
      const openCount = tickets.filter(t => t.status === 'open').length;
      const statsOpen = document.getElementById('stats-open-tickets');
      const statsTotal = document.getElementById('stats-total-tickets');
      if (statsOpen) statsOpen.textContent = openCount;
      if (statsTotal) statsTotal.textContent = tickets.length;

      if (tickets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Тикетов пока нет. Они появятся при создании участниками в Discord.</td></tr>';
        return;
      }

      const categoryLabels = {
        support: '<span class="badge badge-staff">📩 Поддержка</span>',
        bug: '<span class="badge badge-danger">🐛 Баг</span>',
        question: '<span class="badge badge-purple">❓ Вопрос</span>',
        other: '<span class="badge badge-staff">Обращение</span>'
      };

      tbody.innerHTML = '';
      tickets.forEach(t => {
        const tr = document.createElement('tr');
        const time = new Date(t.createdAt).toLocaleString('ru-RU');
        const avatar = t.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
        const isOpen = t.status === 'open';
        const statusBadge = isOpen
          ? '<span class="badge badge-success"><i class="fa-solid fa-circle-dot"></i> Открыт</span>'
          : '<span class="badge badge-danger"><i class="fa-solid fa-lock"></i> Закрыт</span>';

        tr.innerHTML = `
          <td><strong>#${t.ticketNumber}</strong></td>
          <td><strong>${t.subject}</strong></td>
          <td>${categoryLabels[t.category] || t.category}</td>
          <td>
            <div class="user-cell">
              <img src="${avatar}" class="table-avatar" alt="Avatar">
              <div>
                <span>${t.authorTag}</span>
                <small class="text-muted d-block">\`${t.authorId}\`</small>
              </div>
            </div>
          </td>
          <td><small><code>${time}</code></small></td>
          <td>${statusBadge}</td>
          <td>
            ${isOpen ? `
              <button class="btn btn-sm btn-danger close-ticket-web-btn" data-id="${t.id}" title="Закрыть тикет">
                <i class="fa-solid fa-lock"></i> Закрыть
              </button>
            ` : '<span class="text-muted"><i class="fa-solid fa-check"></i> Завершен</span>'}
          </td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.close-ticket-web-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('Закрыть этот тикет и удалить его канал в Discord?')) return;
          btn.disabled = true;
          try {
            const res = await fetch(`/api/guild/${currentGuildId}/tickets/${id}/close`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: 'Закрыт администратором через веб-панель' })
            });
            const result = await res.json();
            if (result.success) {
              showToast('Тикет закрыт', 'success');
              loadTicketsList();
            } else {
              showToast(result.error || 'Ошибка закрытия тикета', 'error');
            }
          } catch (e) {
            showToast('Сетевой сбой', 'error');
          }
        });
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function loadBugReportsList() {
    try {
      const res = await fetch(`/api/guild/${currentGuildId}/bug-reports`);
      const data = await res.json();
      const tbody = document.getElementById('bugs-tbody');
      if (!tbody) return;

      const reports = data.reports || [];
      const newCount = reports.filter(r => r.status === 'new').length;
      const fixedCount = reports.filter(r => r.status === 'fixed').length;
      const statsNew = document.getElementById('stats-new-bugs');
      const statsFixed = document.getElementById('stats-fixed-bugs');
      if (statsNew) statsNew.textContent = newCount;
      if (statsFixed) statsFixed.textContent = fixedCount;

      if (reports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Баг-репортов пока нет. Они появятся при отправке /bugreport или через панель тикетов.</td></tr>';
        return;
      }

      const severityBadges = {
        low: '<span class="badge badge-success">🟢 Низкая</span>',
        medium: '<span class="badge badge-warning">🟡 Средняя</span>',
        high: '<span class="badge badge-orange">🟠 Высокая</span>',
        critical: '<span class="badge badge-danger">🔴 Критическая</span>'
      };

      const statusBadges = {
        new: '<span class="badge badge-warning">🟡 Новый</span>',
        in_progress: '<span class="badge badge-staff">⚙️ В работе</span>',
        fixed: '<span class="badge badge-success">✅ Исправлено</span>',
        rejected: '<span class="badge badge-danger">❌ Отклонено</span>'
      };

      tbody.innerHTML = '';
      reports.forEach(b => {
        const tr = document.createElement('tr');
        const time = new Date(b.createdAt).toLocaleString('ru-RU');
        const avatar = b.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';

        tr.innerHTML = `
          <td><strong>#${b.reportNumber}</strong></td>
          <td>
            <strong>${b.title}</strong>
            <small class="d-block text-muted text-truncate" style="max-width: 280px;" title="${b.description}">${b.description}</small>
          </td>
          <td>
            <div class="user-cell">
              <img src="${avatar}" class="table-avatar" alt="Avatar">
              <div>
                <span>${b.authorTag}</span>
              </div>
            </div>
          </td>
          <td>${severityBadges[b.severity] || b.severity}</td>
          <td><small><code>${time}</code></small></td>
          <td>${statusBadges[b.status] || b.status}</td>
          <td>
            <div class="table-actions">
              <select class="custom-select custom-select-sm bug-status-select" data-id="${b.id}" style="width: auto; padding: 4px 8px; font-size: 12px;">
                <option value="new" ${b.status === 'new' ? 'selected' : ''}>Новый</option>
                <option value="in_progress" ${b.status === 'in_progress' ? 'selected' : ''}>⚙️ В работу</option>
                <option value="fixed" ${b.status === 'fixed' ? 'selected' : ''}>✅ Исправлено</option>
                <option value="rejected" ${b.status === 'rejected' ? 'selected' : ''}>❌ Отклонить</option>
              </select>
              <button class="btn btn-sm btn-icon btn-danger delete-bug-btn" data-id="${b.id}" title="Удалить из базы">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.bug-status-select').forEach(sel => {
        sel.addEventListener('change', async () => {
          const id = sel.dataset.id;
          const status = sel.value;
          try {
            const res = await fetch(`/api/guild/${currentGuildId}/bug-reports/${id}/status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status })
            });
            const result = await res.json();
            if (result.success) {
              showToast('Статус бага обновлен (синхронизировано с Discord)', 'success');
              loadBugReportsList();
            } else {
              showToast(result.error || 'Ошибка смены статуса', 'error');
            }
          } catch (e) {
            showToast('Сетевой сбой', 'error');
          }
        });
      });

      tbody.querySelectorAll('.delete-bug-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('Удалить этот баг-репорт из базы данных?')) return;
          try {
            const res = await fetch(`/api/guild/${currentGuildId}/bug-reports/${id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
              showToast('Баг-репорт удален', 'success');
              loadBugReportsList();
            }
          } catch (e) {
            showToast('Сетевой сбой', 'error');
          }
        });
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Refresh Tickets and Bugs buttons
  const refreshTicketsBtn = document.getElementById('refresh-tickets-btn');
  if (refreshTicketsBtn) {
    refreshTicketsBtn.addEventListener('click', () => loadTicketsList());
  }

  const refreshBugsBtn = document.getElementById('refresh-bugs-btn');
  if (refreshBugsBtn) {
    refreshBugsBtn.addEventListener('click', () => loadBugReportsList());
  }

  // Initial boot
  checkAuth();
})();
