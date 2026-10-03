const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');

// Ensure local data directory exists for backup
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default initial database structure
const defaultData = {
  settings: {},
  warns: [],
  activeBans: [],
  activeMutes: [],
  logs: [],
  profiles: {}, // { [guildId]: { [userId]: profileData } }
  recentActions: [], // [ { id, guildId, executorId, actionType, timestamp, details, snapshot } ]
  antiCrashUsers: [], // [ { id, guildId, userId, userTag, avatarUrl, actionType, count, limit, punishment, rollbackSummary, strippedRoleIds, status, timestamp } ]
  tickets: [], // [ { id, ticketNumber, guildId, channelId, authorId, authorTag, category, subject, status, createdAt, closedAt, closedBy, closeReason, transcript } ]
  bugReports: [] // [ { id, reportNumber, guildId, authorId, authorTag, title, description, reproductionSteps, severity, status, messageId, adminComment, assignedTo, createdAt, updatedAt } ]
};

class Database {
  constructor() {
    this.data = JSON.parse(JSON.stringify(defaultData));
    this.pgPool = null;
    this.isPgConnected = false;
    this.pendingPgSaves = new Set();
    this.saveTimeout = null;

    // 1. Initial fast local load (so the bot starts instantly without waiting for network)
    this.loadLocal();

    // 2. Connect to PostgreSQL if DATABASE_URL is configured
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      this.initPostgres(dbUrl);
    } else {
      console.log('[DB] DATABASE_URL не задана в .env, работаем в режиме локального JSON-файла.');
    }
  }

  loadLocal() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        this.data = { ...defaultData, ...JSON.parse(raw) };
      } else {
        this.saveLocal();
      }
    } catch (err) {
      console.error('[DB] Ошибка чтения database.json, используем значения по умолчанию:', err.message);
      this.data = JSON.parse(JSON.stringify(defaultData));
      this.saveLocal();
    }
  }

  saveLocal() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[DB] Ошибка записи локального database.json:', err.message);
    }
  }

  async initPostgres(connectionString) {
    try {
      console.log('[DB] Подключение к PostgreSQL...');
      this.pgPool = new Pool({
        connectionString,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        max: 10
      });

      this.pgPool.on('error', (err) => {
        console.error('[DB PG Pool Error]', err.message);
      });

      // Test connection
      const client = await this.pgPool.connect();
      console.log('✅ [DB] Успешное подключение к PostgreSQL!');
      this.isPgConnected = true;

      // Create storage table if not exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS bot_storage (
          key VARCHAR(64) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Load data from PostgreSQL
      const res = await client.query('SELECT key, data FROM bot_storage;');
      client.release();

      if (res.rows.length > 0) {
        console.log(`[DB] Загружено ${res.rows.length} разделов данных из PostgreSQL.`);
        for (const row of res.rows) {
          if (row.key && row.data !== undefined) {
            this.data[row.key] = row.data;
          }
        }
        // Mirror to local disk as backup
        this.saveLocal();
      } else {
        console.log('[DB] PostgreSQL пустая, синхронизируем локальные данные в PostgreSQL...');
        await this.syncAllToPostgres();
      }
    } catch (err) {
      console.error('❌ [DB] Ошибка подключения к PostgreSQL:', err.message);
      console.log('⚠️  [DB] Бот продолжает работу на базе локального хранилища database.json.');
      this.isPgConnected = false;
    }
  }

  async syncAllToPostgres() {
    if (!this.pgPool || !this.isPgConnected) return;
    try {
      const keys = Object.keys(this.data);
      for (const key of keys) {
        await this.pgPool.query(`
          INSERT INTO bot_storage (key, data, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE
          SET data = EXCLUDED.data, updated_at = NOW();
        `, [key, JSON.stringify(this.data[key])]);
      }
      console.log('✅ [DB] Локальные данные успешно сохранены в PostgreSQL.');
    } catch (err) {
      console.error('[DB] Ошибка синхронизации данных в PostgreSQL:', err.message);
    }
  }

  save(key = null) {
    // 1. Immediately persist to local backup file
    this.saveLocal();

    // 2. Queue for PostgreSQL upsert
    if (key) {
      this.pendingPgSaves.add(key);
    } else {
      Object.keys(this.data).forEach(k => this.pendingPgSaves.add(k));
    }

    if (!this.saveTimeout) {
      this.saveTimeout = setTimeout(() => {
        this.flushPendingPgSaves();
      }, 300); // 300ms debounce
    }
  }

  async flushPendingPgSaves() {
    this.saveTimeout = null;
    if (!this.pgPool || !this.isPgConnected || this.pendingPgSaves.size === 0) return;

    const keysToSave = Array.from(this.pendingPgSaves);
    this.pendingPgSaves.clear();

    for (const key of keysToSave) {
      try {
        await this.pgPool.query(`
          INSERT INTO bot_storage (key, data, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE
          SET data = EXCLUDED.data, updated_at = NOW();
        `, [key, JSON.stringify(this.data[key])]);
      } catch (err) {
        console.error(`[DB] Ошибка сохранения ключа "${key}" в PostgreSQL:`, err.message);
      }
    }
  }

  getDbStatus() {
    return {
      type: this.isPgConnected ? 'PostgreSQL' : 'Local JSON',
      connected: this.isPgConnected,
      urlConfigured: !!process.env.DATABASE_URL
    };
  }

  // --- Settings ---
  getGuildSettings(guildId) {
    if (!this.data.settings[guildId]) {
      this.data.settings[guildId] = {
        antiCrash: {
          enabled: true,
          action: 'quarantine', // 'quarantine' (strip roles), 'ban', 'kick', 'alert'
          limits: {
            channelDelete: 2,
            channelCreate: 3,
            roleDelete: 2,
            roleCreate: 3,
            banAdd: 3,
            memberKick: 3,
            webhookCreate: 2
          },
          windowSeconds: 60,
          whitelistRoles: [],
          whitelistUsers: []
        },
        logChannels: {
          antiCrash: null,
          moderation: null,
          messages: null,
          members: null,
          channelsRoles: null,
          voice: null
        },
        specialRoles: {
          muteRoleId: null,
          banRoleId: null,
          verifiedRoleId: null
        },
        expectedChannels: [],
        lastChannelCheck: null
      };
      this.save('settings');
    }
    // Ensure nested objects exist on legacy data
    if (!this.data.settings[guildId].specialRoles) {
      this.data.settings[guildId].specialRoles = { muteRoleId: null, banRoleId: null, verifiedRoleId: null };
    }
    if (!this.data.settings[guildId].expectedChannels) {
      this.data.settings[guildId].expectedChannels = [];
    }
    return this.data.settings[guildId];
  }

  updateGuildSettings(guildId, newSettings) {
    const current = this.getGuildSettings(guildId);
    this.data.settings[guildId] = {
      ...current,
      ...newSettings,
      antiCrash: {
        ...current.antiCrash,
        ...(newSettings.antiCrash || {})
      },
      logChannels: {
        ...current.logChannels,
        ...(newSettings.logChannels || {})
      },
      specialRoles: {
        ...current.specialRoles,
        ...(newSettings.specialRoles || {})
      }
    };
    this.save('settings');
    return this.data.settings[guildId];
  }

  // --- Anti-Crash Action Snapshots & 1-Hour Rollback Database ---
  recordActionSnapshot(guildId, executorId, actionType, details, snapshot = null) {
    if (!this.data.recentActions) this.data.recentActions = [];

    const item = {
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      guildId,
      executorId,
      actionType, // 'channelDelete', 'channelCreate', 'roleDelete', 'roleCreate', 'banAdd', 'webhookCreate'
      details,
      snapshot, // channel/role/ban metadata needed for rollback
      timestamp: Date.now()
    };

    this.data.recentActions.push(item);

    // Clean older than 2 hours (7200000 ms)
    const twoHoursAgo = Date.now() - 7200000;
    this.data.recentActions = this.data.recentActions.filter(a => a.timestamp >= twoHoursAgo);

    this.save('recentActions');
    return item;
  }

  getRecentActionsByExecutor(guildId, executorId, maxAgeMs = 3600000) {
    if (!this.data.recentActions) return [];
    const cutoff = Date.now() - maxAgeMs;
    return this.data.recentActions.filter(a => 
      a.guildId === guildId &&
      a.executorId === executorId &&
      a.timestamp >= cutoff
    ).sort((a, b) => b.timestamp - a.timestamp);
  }

  // --- Anti-Crash Offenders & Incidents Registry (Люди в антикраше) ---
  recordAntiCrashUser(guildId, user, actionType, count, limit, punishment, rollbackSummary = '', details = '', strippedRoleIds = []) {
    if (!this.data.antiCrashUsers) this.data.antiCrashUsers = [];

    const record = {
      id: 'ac_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      guildId,
      userId: user.id,
      userTag: user.tag || user.username || `User#${user.id.slice(-4)}`,
      avatarUrl: user.displayAvatarURL ? (typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ dynamic: true }) : user.displayAvatarURL) : null,
      actionType,
      count,
      limit,
      punishment: punishment || 'Карантин (сняты роли)',
      rollbackSummary: rollbackSummary || '',
      details: details || '',
      strippedRoleIds: Array.isArray(strippedRoleIds) ? strippedRoleIds : [],
      status: 'active', // 'active' (quarantined/banned) | 'released'
      timestamp: Date.now(),
      releasedAt: null,
      releasedBy: null
    };

    // Prepend to list so newest is first
    this.data.antiCrashUsers.unshift(record);

    // Keep max 500 records
    if (this.data.antiCrashUsers.length > 500) {
      this.data.antiCrashUsers = this.data.antiCrashUsers.slice(0, 500);
    }

    this.save('antiCrashUsers');
    console.log(`[DB] 🚨 Нарушитель антикраша записан в БД: ${record.userTag} (${record.actionType}, мера: ${record.punishment})`);
    return record;
  }

  getAntiCrashUsers(guildId = null) {
    if (!this.data.antiCrashUsers) return [];
    if (guildId) {
      return this.data.antiCrashUsers.filter(u => u.guildId === guildId);
    }
    return this.data.antiCrashUsers;
  }

  releaseAntiCrashUser(guildId, incidentIdOrUserId, releasedBy = 'Владелец сервера') {
    if (!this.data.antiCrashUsers) return null;
    const item = this.data.antiCrashUsers.find(u => 
      (u.id === incidentIdOrUserId || (u.guildId === guildId && u.userId === incidentIdOrUserId)) && 
      u.status === 'active'
    );
    if (item) {
      item.status = 'released';
      item.releasedAt = Date.now();
      item.releasedBy = releasedBy;
      this.save('antiCrashUsers');
      return item;
    }
    return null;
  }

  removeAntiCrashUser(incidentId) {
    if (!this.data.antiCrashUsers) return false;
    const initialLen = this.data.antiCrashUsers.length;
    this.data.antiCrashUsers = this.data.antiCrashUsers.filter(u => u.id !== incidentId);
    if (this.data.antiCrashUsers.length !== initialLen) {
      this.save('antiCrashUsers');
      return true;
    }
    return false;
  }

  // --- Tickets System (Система тикетов) ---
  createTicket(guildId, channelId, author, category = 'support', subject = 'Без темы') {
    if (!this.data.tickets) this.data.tickets = [];
    const guildTickets = this.data.tickets.filter(t => t.guildId === guildId);
    const ticketNumber = guildTickets.length + 1;

    const ticket = {
      id: 'tick_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      ticketNumber,
      guildId,
      channelId,
      authorId: author.id,
      authorTag: author.tag || author.username || `User#${author.id.slice(-4)}`,
      avatarUrl: author.displayAvatarURL ? (typeof author.displayAvatarURL === 'function' ? author.displayAvatarURL({ dynamic: true }) : author.displayAvatarURL) : null,
      category, // 'support' | 'bug' | 'question' | 'other'
      subject: (subject || 'Без темы').slice(0, 200),
      status: 'open', // 'open' | 'closed'
      createdAt: Date.now(),
      closedAt: null,
      closedBy: null,
      closeReason: null,
      transcript: [] // [ { author, content, timestamp } ]
    };

    this.data.tickets.unshift(ticket);
    this.save('tickets');
    console.log(`[DB] 🎫 Создан тикет #${ticket.ticketNumber} [${ticket.category}] от ${ticket.authorTag}`);
    return ticket;
  }

  getTickets(guildId = null, status = null) {
    if (!this.data.tickets) return [];
    let list = this.data.tickets;
    if (guildId) list = list.filter(t => t.guildId === guildId);
    if (status) list = list.filter(t => t.status === status);
    return list;
  }

  getTicketByChannel(channelId) {
    if (!this.data.tickets) return null;
    return this.data.tickets.find(t => t.channelId === channelId);
  }

  closeTicket(channelIdOrId, closedBy = 'Персонал', closeReason = 'Вопрос решен') {
    if (!this.data.tickets) return null;
    const ticket = this.data.tickets.find(t => (t.channelId === channelIdOrId || t.id === channelIdOrId) && t.status === 'open');
    if (ticket) {
      ticket.status = 'closed';
      ticket.closedAt = Date.now();
      ticket.closedBy = closedBy;
      ticket.closeReason = closeReason;
      this.save('tickets');
      console.log(`[DB] 🔒 Тикет #${ticket.ticketNumber} закрыт (${closedBy}): ${closeReason}`);
      return ticket;
    }
    return null;
  }

  addTicketMessage(channelId, authorTag, content) {
    if (!this.data.tickets) return;
    const ticket = this.data.tickets.find(t => t.channelId === channelId && t.status === 'open');
    if (ticket) {
      if (!ticket.transcript) ticket.transcript = [];
      ticket.transcript.push({
        author: authorTag,
        content: content.slice(0, 1000),
        timestamp: Date.now()
      });
      // Limit transcript to 300 messages per ticket
      if (ticket.transcript.length > 300) {
        ticket.transcript = ticket.transcript.slice(-300);
      }
      this.save('tickets');
    }
  }

  // --- Bug Reports System (Система баг-репортов) ---
  createBugReport(guildId, author, title, description, reproductionSteps = '', severity = 'medium', messageId = null) {
    if (!this.data.bugReports) this.data.bugReports = [];
    const guildBugs = this.data.bugReports.filter(b => b.guildId === guildId);
    const reportNumber = guildBugs.length + 1;

    const report = {
      id: 'bug_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      reportNumber,
      guildId,
      authorId: author.id,
      authorTag: author.tag || author.username || `User#${author.id.slice(-4)}`,
      avatarUrl: author.displayAvatarURL ? (typeof author.displayAvatarURL === 'function' ? author.displayAvatarURL({ dynamic: true }) : author.displayAvatarURL) : null,
      title: title.slice(0, 150),
      description: description.slice(0, 2000),
      reproductionSteps: (reproductionSteps || '').slice(0, 1000),
      severity: ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'medium',
      status: 'new', // 'new' | 'in_progress' | 'fixed' | 'rejected'
      messageId: messageId || null,
      adminComment: null,
      assignedTo: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.data.bugReports.unshift(report);
    this.save('bugReports');
    console.log(`[DB] 🐛 Создан баг-репорт #${report.reportNumber}: "${report.title}" от ${report.authorTag}`);
    return report;
  }

  getBugReports(guildId = null, status = null) {
    if (!this.data.bugReports) return [];
    let list = this.data.bugReports;
    if (guildId) list = list.filter(b => b.guildId === guildId);
    if (status) list = list.filter(b => b.status === status);
    return list;
  }

  updateBugReportStatus(reportId, newStatus, adminComment = null, assignedTo = null) {
    if (!this.data.bugReports) return null;
    const report = this.data.bugReports.find(b => b.id === reportId);
    if (report) {
      report.status = newStatus;
      report.updatedAt = Date.now();
      if (adminComment !== null) report.adminComment = adminComment;
      if (assignedTo !== null) report.assignedTo = assignedTo;
      this.save('bugReports');
      console.log(`[DB] 🔄 Статус баг-репорта #${report.reportNumber} изменен на "${newStatus}"`);
      return report;
    }
    return null;
  }

  deleteBugReport(reportId) {
    if (!this.data.bugReports) return false;
    const initialLen = this.data.bugReports.length;
    this.data.bugReports = this.data.bugReports.filter(b => b.id !== reportId);
    if (this.data.bugReports.length !== initialLen) {
      this.save('bugReports');
      return true;
    }
    return false;
  }

  // --- Warns ---
  addWarn(guildId, userId, userTag, modId, modTag, reason) {
    const warn = {
      id: 'warn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      guildId,
      userId,
      userTag,
      modId,
      modTag,
      reason: reason || 'Причина не указана',
      timestamp: Date.now()
    };
    this.data.warns.push(warn);
    this.save('warns');
    return warn;
  }

  getWarns(guildId, userId = null) {
    let list = this.data.warns.filter(w => w.guildId === guildId);
    if (userId) {
      list = list.filter(w => w.userId === userId);
    }
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }

  removeWarn(warnId) {
    const prevCount = this.data.warns.length;
    this.data.warns = this.data.warns.filter(w => w.id !== warnId);
    const deleted = this.data.warns.length < prevCount;
    if (deleted) this.save('warns');
    return deleted;
  }

  clearUserWarns(guildId, userId) {
    const prevCount = this.data.warns.length;
    this.data.warns = this.data.warns.filter(w => !(w.guildId === guildId && w.userId === userId));
    const cleared = prevCount - this.data.warns.length;
    if (cleared > 0) this.save('warns');
    return cleared;
  }

  // --- Active Bans (for timed bans) ---
  addActiveBan(guildId, userId, userTag, modId, reason, expiresAt) {
    this.data.activeBans = this.data.activeBans.filter(b => !(b.guildId === guildId && b.userId === userId));
    const ban = {
      guildId,
      userId,
      userTag,
      modId,
      reason,
      expiresAt: expiresAt || null, // null = permanent
      createdAt: Date.now()
    };
    this.data.activeBans.push(ban);
    this.save('activeBans');
    return ban;
  }

  removeActiveBan(guildId, userId) {
    this.data.activeBans = this.data.activeBans.filter(b => !(b.guildId === guildId && b.userId === userId));
    this.save('activeBans');
  }

  getActiveBans(guildId = null) {
    if (guildId) return this.data.activeBans.filter(b => b.guildId === guildId);
    return this.data.activeBans;
  }

  // --- Active Mutes (Text & Voice) ---
  addActiveMute(guildId, userId, userTag, modId, type, reason, expiresAt) {
    this.data.activeMutes = this.data.activeMutes.filter(m => !(m.guildId === guildId && m.userId === userId && m.type === type));
    const mute = {
      id: 'mute_' + Date.now(),
      guildId,
      userId,
      userTag,
      modId,
      type, // 'text' | 'voice'
      reason,
      expiresAt: expiresAt || null,
      createdAt: Date.now()
    };
    this.data.activeMutes.push(mute);
    this.save('activeMutes');
    return mute;
  }

  removeActiveMute(guildId, userId, type = null) {
    if (type) {
      this.data.activeMutes = this.data.activeMutes.filter(m => !(m.guildId === guildId && m.userId === userId && m.type === type));
    } else {
      this.data.activeMutes = this.data.activeMutes.filter(m => !(m.guildId === guildId && m.userId === userId));
    }
    this.save('activeMutes');
  }

  getActiveMutes(guildId = null) {
    if (guildId) return this.data.activeMutes.filter(m => m.guildId === guildId);
    return this.data.activeMutes;
  }

  isVoiceMuted(guildId, userId) {
    return this.data.activeMutes.some(m => m.guildId === guildId && m.userId === userId && m.type === 'voice');
  }

  // --- Audit Logs ---
  addLog(guildId, category, action, title, description, executor = null, target = null, extraFields = []) {
    const logItem = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      guildId,
      category, // 'anticrash' | 'moderation' | 'messages' | 'members' | 'channels_roles' | 'voice'
      action,
      title,
      description,
      executor: executor ? { id: executor.id, tag: executor.tag || executor.username } : null,
      target: target ? { id: target.id, tag: target.tag || target.username } : null,
      extraFields: extraFields || [],
      timestamp: Date.now()
    };
    this.data.logs.unshift(logItem);
    // Keep max 2000 logs in memory/disk to prevent unlimited growth
    if (this.data.logs.length > 2000) {
      this.data.logs = this.data.logs.slice(0, 2000);
    }
    this.save('logs');
    return logItem;
  }

  getLogs(guildId, category = 'all', limit = 100) {
    if (!this.data.logs) return [];
    let list = this.data.logs.filter(l => l.guildId === guildId);
    if (category && category !== 'all') {
      list = list.filter(l => l.category === category);
    }
    return list.slice(0, limit);
  }

  // --- User Profiles & Leveling System ---
  calculateLevel(xp) {
    // Formula: level = Math.floor(Math.sqrt(xp / 100)) + 1
    if (!xp || xp < 100) return 1;
    return Math.floor(Math.sqrt(xp / 100)) + 1;
  }

  getXpForLevel(level) {
    if (level <= 1) return 0;
    return 100 * Math.pow(level - 1, 2);
  }

  getProfile(guildId, userId, userTag = null, avatarUrl = null) {
    if (!this.data.profiles) this.data.profiles = {};
    if (!this.data.profiles[guildId]) this.data.profiles[guildId] = {};

    if (!this.data.profiles[guildId][userId]) {
      this.data.profiles[guildId][userId] = {
        userId,
        guildId,
        userTag: userTag || `User#${userId.slice(-4)}`,
        avatarUrl: avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
        xp: 0,
        level: 1,
        messages: 0,
        voiceTimeSeconds: 0,
        bannerUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80',
        bio: 'Меломан сообщества Musicium 🎧',
        customTitle: 'Слушатель',
        badges: ['🎵 Меломан'],
        joinedAt: Date.now(),
        voiceJoinedAt: null
      };
      this.save('profiles');
    } else {
      let changed = false;
      if (userTag && this.data.profiles[guildId][userId].userTag !== userTag) {
        this.data.profiles[guildId][userId].userTag = userTag;
        changed = true;
      }
      if (avatarUrl && this.data.profiles[guildId][userId].avatarUrl !== avatarUrl) {
        this.data.profiles[guildId][userId].avatarUrl = avatarUrl;
        changed = true;
      }
      if (changed) {
        this.save('profiles');
      }
    }

    const p = this.data.profiles[guildId][userId];
    p.level = this.calculateLevel(p.xp);
    const currentBase = this.getXpForLevel(p.level);
    const nextTarget = this.getXpForLevel(p.level + 1);
    const progressPercent = Math.min(100, Math.max(0, Math.round(((p.xp - currentBase) / (nextTarget - currentBase || 1)) * 100)));

    return {
      ...p,
      currentBaseXp: currentBase,
      nextLevelXp: nextTarget,
      progressPercent
    };
  }

  addMessageActivity(guildId, userId, userTag = null, avatarUrl = null) {
    const profile = this.getProfile(guildId, userId, userTag, avatarUrl);
    const raw = this.data.profiles[guildId][userId];

    // Grant 15-25 XP per message with 45s cooldown
    const now = Date.now();
    const canGainXp = !raw.lastXpTimestamp || (now - raw.lastXpTimestamp) >= 45000;
    
    raw.messages = (raw.messages || 0) + 1;
    let leveledUp = false;
    let newLevel = raw.level;

    if (canGainXp) {
      const earnedXp = Math.floor(Math.random() * 11) + 15; // 15-25 XP
      raw.xp = (raw.xp || 0) + earnedXp;
      raw.lastXpTimestamp = now;

      const calcLevel = this.calculateLevel(raw.xp);
      if (calcLevel > (raw.level || 1)) {
        leveledUp = true;
        raw.level = calcLevel;
        newLevel = calcLevel;
        // Award badge for milestones
        if (newLevel >= 5 && !raw.badges.includes('⭐ Активный')) raw.badges.push('⭐ Активный');
        if (newLevel >= 10 && !raw.badges.includes('🔥 Ветеран')) raw.badges.push('🔥 Ветеран');
        if (newLevel >= 25 && !raw.badges.includes('👑 Легенда')) raw.badges.push('👑 Легенда');
      }
    }

    this.save('profiles');
    return { profile: this.getProfile(guildId, userId), leveledUp, newLevel };
  }

  startVoiceSession(guildId, userId) {
    if (!this.data.profiles[guildId]) this.data.profiles[guildId] = {};
    if (!this.data.profiles[guildId][userId]) this.getProfile(guildId, userId);
    this.data.profiles[guildId][userId].voiceJoinedAt = Date.now();
    this.save('profiles');
  }

  endVoiceSession(guildId, userId) {
    if (!this.data.profiles[guildId] || !this.data.profiles[guildId][userId]) return null;
    const raw = this.data.profiles[guildId][userId];
    if (!raw.voiceJoinedAt) return null;

    const seconds = Math.floor((Date.now() - raw.voiceJoinedAt) / 1000);
    raw.voiceJoinedAt = null;

    if (seconds > 0) {
      return this.addVoiceSeconds(guildId, userId, seconds);
    }
    this.save('profiles');
    return null;
  }

  addVoiceSeconds(guildId, userId, seconds) {
    const profile = this.getProfile(guildId, userId);
    const raw = this.data.profiles[guildId][userId];

    raw.voiceTimeSeconds = (raw.voiceTimeSeconds || 0) + seconds;

    // Grant 10 XP per minute in voice
    const earnedXp = Math.floor((seconds / 60) * 10);
    if (earnedXp > 0) {
      raw.xp = (raw.xp || 0) + earnedXp;
      raw.level = this.calculateLevel(raw.xp);
    }

    // Voice badges
    if (raw.voiceTimeSeconds >= 3600 && !raw.badges.includes('🎙️ Спикер (1ч+)')) {
      raw.badges.push('🎙️ Спикер (1ч+)');
    }
    if (raw.voiceTimeSeconds >= 36000 && !raw.badges.includes('🎧 Радиоведущий (10ч+)')) {
      raw.badges.push('🎧 Радиоведущий (10ч+)');
    }

    this.save('profiles');
    return this.getProfile(guildId, userId);
  }

  updateProfile(guildId, userId, updates) {
    this.getProfile(guildId, userId);
    const raw = this.data.profiles[guildId][userId];

    if (updates.bannerUrl !== undefined) raw.bannerUrl = updates.bannerUrl;
    if (updates.bio !== undefined) raw.bio = updates.bio.slice(0, 300);
    if (updates.customTitle !== undefined) raw.customTitle = updates.customTitle.slice(0, 50);
    if (updates.xp !== undefined) {
      raw.xp = Math.max(0, parseInt(updates.xp, 10) || 0);
      raw.level = this.calculateLevel(raw.xp);
    }

    this.save('profiles');
    return this.getProfile(guildId, userId);
  }

  getLeaderboard(guildId, sortBy = 'xp', limit = 10) {
    if (!this.data.profiles || !this.data.profiles[guildId]) return [];

    const list = Object.values(this.data.profiles[guildId]).map(raw => {
      const level = this.calculateLevel(raw.xp);
      const currentBase = this.getXpForLevel(level);
      const nextTarget = this.getXpForLevel(level + 1);
      const progressPercent = Math.min(100, Math.max(0, Math.round(((raw.xp - currentBase) / (nextTarget - currentBase || 1)) * 100)));

      return {
        ...raw,
        level,
        currentBaseXp: currentBase,
        nextLevelXp: nextTarget,
        progressPercent
      };
    });

    if (sortBy === 'voice') {
      list.sort((a, b) => (b.voiceTimeSeconds || 0) - (a.voiceTimeSeconds || 0));
    } else if (sortBy === 'messages') {
      list.sort((a, b) => (b.messages || 0) - (a.messages || 0));
    } else {
      list.sort((a, b) => (b.xp || 0) - (a.xp || 0));
    }

    return list.slice(0, limit);
  }
}

module.exports = new Database();
