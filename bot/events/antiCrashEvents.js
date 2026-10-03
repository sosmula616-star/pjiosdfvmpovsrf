const { AuditLogEvent } = require('discord.js');
const { registerAction } = require('../services/antiCrashService');

/**
 * Helper to fetch audit log entry with retry/delay
 */
async function getAuditExecutor(guild, auditType, targetId = null) {
  try {
    // Wait small delay for Discord audit log to register
    await new Promise(r => setTimeout(r, 800));
    const auditLogs = await guild.fetchAuditLogs({ limit: 1, type: auditType }).catch(() => null);
    if (!auditLogs) return null;

    const entry = auditLogs.entries.first();
    if (!entry) return null;

    // Check entry freshness (within 7 seconds)
    if (Date.now() - entry.createdTimestamp > 7000) return null;

    if (targetId && entry.target && entry.target.id !== targetId) {
      return null;
    }

    return entry.executor;
  } catch (err) {
    console.warn(`[AntiCrash] Audit log fetch failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  registerAntiCrashEvents(client) {
    // 1. Channel Deletion
    client.on('channelDelete', async (channel) => {
      if (!channel.guild) return;
      const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
      if (executor) {
        const snapshot = {
          name: channel.name,
          type: channel.type,
          parentId: channel.parentId,
          position: channel.position
        };
        await registerAction(channel.guild, executor, 'channelDelete', `Удален канал: #${channel.name}`, snapshot);
      }
    });

    // 2. Channel Creation
    client.on('channelCreate', async (channel) => {
      if (!channel.guild) return;
      const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
      if (executor) {
        const snapshot = { channelId: channel.id, name: channel.name };
        await registerAction(channel.guild, executor, 'channelCreate', `Создан канал: #${channel.name}`, snapshot);
      }
    });

    // 3. Role Deletion
    client.on('roleDelete', async (role) => {
      if (!role.guild) return;
      const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
      if (executor) {
        const snapshot = {
          name: role.name,
          color: role.color,
          permissions: role.permissions.bitfield.toString(),
          position: role.position
        };
        await registerAction(role.guild, executor, 'roleDelete', `Удалена роль: @${role.name}`, snapshot);
      }
    });

    // 4. Role Creation
    client.on('roleCreate', async (role) => {
      if (!role.guild) return;
      const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
      if (executor) {
        const snapshot = { roleId: role.id, name: role.name };
        await registerAction(role.guild, executor, 'roleCreate', `Создана роль: @${role.name}`, snapshot);
      }
    });

    // 5. Guild Ban Add
    client.on('guildBanAdd', async (ban) => {
      const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      if (executor) {
        const snapshot = { userId: ban.user.id, userTag: ban.user.tag };
        await registerAction(ban.guild, executor, 'banAdd', `Забанен: ${ban.user.tag}`, snapshot);
      }
    });

    // 6. Member Kick (detected through audit log on member remove)
    client.on('guildMemberRemove', async (member) => {
      if (!member.guild) return;
      const executor = await getAuditExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
      if (executor) {
        const snapshot = { userId: member.id, userTag: member.user.tag };
        await registerAction(member.guild, executor, 'memberKick', `Кикнут: ${member.user.tag}`, snapshot);
      }
    });

    // 7. Webhook Update
    client.on('webhookUpdate', async (channel) => {
      if (!channel.guild) return;
      const executor = await getAuditExecutor(channel.guild, AuditLogEvent.WebhookCreate);
      if (executor) {
        await registerAction(channel.guild, executor, 'webhookCreate', `Создан вебхук в #${channel.name}`);
      }
    });

    console.log('[AntiCrash] Registered all real-time anti-crash event monitors.');
  }
};
