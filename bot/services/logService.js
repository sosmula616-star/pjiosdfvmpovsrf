const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

// Color map for each log category
const CATEGORY_COLORS = {
  anticrash: 0xFF0033,       // Bright Red
  moderation: 0xF39C12,      // Gold / Orange
  messages: 0x3498DB,        // Blue
  members: 0x9B59B6,         // Purple
  channels_roles: 0x1ABC9C,  // Cyan / Teal
  voice: 0xE67E22            // Deep Orange
};

const CATEGORY_ICONS = {
  anticrash: '🚨',
  moderation: '🔨',
  messages: '💬',
  members: '👥',
  channels_roles: '🛠️',
  voice: '🎙️'
};

const CATEGORY_CHANNELS_MAP = {
  anticrash: 'antiCrash',
  moderation: 'moderation',
  messages: 'messages',
  members: 'members',
  channels_roles: 'channelsRoles',
  voice: 'voice'
};

/**
 * Send log entry to Discord log channel & save to Web Dashboard DB
 */
async function sendLog(guild, { category, action, title, description, executor, target, fields = [], color }) {
  if (!guild) return null;

  // 1. Save in internal database for the web dashboard
  const logItem = db.addLog(
    guild.id,
    category,
    action,
    title,
    description,
    executor,
    target,
    fields
  );

  // 2. Dispatch to Discord channel
  try {
    const settings = db.getGuildSettings(guild.id);
    const channelKey = CATEGORY_CHANNELS_MAP[category];
    let channelId = settings.logChannels ? settings.logChannels[channelKey] : null;

    let targetChannel = null;
    if (channelId) {
      targetChannel = guild.channels.cache.get(channelId);
    }

    // Fallback: search by name in cache
    if (!targetChannel) {
      const searchTerms = {
        anticrash: ['логи-антикраш', 'anticrash', 'anti-crash'],
        moderation: ['логи-модерации', 'mod-logs', 'moderation-logs'],
        messages: ['логи-сообщений', 'message-logs', 'msg-logs'],
        members: ['логи-участников', 'member-logs', 'user-logs'],
        channels_roles: ['логи-каналов-ролей', 'channel-logs', 'role-logs'],
        voice: ['логи-голосовых', 'voice-logs']
      };

      const terms = searchTerms[category] || [];
      targetChannel = guild.channels.cache.find(ch => 
        terms.some(t => ch.name.toLowerCase().includes(t))
      );

      // If found by name, save ID for future fast lookup
      if (targetChannel && channelKey) {
        db.updateGuildSettings(guild.id, {
          logChannels: {
            ...settings.logChannels,
            [channelKey]: targetChannel.id
          }
        });
      }
    }

    if (targetChannel && targetChannel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(color || CATEGORY_COLORS[category] || 0x5865F2)
        .setTitle(`${CATEGORY_ICONS[category] || '📋'} [${category.toUpperCase()}] ${title}`)
        .setDescription(description || 'Детали события:')
        .setTimestamp();

      if (executor) {
        embed.addFields({ name: '👤 Инициатор', value: `${executor.tag || executor.username} (\`${executor.id}\`)`, inline: true });
      }
      if (target) {
        embed.addFields({ name: '🎯 Цель / Объект', value: `${target.tag || target.name || target.username || target.id} (\`${target.id}\`)`, inline: true });
      }
      if (fields && fields.length > 0) {
        embed.addFields(fields);
      }

      embed.setFooter({ text: `Musicium Staff Logs • ID: ${logItem.id}` });

      await targetChannel.send({ embeds: [embed] }).catch(err => {
        console.warn(`[LogService] Could not send embed to channel ${targetChannel.name}: ${err.message}`);
      });
    }
  } catch (err) {
    console.error(`[LogService] Error sending log:`, err.message);
  }

  return logItem;
}

module.exports = {
  sendLog,
  CATEGORY_COLORS,
  CATEGORY_ICONS
};
