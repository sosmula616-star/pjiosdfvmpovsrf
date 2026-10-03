const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('./logService');
const { formatDurationRu, formatTimestamp } = require('../../utils/timeParser');

/**
 * Execute Ban (Temporary or Permanent)
 */
async function banUser(guild, user, moderator, durationMs, reason) {
  const expiresAt = durationMs ? Date.now() + durationMs : null;
  const durationText = durationMs ? formatDurationRu(durationMs) : 'Навсегда';
  const settings = db.getGuildSettings(guild.id);
  const banRoleId = settings.specialRoles?.banRoleId;

  // DM target user before banning
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle(`🔨 Вы были заблокированы на сервере ${guild.name}`)
      .addFields(
        { name: 'Причина', value: reason || 'Не указана' },
        { name: 'Срок', value: durationText },
        { name: 'Модератор', value: moderator ? moderator.tag : 'Администрация' }
      )
      .setTimestamp();
    await user.send({ embeds: [dmEmbed] }).catch(() => {});
  } catch (e) {}

  // Assign Ban Role & strip other roles if member is still in guild
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) {
    if (banRoleId) {
      const banRole = guild.roles.cache.get(banRoleId);
      if (banRole && banRole.editable) {
        await member.roles.add(banRole, 'Назначена роль бана').catch(() => {});
      }
    }
    const manageableRoles = member.roles.cache.filter(r => r.id !== guild.roles.everyone.id && r.id !== banRoleId && r.editable);
    if (manageableRoles.size > 0) {
      await member.roles.remove(manageableRoles, 'Блокировка: Снятие ролей').catch(() => {});
    }
  }

  // Execute ban
  await guild.members.ban(user.id, { reason: `[${durationText}] ${reason} | Модератор: ${moderator ? moderator.tag : 'Консоль'}` });

  // Store in DB for auto-unban if temporary
  db.addActiveBan(guild.id, user.id, user.tag || user.username, moderator ? moderator.id : 'system', reason, expiresAt);

  // Log
  await sendLog(guild, {
    category: 'moderation',
    action: 'BAN',
    title: `Блокировка участника (${durationText})`,
    description: `Пользователь был забанен на сервере.`,
    executor: moderator,
    target: user,
    fields: [
      { name: 'Срок', value: durationText, inline: true },
      { name: 'Истекает', value: expiresAt ? formatTimestamp(expiresAt) : 'Никогда', inline: true },
      { name: 'Роль бана', value: banRoleId ? `<@&${banRoleId}>` : 'Не назначена', inline: true },
      { name: 'Причина', value: reason || 'Не указана', inline: false }
    ],
    color: 0xE74C3C
  });

  return { success: true, expiresAt, durationText };
}

/**
 * Execute Unban
 */
async function unbanUser(guild, userId, moderator, reason = 'Снятие блокировки') {
  await guild.members.unban(userId, reason);
  db.removeActiveBan(guild.id, userId);

  const settings = db.getGuildSettings(guild.id);
  const banRoleId = settings.specialRoles?.banRoleId;
  if (banRoleId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && member.roles.cache.has(banRoleId)) {
      await member.roles.remove(banRoleId, 'Разбан: Снятие роли бана').catch(() => {});
    }
  }

  await sendLog(guild, {
    category: 'moderation',
    action: 'UNBAN',
    title: 'Разблокировка пользователя',
    description: `Пользователь был разбанен.`,
    executor: moderator,
    target: { id: userId, tag: `User ID: ${userId}` },
    fields: [
      { name: 'Причина', value: reason, inline: false }
    ],
    color: 0x2ECC71
  });

  return { success: true };
}

/**
 * Execute Mute (Text or Voice)
 */
