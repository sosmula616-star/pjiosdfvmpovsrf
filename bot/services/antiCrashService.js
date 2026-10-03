const { AuditLogEvent, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('./logService');

// In-memory action records for sliding window threshold check: Map<guildId_userId_actionType, number[]>
const actionTrackers = new Map();

/**
 * Checks if user is exempt from Anti-Crash limits
 */
function isWhitelisted(guild, member, settings) {
  if (!member) return false;
  if (member.id === guild.ownerId) return true;
  if (member.id === guild.client.user.id) return true;

  const ac = settings.antiCrash || {};
  if (ac.whitelistUsers && ac.whitelistUsers.includes(member.id)) {
    return true;
  }

  if (ac.whitelistRoles && member.roles && member.roles.cache) {
    const hasRole = member.roles.cache.some(r => ac.whitelistRoles.includes(r.id));
    if (hasRole) return true;
  }

  return false;
}

/**
 * Record an action and check if rate limit is exceeded
 */
async function registerAction(guild, executor, actionType, details = '', snapshot = null) {
  if (!guild || !executor) return false;

  const settings = db.getGuildSettings(guild.id);
  const ac = settings.antiCrash;
  if (!ac || !ac.enabled) return false;

  // Always record action snapshot in DB for the 1-hour rollback history
  db.recordActionSnapshot(guild.id, executor.id, actionType, details, snapshot);

  // Fetch member
  let member = null;
  try {
    member = await guild.members.fetch(executor.id).catch(() => null);
  } catch (e) {}

  if (isWhitelisted(guild, member, settings)) {
    return false; // Whitelisted user
  }

  const windowMs = (ac.windowSeconds || 60) * 1000;
  const limit = ac.limits ? ac.limits[actionType] : 3;

  const key = `${guild.id}_${executor.id}_${actionType}`;
  const now = Date.now();
  let timestamps = actionTrackers.get(key) || [];

  // Remove timestamps outside window
  timestamps = timestamps.filter(t => (now - t) < windowMs);
  timestamps.push(now);
  actionTrackers.set(key, timestamps);

  console.log(`[AntiCrash] ${executor.tag} did ${actionType} (${timestamps.length}/${limit} in ${ac.windowSeconds}s)`);

  if (timestamps.length >= limit) {
    // Limit exceeded! Trigger protection, rollback, and punishment
    await handleBreach(guild, executor, member, actionType, timestamps.length, limit, details, ac, settings);
    // Reset tracker for this key so we don't spam punish
    actionTrackers.set(key, []);
    return true;
  }

  return false;
}

/**
 * Rollback actions performed by a specific user within the last 1 hour
 */
async function rollbackActions(guild, executorId, maxAgeMs = 3600000) {
  const actions = db.getRecentActionsByExecutor(guild.id, executorId, maxAgeMs);
  const results = {
    restoredChannels: 0,
    deletedChannels: 0,
    restoredRoles: 0,
    deletedRoles: 0,
    unbannedUsers: 0,
    errors: []
  };

  console.log(`[AntiCrash Rollback] Rolling back ${actions.length} actions for executor ${executorId}...`);

  for (const act of actions) {
    try {
      // 1. Recreate deleted channel
      if (act.actionType === 'channelDelete' && act.snapshot) {
        const { name, type, parentId } = act.snapshot;
        const exists = guild.channels.cache.some(c => c.name === name);
        if (!exists) {
          await guild.channels.create({
            name,
            type: type !== undefined ? type : ChannelType.GuildText,
            parent: parentId || null,
            reason: `Anti-Crash Rollback: Восстановление удаленного канала #${name}`
          }).catch(e => results.errors.push(`Восстановление #${name}: ${e.message}`));
          results.restoredChannels++;
        }
      }

      // 2. Delete maliciously created channel
      if (act.actionType === 'channelCreate' && act.snapshot?.channelId) {
        const ch = guild.channels.cache.get(act.snapshot.channelId);
        if (ch) {
          await ch.delete('Anti-Crash Rollback: Удаление спам-канала').catch(() => {});
          results.deletedChannels++;
        }
      }

      // 3. Recreate deleted role
      if (act.actionType === 'roleDelete' && act.snapshot) {
        const { name, color, permissions } = act.snapshot;
        const exists = guild.roles.cache.some(r => r.name === name);
        if (!exists) {
          await guild.roles.create({
            name,
            color: color || 0x99AAB5,
            permissions: permissions ? BigInt(permissions) : undefined,
            reason: `Anti-Crash Rollback: Восстановление роли @${name}`
          }).catch(e => results.errors.push(`Восстановление @${name}: ${e.message}`));
          results.restoredRoles++;
        }
      }

      // 4. Delete maliciously created role
      if (act.actionType === 'roleCreate' && act.snapshot?.roleId) {
        const r = guild.roles.cache.get(act.snapshot.roleId);
        if (r && r.editable) {
          await r.delete('Anti-Crash Rollback: Удаление созданной роли').catch(() => {});
          results.deletedRoles++;
        }
      }

      // 5. Unban mass-banned users
      if (act.actionType === 'banAdd' && act.snapshot?.userId) {
        await guild.members.unban(act.snapshot.userId, 'Anti-Crash Rollback: Снятие массового бана').catch(() => {});
        results.unbannedUsers++;
      }
    } catch (err) {
      results.errors.push(err.message);
    }
  }

  return results;
}

/**
 * Executes rollback and punishment when rate limit is exceeded
 */
async function handleBreach(guild, executor, member, actionType, count, limit, details, acConfig, settings) {
  const actionChosen = acConfig.action || 'quarantine';
  let punishmentApplied = '';

  // 1. Fetch all actions done in the last 1 hour
  const recentActions = db.getRecentActionsByExecutor(guild.id, executor.id, 3600000);
  const actionsListFormatted = recentActions.slice(0, 15).map(a => {
    const time = new Date(a.timestamp).toLocaleTimeString('ru-RU');
    return `• \`[${time}]\` **${a.actionType}** — ${a.details}`;
  }).join('\n') || '• Нет записанных подробностей';

  // 2. Perform Automatic Rollback of last 1 hour actions
  const rollbackRes = await rollbackActions(guild, executor.id, 3600000);
  const rollbackSummary = 
    `Каналов восстановлено: ${rollbackRes.restoredChannels} | Ролей восстановлено: ${rollbackRes.restoredRoles} | ` +
    `Спам-каналов удалено: ${rollbackRes.deletedChannels} | Разбанено: ${rollbackRes.unbannedUsers}`;

  // 3. Apply configured Ban Role or Punishment
  const banRoleId = settings.specialRoles?.banRoleId;

  let strippedRoleIds = [];
  try {
    if (member) {
      // Strip dangerous roles and remember them for the Server Owner to restore
      const manageableRoles = member.roles.cache.filter(r => r.id !== guild.roles.everyone.id && r.editable);
      if (manageableRoles.size > 0) {
        strippedRoleIds = manageableRoles.map(r => r.id);
        await member.roles.remove(manageableRoles, 'Anti-Crash: Превышение лимита опасных действий').catch(() => {});
      }

      // Assign configured Ban Role if present
      if (banRoleId) {
        const banRole = guild.roles.cache.get(banRoleId);
        if (banRole && banRole.editable) {
          await member.roles.add(banRole, 'Anti-Crash: Назначена роль бана').catch(() => {});
          punishmentApplied = `Выдана роль бана: @${banRole.name} (Карантин)`;
        }
      }
    }

    if (actionChosen === 'ban') {
      await guild.members.ban(executor.id, {
        reason: `Anti-Crash: Превышение лимита ${actionType} (${count}/${limit}). Откат действий произведен.`
      }).catch(() => {});
      punishmentApplied += (punishmentApplied ? ' • ' : '') + 'Участник забанен на сервере';
    } else if (actionChosen === 'kick' && member) {
      await member.kick(`Anti-Crash: Превышение лимита ${actionType} (${count}/${limit})`).catch(() => {});
      punishmentApplied += (punishmentApplied ? ' • ' : '') + 'Участник исключен с сервера';
    } else if (!punishmentApplied) {
      punishmentApplied = 'Роли сняты (Карантин) • Оповещение отправлено';
    }
  } catch (err) {
    console.error(`[AntiCrash] Punishment error:`, err.message);
    punishmentApplied = `Ошибка применения наказания: ${err.message}`;
  }

  // 3.5. Запись нарушителя в постоянную базу данных (PostgreSQL)
  try {
    db.recordAntiCrashUser(
      guild.id,
      executor,
      actionType,
      count,
      limit,
      punishmentApplied,
      rollbackSummary,
      details,
      strippedRoleIds
    );
  } catch (dbErr) {
    console.error('[AntiCrash] Ошибка записи нарушителя в БД:', dbErr.message);
  }

  // 4. Send Critical Alert Log with Action History & Rollback Info
  await sendLog(guild, {
    category: 'anticrash',
    action: 'LIMIT_EXCEEDED_ROLLBACK',
    title: '🚨 СРАБОТАЛА ЗАЩИТА АНТИКРАША • ДЕЙСТВИЯ ОТМЕНЕНЫ!',
    description: `Пользователь **${executor.tag}** (\`${executor.id}\`) превысил допустимый лимит действий.\nБот произвел **откат действий за последний час** и применил защитные меры.`,
    executor: executor,
    fields: [
      { name: '⚡ Причина срабатывания', value: `\`${actionType}\` (${count} из ${limit} в минуту)`, inline: true },
      { name: '🛡️ Принятая мера', value: `**${punishmentApplied}**`, inline: true },
      { name: '🔄 Результат отката (Rollback)', value: `\`\`\`${rollbackSummary}\`\`\``, inline: false },
      { name: '📜 Действия пользователя за последний час:', value: actionsListFormatted.slice(0, 1024), inline: false }
    ],
    color: 0xFF0033
  });

  // 5. Direct Message to Guild Owner
  try {
    const owner = await guild.fetchOwner();
    if (owner) {
      const dmEmbed = new EmbedBuilder()
        .setColor(0xFF0033)
        .setTitle(`🚨 [Anti-Crash] Опасность нейтрализована на сервере ${guild.name}!`)
        .setDescription(
          `Пользователь **${executor.tag}** (\`${executor.id}\`) превысил лимит **${actionType}**.\n\n` +
          `• **Принятая мера:** ${punishmentApplied}\n` +
          `• **Откат за 1 час:** ${rollbackSummary}\n\n` +
          `**Совершенные действия за последний час:**\n${actionsListFormatted.slice(0, 800)}`
        )
        .setTimestamp();
      await owner.send({ embeds: [dmEmbed] }).catch(() => {});
    }
  } catch (e) {}
}

module.exports = {
  registerAction,
  rollbackActions,
  isWhitelisted
};
