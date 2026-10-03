const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const db = require('../database/db');
const { setupCommunityServer, applySpecialRoleOverwrites, checkAndRestoreChannels } = require('../bot/services/serverSetupService');
const { banUser, unbanUser, muteUser, unmuteUser, warnUser } = require('../bot/services/modService');
const { rollbackActions } = require('../bot/services/antiCrashService');
const { parseDuration } = require('../utils/timeParser');

function createWebServer(client) {
  const app = express();

  // Trust proxy for reverse proxy environments like bothost.tech / Cloudflare / Nginx
  app.set('trust proxy', 1);

  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(process.env.SESSION_SECRET || 'musicium-session-secret'));

  // Static files for frontend
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth Middleware
  const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const cookieToken = req.signedCookies ? req.signedCookies.admin_session : null;
    const token = (authHeader && authHeader.replace('Bearer ', '')) || cookieToken || req.headers['x-admin-key'];

    const correctPassword = process.env.ADMIN_PASSWORD;
    if (correctPassword && (token === correctPassword || token === 'admin-authenticated-token')) {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized', message: 'Требуется авторизация администратора' });
  };

  // ----------------------------------------------------
  // AUTH ROUTES
  // ----------------------------------------------------
  app.post('/api/login', (req, res) => {
    const { password } = req.body;
    const correctPassword = process.env.ADMIN_PASSWORD;

    if (!correctPassword) {
      return res.status(500).json({ success: false, error: 'Пароль администратора не задан в конфигурации (.env)' });
    }

    if (password === correctPassword) {
      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.cookie('admin_session', 'admin-authenticated-token', {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      return res.json({
        success: true,
        token: 'admin-authenticated-token',
        user: { name: 'Admin', role: 'SuperAdministrator' }
      });
    }

    return res.status(401).json({ success: false, error: 'Неверный пароль администратора' });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie('admin_session');
    return res.json({ success: true });
  });

  app.get('/api/me', (req, res) => {
    const cookieToken = req.signedCookies ? req.signedCookies.admin_session : null;
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.replace('Bearer ', '')) || cookieToken;

    const correctPassword = process.env.ADMIN_PASSWORD;
    const authenticated = !!(correctPassword && (token === 'admin-authenticated-token' || token === correctPassword));

    return res.json({
      authenticated,
      bot: {
        ready: !!(client && client.isReady()),
        username: client?.user?.username || 'Musicium Staff',
        tag: client?.user?.tag || 'Musicium Staff#0000',
        avatar: client?.user?.displayAvatarURL?.() || null,
        guildCount: client?.guilds?.cache?.size || 0,
        ping: client?.ws?.ping || 0
      },
      db: db.getDbStatus ? db.getDbStatus() : { type: 'JSON', connected: false }
    });
  });

  // ----------------------------------------------------
  // GUILD DATA ROUTES
  // ----------------------------------------------------
  app.get('/api/guilds', authMiddleware, (req, res) => {
    if (!client || !client.isReady()) {
      return res.json({ guilds: [] });
    }

    const guilds = client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL(),
      memberCount: g.memberCount,
      ownerId: g.ownerId
    }));

    return res.json({ guilds });
  });

  app.get('/api/guild/:guildId', authMiddleware, async (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Сервер не найден в кэше бота' });
    }

    // Channels with hierarchical structure
    const channels = guild.channels.cache.map(ch => ({
      id: ch.id,
      name: ch.name,
      type: ch.type, // 0 = Text, 2 = Voice, 4 = Category
      parentId: ch.parentId,
      position: ch.rawPosition
    })).sort((a, b) => a.position - b.position);

    // Roles
    const roles = guild.roles.cache.map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor,
      position: r.position,
      isEveryone: r.id === guild.id,
      managed: r.managed
    })).sort((a, b) => b.position - a.position);

    return res.json({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL(),
      memberCount: guild.memberCount,
      ownerId: guild.ownerId,
      channels,
      roles
    });
  });

  // ----------------------------------------------------
  // ROLE PERMISSION MANAGEMENT ("где для какой роли что где открыть а что запретить")
  // ----------------------------------------------------
  app.get('/api/guild/:guildId/roles/:roleId/permissions', authMiddleware, async (req, res) => {
    const { guildId, roleId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

    const role = guild.roles.cache.get(roleId);
    if (!role) return res.status(404).json({ error: 'Роль не найдена' });

    // Collect permissions overwrite per channel
    const overwrites = [];
    guild.channels.cache.forEach(channel => {
      const ow = channel.permissionOverwrites.cache.get(roleId);
      overwrites.push({
        channelId: channel.id,
        channelName: channel.name,
        channelType: channel.type,
        parentId: channel.parentId,
        allow: ow ? ow.allow.toArray() : [],
        deny: ow ? ow.deny.toArray() : []
      });
    });

    return res.json({ role: { id: role.id, name: role.name, color: role.hexColor }, overwrites });
  });

  app.post('/api/guild/:guildId/roles/:roleId/permissions', authMiddleware, async (req, res) => {
    const { guildId, roleId } = req.params;
    const { channelPermissions } = req.body; // Array of { channelId, allow: [], deny: [] }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

    const role = guild.roles.cache.get(roleId);
    if (!role) return res.status(404).json({ error: 'Роль не найдена' });

    let updatedCount = 0;
    const errors = [];

    for (const item of channelPermissions) {
      try {
        const channel = guild.channels.cache.get(item.channelId);
        if (channel && channel.permissionOverwrites) {
          // Build permission bitfield
          const allowBits = item.allow.reduce((acc, perm) => {
            return PermissionFlagsBits[perm] ? acc | PermissionFlagsBits[perm] : acc;
          }, 0n);

          const denyBits = item.deny.reduce((acc, perm) => {
            return PermissionFlagsBits[perm] ? acc | PermissionFlagsBits[perm] : acc;
          }, 0n);

          await channel.permissionOverwrites.edit(roleId, {
            ...item.allow.reduce((acc, p) => ({ ...acc, [p]: true }), {}),
            ...item.deny.reduce((acc, p) => ({ ...acc, [p]: false }), {})
          });
          updatedCount++;
        }
      } catch (err) {
        errors.push(`Канал ${item.channelId}: ${err.message}`);
      }
    }

    db.addLog(guildId, 'channels_roles', 'PERMISSIONS_UPDATE', 'Изменение прав роли через веб-панель', `Обновлены права для роли @${role.name} на ${updatedCount} каналах`, { tag: 'Web Dashboard' });

    return res.json({ success: true, updatedCount, errors });
  });

  // ----------------------------------------------------
  // ANTI-CRASH SETTINGS ("лимиты изменений для антикраша")
  // ----------------------------------------------------
  app.get('/api/guild/:guildId/anticrash', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const settings = db.getGuildSettings(guildId);
    return res.json(settings.antiCrash);
  });

  app.post('/api/guild/:guildId/anticrash', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const updated = db.updateGuildSettings(guildId, { antiCrash: req.body });

    db.addLog(guildId, 'anticrash', 'SETTINGS_UPDATE', 'Настройки антикраша обновлены', 'Лимиты и параметры антикраша изменены через веб-интерфейс', { tag: 'Web Dashboard' });

    return res.json({ success: true, antiCrash: updated.antiCrash });
  });

  // ----------------------------------------------------
  // SPECIAL ROLES & AUTOMATIC CHANNEL OVERWRITES
  // ("пропиши роли мут, бан я туда укажу id и ты потом сам каналы подстроишь под них")
  // ----------------------------------------------------
  app.get('/api/guild/:guildId/special-roles', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const settings = db.getGuildSettings(guildId);
    return res.json({ specialRoles: settings.specialRoles });
  });

  app.post('/api/guild/:guildId/special-roles', authMiddleware, async (req, res) => {
    const { guildId } = req.params;
    const { muteRoleId, banRoleId, verifiedRoleId } = req.body;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

    // 1. Save configured IDs to DB
    const updated = db.updateGuildSettings(guildId, {
      specialRoles: {
        muteRoleId: muteRoleId?.trim() || null,
        banRoleId: banRoleId?.trim() || null,
        verifiedRoleId: verifiedRoleId?.trim() || null
      }
    });

    // 2. Automatically reconfigure permissions on all guild channels!
    const overwriteResult = await applySpecialRoleOverwrites(guild, updated.specialRoles);

    db.addLog(guildId, 'channels_roles', 'SPECIAL_ROLES_APPLIED', 'Настроены роли Мута, Бана и Верификации', `Права доступа для ролей Мута/Бана/Верификации автоматически применены на ${overwriteResult.updatedCount} каналах`, { tag: 'Web Dashboard' });

    return res.json({
      success: true,
      specialRoles: updated.specialRoles,
      channelsUpdated: overwriteResult.updatedCount,
      message: `Права для ролей Мут/Бан/Верификация успешно синхронизированы на ${overwriteResult.updatedCount} каналах!`
    });
  });

  // ----------------------------------------------------
  // RECENT ACTIONS & 1-HOUR ROLLBACK
  // ("отмена последних действий пользователя в течении последнего часа")
  // ----------------------------------------------------
  app.get('/api/guild/:guildId/recent-actions', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const cutoff = Date.now() - 3600000; // last 1 hour
    const actions = (db.data.recentActions || [])
      .filter(a => a.guildId === guildId && a.timestamp >= cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
    return res.json({ actions });
  });

  // ----------------------------------------------------
  // ANTI-CRASH OFFENDERS REGISTRY (Люди в антикраше)
  // ----------------------------------------------------
  app.get('/api/guild/:guildId/anticrash-users', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const users = db.getAntiCrashUsers(guildId);
    return res.json({ users });
  });

  app.post('/api/guild/:guildId/anticrash-users/:id/release', authMiddleware, async (req, res) => {
    const { guildId, id } = req.params;
    const guild = client.guilds.cache.get(guildId);

    const users = db.getAntiCrashUsers(guildId);
    const target = users.find(u => u.id === id || u.userId === id);
    if (!target) {
      return res.status(404).json({ error: 'Запись нарушителя не найдена' });
    }

    const released = db.releaseAntiCrashUser(guildId, id, 'Владелец сервера (Панель управления)');

    if (guild && target.userId) {
      // 1. Unban if user was banned in Discord
      try {
        const bans = await guild.bans.fetch().catch(() => null);
        if (bans && bans.has(target.userId)) {
          await guild.members.unban(target.userId, 'Снятие санкций антикраша владельцем через веб-панель').catch(() => {});
        }
      } catch (e) {}

      // 2. Remove ban role & restore stripped roles if user is on server
      try {
        const member = await guild.members.fetch(target.userId).catch(() => null);
        if (member) {
          const settings = db.getGuildSettings(guildId);
          if (settings.specialRoles?.banRoleId) {
            await member.roles.remove(settings.specialRoles.banRoleId, 'Снятие роли бана антикраша').catch(() => {});
          }
          if (target.strippedRoleIds && target.strippedRoleIds.length > 0) {
            for (const rId of target.strippedRoleIds) {
              const role = guild.roles.cache.get(rId);
              if (role && role.editable && !member.roles.cache.has(rId)) {
                await member.roles.add(role, 'Восстановление ролей антикраша').catch(() => {});
              }
            }
          }
        }
      } catch (e) {}
    }

    db.addLog(guildId, 'anticrash', 'OFFENDER_RELEASED', 'Снятие санкций антикраша владельцем', `Пользователь ${target.userTag} (${target.userId}) освобожден из карантина антикраша по решению владельца сервера`, { tag: 'Web Dashboard' });
    return res.json({ success: true, user: released });
  });

  app.delete('/api/guild/:guildId/anticrash-users/:id', authMiddleware, (req, res) => {
    const { guildId, id } = req.params;
    const removed = db.removeAntiCrashUser(id);
    if (removed) {
      db.addLog(guildId, 'anticrash', 'OFFENDER_REMOVED', 'Удаление записи из БД антикраша', `Запись инцидента ${id} удалена из постоянной базы данных`, { tag: 'Web Dashboard' });
      return res.json({ success: true });
    }
    return res.status(404).json({ error: 'Запись не найдена' });
  });

  // ----------------------------------------------------
  // TICKETS & BUG REPORTS ROUTES
  // ----------------------------------------------------
  app.get('/api/guild/:guildId/tickets', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const { status } = req.query;
    const tickets = db.getTickets(guildId, status || null);
    return res.json({ tickets });
  });

  app.post('/api/guild/:guildId/tickets/:id/close', authMiddleware, async (req, res) => {
    const { guildId, id } = req.params;
    const { reason } = req.body;
    const guild = client.guilds.cache.get(guildId);

    const closed = db.closeTicket(id, 'Web Администратор', reason || 'Закрыт через веб-панель');
    if (!closed) {
      return res.status(404).json({ error: 'Тикет не найден или уже закрыт' });
    }

    // Try deleting Discord channel if exists
    if (guild && closed.channelId) {
      const ch = guild.channels.cache.get(closed.channelId);
      if (ch) {
        await ch.send({
          content: `🔒 **Тикет закрыт администратором через панель управления.** Канал будет удален...`
        }).catch(() => {});
        setTimeout(async () => {
          await ch.delete('Тикет закрыт через веб-панель').catch(() => {});
        }, 3000);
      }
    }

    db.addLog(guildId, 'moderation', 'TICKET_CLOSED', 'Закрытие тикета через панель', `Тикет #${closed.ticketNumber} закрыт администратором`, { tag: 'Web Dashboard' });
    return res.json({ success: true, ticket: closed });
  });

  app.get('/api/guild/:guildId/bug-reports', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const { status } = req.query;
    const reports = db.getBugReports(guildId, status || null);
    return res.json({ reports });
  });

  app.post('/api/guild/:guildId/bug-reports/:id/status', authMiddleware, async (req, res) => {
    const { guildId, id } = req.params;
    const { status, adminComment, assignedTo } = req.body;
    const guild = client.guilds.cache.get(guildId);

    const updated = db.updateBugReportStatus(id, status, adminComment, assignedTo);
    if (!updated) {
      return res.status(404).json({ error: 'Баг-репорт не найден' });
    }

    // Update message in Discord if messageId exists
    if (guild && updated.messageId) {
      const bugChannel = guild.channels.cache.find(c => c.isTextBased() && (c.name.includes('баг') || c.name.includes('bug')));
      if (bugChannel) {
        try {
          const msg = await bugChannel.messages.fetch(updated.messageId).catch(() => null);
          if (msg && msg.embeds.length > 0) {
            const oldEmbed = msg.embeds[0];
            const statusLabels = {
              new: '🟡 Новый',
              in_progress: '⚙️ В работе',
              fixed: '✅ Исправлено',
              rejected: '❌ Отклонено'
            };
            const statusColors = {
              new: 0xF1C40F,
              in_progress: 0x3498DB,
              fixed: 0x2ECC71,
              rejected: 0x95A5A6
            };
            const newEmbed = EmbedBuilder.from(oldEmbed)
              .setColor(statusColors[status] || 0xF1C40F)
              .setFields(
                oldEmbed.fields.map(f => f.name === 'Статус' ? { name: 'Статус', value: statusLabels[status] || status, inline: true } : f)
              );
            await msg.edit({ embeds: [newEmbed] }).catch(() => {});
          }
        } catch (e) {}
      }
    }

    db.addLog(guildId, 'moderation', 'BUG_STATUS_UPDATE', 'Обновление статуса бага', `Статус баг-репорта #${updated.reportNumber} изменен на "${status}" через веб-панель`, { tag: 'Web Dashboard' });
    return res.json({ success: true, report: updated });
  });

  app.delete('/api/guild/:guildId/bug-reports/:id', authMiddleware, (req, res) => {
    const { guildId, id } = req.params;
    const deleted = db.deleteBugReport(id);
    if (deleted) {
      db.addLog(guildId, 'moderation', 'BUG_DELETED', 'Удаление баг-репорта', `Баг-репорт ${id} удален из базы данных`, { tag: 'Web Dashboard' });
      return res.json({ success: true });
    }
    return res.status(404).json({ error: 'Баг-репорт не найден' });
  });

  app.post('/api/guild/:guildId/rollback/:executorId', authMiddleware, async (req, res) => {
    const { guildId, executorId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

    try {
      const result = await rollbackActions(guild, executorId, 3600000);
      db.addLog(guildId, 'anticrash', 'MANUAL_ROLLBACK', 'Ручной откат действий нарушителя', `Произведен откат действий пользователя ID: ${executorId} за последний час`, { tag: 'Web Dashboard' });
      return res.json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------
  // DAILY CHANNEL INTEGRITY CHECK & RESTORATION
  // ("каждый день просто проверялись на наличие, если какогото канала нету его просто бот пересоздает")
  // ----------------------------------------------------
  app.post('/api/guild/:guildId/check-channels', authMiddleware, async (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

    try {
      const status = await checkAndRestoreChannels(guild);
      return res.json({ success: true, status });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------
  // MODERATION & WARNS ("систему варнов и т.п., всё это выводить мне на сайт")
  // ----------------------------------------------------
  app.get('/api/guild/:guildId/warns', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const { userId } = req.query;
    const warns = db.getWarns(guildId, userId || null);
    return res.json({ warns });
  });

  app.delete('/api/warns/:warnId', authMiddleware, (req, res) => {
    const { warnId } = req.params;
    const removed = db.removeWarn(warnId);
    return res.json({ success: removed });
  });

  app.get('/api/guild/:guildId/active-bans', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const bans = db.getActiveBans(guildId);
    return res.json({ bans });
  });

  app.get('/api/guild/:guildId/active-mutes', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const mutes = db.getActiveMutes(guildId);
    return res.json({ mutes });
  });

  app.post('/api/guild/:guildId/mod-action', authMiddleware, async (req, res) => {
    const { guildId } = req.params;
    const { action, targetId, duration, reason, type } = req.body;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

    try {
      const durationMs = parseDuration(duration);

      if (action === 'ban') {
        const user = await client.users.fetch(targetId);
        await banUser(guild, user, { tag: 'Веб-панель', id: 'dashboard' }, durationMs, reason);
        return res.json({ success: true, message: `Пользователь ${user.tag} успешно забанен.` });
      }

      if (action === 'unban') {
        await unbanUser(guild, targetId, { tag: 'Веб-панель', id: 'dashboard' }, reason);
        return res.json({ success: true, message: `Пользователь ID ${targetId} разблокирован.` });
      }

      if (action === 'mute') {
        const member = await guild.members.fetch(targetId);
        await muteUser(guild, member, { tag: 'Веб-панель', id: 'dashboard' }, type || 'text', durationMs, reason);
        return res.json({ success: true, message: `Мут выдан для ${member.user.tag}.` });
      }

      if (action === 'unmute') {
        const member = await guild.members.fetch(targetId).catch(() => null);
        await unmuteUser(guild, member || { id: targetId }, { tag: 'Веб-панель', id: 'dashboard' }, type || 'text', reason);
        return res.json({ success: true, message: `Мут снят для ${targetId}.` });
      }

      if (action === 'warn') {
        const user = await client.users.fetch(targetId);
        const result = await warnUser(guild, user, { tag: 'Веб-панель', id: 'dashboard' }, reason);
        return res.json({ success: true, message: `Варн выдан пользователю ${user.tag}. Всего варнов: ${result.totalWarns}` });
      }

      return res.status(400).json({ error: 'Неизвестное действие' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------
  // LOGS CATEGORIZED VIEWER ("категорию логов по каждой из возможных категорий")
  // ----------------------------------------------------
  app.get('/api/guild/:guildId/logs', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const { category, limit } = req.query;
    const logs = db.getLogs(guildId, category || 'all', parseInt(limit, 10) || 100);
    return res.json({ logs });
  });

  // ----------------------------------------------------
  // AUTO SERVER SETUP ("каналы создай сам...")
  // ----------------------------------------------------
  app.post('/api/guild/:guildId/setup-server', authMiddleware, async (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

    try {
      const result = await setupCommunityServer(guild, { tag: 'Веб-панель' });
      return res.json(result);
    } catch (err) {
      console.error('[Web Setup Error]', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------
  // PRESET BANNERS & USER PROFILES
  // ----------------------------------------------------
  const PRESET_BANNERS = [
    { id: 'synthwave', name: '🌆 Synthwave Sunset', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80' },
    { id: 'cyberpunk', name: '⚡ Cyberpunk Neon City', url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=1200&q=80' },
    { id: 'nebula', name: '🌌 Deep Space Nebula', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1200&q=80' },
    { id: 'vinyl', name: '🎵 Vinyl Groove', url: 'https://images.unsplash.com/photo-1539185441755-769473a23570?auto=format&fit=crop&w=1200&q=80' },
    { id: 'equalizer', name: '🎛️ Neon Equalizer', url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80' },
    { id: 'lofi', name: '☕ Lo-Fi Chill Room', url: 'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?auto=format&fit=crop&w=1200&q=80' }
  ];

  app.get('/api/banners', (req, res) => {
    return res.json({ banners: PRESET_BANNERS });
  });

  app.get('/api/guild/:guildId/profiles', authMiddleware, (req, res) => {
    const { guildId } = req.params;
    const { sort, limit } = req.query;
    const leaderboard = db.getLeaderboard(guildId, sort || 'xp', parseInt(limit, 10) || 50);
    return res.json({ profiles: leaderboard });
  });

  app.get('/api/guild/:guildId/profiles/:userId', authMiddleware, async (req, res) => {
    const { guildId, userId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    let userTag = null;
    let avatarUrl = null;

    if (guild) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        userTag = member.user.tag;
        avatarUrl = member.user.displayAvatarURL({ dynamic: true });
      }
    }

    const profile = db.getProfile(guildId, userId, userTag, avatarUrl);
    return res.json({ profile });
  });

  app.post('/api/guild/:guildId/profiles/:userId', authMiddleware, (req, res) => {
    const { guildId, userId } = req.params;
    const updates = req.body;
    const updated = db.updateProfile(guildId, userId, updates);
    return res.json({ success: true, profile: updated });
  });

  // Fallback to index.html for SPA (Express 5 compatible)
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

module.exports = {
  createWebServer
};