async function muteUser(guild, member, moderator, type, durationMs, reason) {
  const expiresAt = durationMs ? Date.now() + durationMs : null;
  const durationText = durationMs ? formatDurationRu(durationMs) : 'Навсегда';
  const typeText = type === 'voice' ? 'Голосовой мут' : 'Текстовый мут (Тайм-аут)';

  const settings = db.getGuildSettings(guild.id);
  const muteRoleId = settings.specialRoles?.muteRoleId;

  // DM user
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(0xE67E22)
      .setTitle(`🔇 Вам выдан ${typeText} на сервере ${guild.name}`)
      .addFields(
        { name: 'Тип', value: typeText },
        { name: 'Причина', value: reason || 'Не указана' },
        { name: 'Срок', value: durationText },
        { name: 'Модератор', value: moderator ? moderator.tag : 'Администрация' }
      )
      .setTimestamp();
    await member.send({ embeds: [dmEmbed] }).catch(() => {});
  } catch (e) {}

  // Assign Mute Role if configured
  if (muteRoleId) {
    const muteRole = guild.roles.cache.get(muteRoleId);
    if (muteRole && muteRole.editable) {
      await member.roles.add(muteRole, `Выдан мут: ${reason}`).catch(() => {});
    }
  }

  if (type === 'voice') {
    // Voice Mute: if member is currently in a voice channel, mute them
    if (member.voice && member.voice.channel) {
      await member.voice.setMute(true, reason || 'Голосовой мут модератора');
    }
    // Save to DB so voiceStateUpdate keeps them muted
    db.addActiveMute(guild.id, member.id, member.user.tag, moderator ? moderator.id : 'system', 'voice', reason, expiresAt);
  } else {
    // Text Timeout
    const timeoutMs = durationMs && durationMs < (28 * 24 * 60 * 60 * 1000) ? durationMs : (28 * 24 * 60 * 60 * 1000);
    await member.timeout(timeoutMs, reason || 'Текстовый мут');
    db.addActiveMute(guild.id, member.id, member.user.tag, moderator ? moderator.id : 'system', 'text', reason, expiresAt);
  }

  // Log
  await sendLog(guild, {
    category: 'moderation',
    action: type === 'voice' ? 'VOICE_MUTE' : 'TEXT_MUTE',
    title: `Выдан ${typeText}`,
    description: `Пользователю ограничены права общения.`,
    executor: moderator,
    target: member.user,
    fields: [
      { name: 'Тип', value: typeText, inline: true },
      { name: 'Срок', value: durationText, inline: true },
      { name: 'Роль мута', value: muteRoleId ? `<@&${muteRoleId}>` : 'Не назначена', inline: true },
      { name: 'Истекает', value: expiresAt ? formatTimestamp(expiresAt) : 'Никогда', inline: true },
      { name: 'Причина', value: reason || 'Не указана', inline: false }
    ],
    color: 0xE67E22
  });

  return { success: true, type, expiresAt, durationText };
}

/**
 * Execute Unmute
 */
async function unmuteUser(guild, member, moderator, type = 'text', reason = 'Снятие ограничений') {
  const settings = db.getGuildSettings(guild.id);
  const muteRoleId = settings.specialRoles?.muteRoleId;

  // Remove Mute Role if configured
  if (member && muteRoleId && member.roles && member.roles.cache.has(muteRoleId)) {
    await member.roles.remove(muteRoleId, `Снятие мута: ${reason}`).catch(() => {});
  }

  if (type === 'voice') {
    if (member && member.voice && member.voice.channel) {
      await member.voice.setMute(false, reason).catch(() => {});
    }
    db.removeActiveMute(guild.id, member.id, 'voice');
  } else {
    if (member && member.timeout) {
      await member.timeout(null, reason).catch(() => {});
    }
    db.removeActiveMute(guild.id, member.id, 'text');
  }

  await sendLog(guild, {
    category: 'moderation',
    action: type === 'voice' ? 'VOICE_UNMUTE' : 'TEXT_UNMUTE',
    title: `Снятие ${type === 'voice' ? 'голосового' : 'текстового'} мута`,
    description: `Ограничения были успешно сняты.`,
    executor: moderator,
    target: member ? (member.user || { id: member.id }) : { id: 'unknown' },
    fields: [
      { name: 'Причина', value: reason, inline: false }
    ],
    color: 0x2ECC71
  });

  return { success: true };
}

/**
 * Add Warning
 */
async function warnUser(guild, targetUser, moderator, reason) {
  const warn = db.addWarn(
    guild.id,
    targetUser.id,
    targetUser.tag || targetUser.username,
    moderator ? moderator.id : 'system',
    moderator ? (moderator.tag || moderator.username) : 'Консоль',
    reason
  );

  const allWarns = db.getWarns(guild.id, targetUser.id);

  // DM user
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle(`⚠️ Вам выдано предупреждение на сервере ${guild.name}`)
      .addFields(
        { name: 'Причина', value: reason || 'Не указана' },
        { name: 'Всего предупреждений', value: `${allWarns.length}` },
        { name: 'Модератор', value: moderator ? moderator.tag : 'Администрация' }
      )
      .setTimestamp();
    await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
  } catch (e) {}

  // Log
  await sendLog(guild, {
    category: 'moderation',
    action: 'WARN',
    title: `Предупреждение [Варн #${allWarns.length}]`,
    description: `Пользователь получил официальное предупреждение.`,
    executor: moderator,
    target: targetUser,
    fields: [
      { name: 'Причина', value: reason || 'Не указана', inline: false },
      { name: 'Всего активных варнов', value: `${allWarns.length}`, inline: true },
      { name: 'ID варна', value: `\`${warn.id}\``, inline: true }
    ],
    color: 0xF1C40F
  });

  return { warn, totalWarns: allWarns.length };
}

/**
 * Background Scheduler: checks expired bans and mutes every 15 seconds
 */
function startExpirationScheduler(client) {
  console.log('[Scheduler] Starting expiration checker for temporary bans and mutes...');
  setInterval(async () => {
    const now = Date.now();

    // 1. Check temporary bans
    const bans = db.getActiveBans();
    for (const ban of bans) {
      if (ban.expiresAt && ban.expiresAt <= now) {
        try {
          const guild = client.guilds.cache.get(ban.guildId);
          if (guild) {
            console.log(`[Scheduler] Unbanning user ${ban.userId} (Ban expired)`);
            await guild.members.unban(ban.userId, 'Срок временного бана истек');
            db.removeActiveBan(ban.guildId, ban.userId);

            const settings = db.getGuildSettings(guild.id);
            if (settings.specialRoles?.banRoleId) {
              const member = await guild.members.fetch(ban.userId).catch(() => null);
              if (member && member.roles.cache.has(settings.specialRoles.banRoleId)) {
                await member.roles.remove(settings.specialRoles.banRoleId, 'Истек срок бана').catch(() => {});
              }
            }

            await sendLog(guild, {
              category: 'moderation',
              action: 'AUTO_UNBAN',
              title: 'Срок бана истек (Авто-разбан)',
              description: `Пользователь был автоматически разбанен.`,
              target: { id: ban.userId, tag: ban.userTag || `User ID: ${ban.userId}` },
              fields: [
                { name: 'Исходная причина', value: ban.reason || '—' }
              ],
              color: 0x2ECC71
            });
          }
        } catch (err) {
          console.warn(`[Scheduler] Could not auto-unban ${ban.userId}:`, err.message);
          db.removeActiveBan(ban.guildId, ban.userId); // remove invalid ban
        }
      }
    }

    // 2. Check temporary mutes
    const mutes = db.getActiveMutes();
    for (const mute of mutes) {
      if (mute.expiresAt && mute.expiresAt <= now) {
        try {
          const guild = client.guilds.cache.get(mute.guildId);
          if (guild) {
            const member = await guild.members.fetch(mute.userId).catch(() => null);
            if (mute.type === 'voice') {
              if (member && member.voice && member.voice.channel) {
                await member.voice.setMute(false, 'Срок голосового мута истек');
              }
              db.removeActiveMute(mute.guildId, mute.userId, 'voice');
            } else {
              if (member) {
                await member.timeout(null, 'Срок текстового мута истек');
              }
              db.removeActiveMute(mute.guildId, mute.userId, 'text');
            }

            const settings = db.getGuildSettings(guild.id);
            if (member && settings.specialRoles?.muteRoleId && member.roles.cache.has(settings.specialRoles.muteRoleId)) {
              await member.roles.remove(settings.specialRoles.muteRoleId, 'Истек срок мута').catch(() => {});
            }

            await sendLog(guild, {
              category: 'moderation',
              action: 'AUTO_UNMUTE',
              title: `Срок ${mute.type === 'voice' ? 'голосового' : 'текстового'} мута истек`,
              description: `Ограничения были сняты автоматически.`,
              target: { id: mute.userId, tag: mute.userTag || `User ID: ${mute.userId}` },
              fields: [
                { name: 'Тип', value: mute.type, inline: true },
                { name: 'Исходная причина', value: mute.reason || '—', inline: true }
              ],
              color: 0x2ECC71
            });
          }
        } catch (err) {
          console.warn(`[Scheduler] Could not auto-unmute ${mute.userId}:`, err.message);
          db.removeActiveMute(mute.guildId, mute.userId);
        }
      }
    }
  }, 15000);
}

module.exports = {
  banUser,
  unbanUser,
  muteUser,
  unmuteUser,
  warnUser,
  startExpirationScheduler
};
