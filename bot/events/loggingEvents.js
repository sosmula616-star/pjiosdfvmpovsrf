const { AuditLogEvent } = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('../services/logService');

module.exports = {
  registerLoggingEvents(client) {
    // ----------------------------------------------------
    // 1. MESSAGES LOGS
    // ----------------------------------------------------
    client.on('messageDelete', async (message) => {
      if (!message.guild || message.author?.bot) return;

      await sendLog(message.guild, {
        category: 'messages',
        action: 'MESSAGE_DELETE',
        title: 'Удалено сообщение',
        description: `Сообщение удалено в канале <#${message.channelId}>`,
        target: message.author,
        fields: [
          { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
          { name: 'Текст сообщения', value: message.content ? (message.content.length > 1000 ? message.content.slice(0, 1000) + '...' : message.content) : '*(Сообщение без текста или вложение)*', inline: false }
        ]
      });
    });

    client.on('messageUpdate', async (oldMsg, newMsg) => {
      if (!oldMsg.guild || oldMsg.author?.bot) return;
      if (oldMsg.content === newMsg.content) return; // embeds or pins only

      await sendLog(oldMsg.guild, {
        category: 'messages',
        action: 'MESSAGE_EDIT',
        title: 'Отредактировано сообщение',
        description: `Сообщение изменено в <#${oldMsg.channelId}>: [Перейти](${newMsg.url})`,
        target: oldMsg.author,
        fields: [
          { name: 'До изменения', value: oldMsg.content ? (oldMsg.content.length > 500 ? oldMsg.content.slice(0, 500) + '...' : oldMsg.content) : '*(Пусто)*', inline: false },
          { name: 'После изменения', value: newMsg.content ? (newMsg.content.length > 500 ? newMsg.content.slice(0, 500) + '...' : newMsg.content) : '*(Пусто)*', inline: false }
        ]
      });
    });

    // ----------------------------------------------------
    // 2. MEMBERS LOGS
    // ----------------------------------------------------
    client.on('guildMemberAdd', async (member) => {
      await sendLog(member.guild, {
        category: 'members',
        action: 'MEMBER_JOIN',
        title: 'Новый участник на сервере',
        description: `Пользователь присоединился к серверу.`,
        target: member.user,
        fields: [
          { name: 'Дата регистрации', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Всего участников', value: `${member.guild.memberCount}`, inline: true }
        ],
        color: 0x2ECC71
      });
    });

    client.on('guildMemberRemove', async (member) => {
      await sendLog(member.guild, {
        category: 'members',
        action: 'MEMBER_LEAVE',
        title: 'Участник покинул сервер',
        description: `Пользователь вышел или был исключен.`,
        target: member.user,
        fields: [
          { name: 'Осталось участников', value: `${member.guild.memberCount}`, inline: true }
        ],
        color: 0x95A5A6
      });
    });

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
      // Role changes
      const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
      const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

      if (addedRoles.size > 0 || removedRoles.size > 0) {
        const fields = [];
        if (addedRoles.size > 0) {
          fields.push({ name: 'Добавлены роли', value: addedRoles.map(r => `@${r.name}`).join(', '), inline: false });
        }
        if (removedRoles.size > 0) {
          fields.push({ name: 'Сняты роли', value: removedRoles.map(r => `@${r.name}`).join(', '), inline: false });
        }

        await sendLog(newMember.guild, {
          category: 'members',
          action: 'MEMBER_ROLES_CHANGE',
          title: 'Изменение ролей участника',
          description: `Обновлен список ролей для ${newMember.user.tag}`,
          target: newMember.user,
          fields
        });
      }
    });

    // ----------------------------------------------------
    // 3. CHANNELS & ROLES LOGS
    // ----------------------------------------------------
    client.on('channelCreate', async (channel) => {
      if (!channel.guild) return;
      await sendLog(channel.guild, {
        category: 'channels_roles',
        action: 'CHANNEL_CREATE',
        title: 'Создан канал',
        description: `Создан канал **#${channel.name}** (\`${channel.id}\`)`,
        fields: [
          { name: 'Тип канала', value: `${channel.type}`, inline: true },
          { name: 'Категория', value: channel.parent ? channel.parent.name : 'Без категории', inline: true }
        ]
      });
    });

    client.on('channelDelete', async (channel) => {
      if (!channel.guild) return;
      await sendLog(channel.guild, {
        category: 'channels_roles',
        action: 'CHANNEL_DELETE',
        title: 'Удален канал',
        description: `Канал **#${channel.name}** (\`${channel.id}\`) был удален.`,
        color: 0xE74C3C
      });
    });

    client.on('roleCreate', async (role) => {
      await sendLog(role.guild, {
        category: 'channels_roles',
        action: 'ROLE_CREATE',
        title: 'Создана роль',
        description: `Создана новая роль **@${role.name}** (\`${role.id}\`)`,
        color: 0x1ABC9C
      });
    });

    client.on('roleDelete', async (role) => {
      await sendLog(role.guild, {
        category: 'channels_roles',
        action: 'ROLE_DELETE',
        title: 'Удалена роль',
        description: `Роль **@${role.name}** (\`${role.id}\`) была удалена.`,
        color: 0xE74C3C
      });
    });

    // ----------------------------------------------------
    // 4. VOICE LOGS & VOICE MUTE ENFORCEMENT
    // ----------------------------------------------------
    client.on('voiceStateUpdate', async (oldState, newState) => {
      const member = newState.member || oldState.member;
      if (!member || member.user.bot) return;
      const guild = newState.guild;

      // Voice Mute Persistence Check: if member is actively voice-muted in DB, mute them when they enter voice!
      if (newState.channelId) {
        const isMuted = db.isVoiceMuted(guild.id, member.id);
        if (isMuted && !newState.serverMute) {
          await newState.setMute(true, 'Действующий голосовой мут').catch(() => {});
        }
      }

      // Voice Channel Join
      if (!oldState.channelId && newState.channelId) {
        await sendLog(guild, {
          category: 'voice',
          action: 'VOICE_JOIN',
          title: 'Вход в голосовой канал',
          description: `Участник вошел в голосовой канал`,
          target: member.user,
          fields: [
            { name: 'Канал', value: `🔊 **${newState.channel.name}**`, inline: true }
          ]
        });
      }
      // Voice Channel Leave
      else if (oldState.channelId && !newState.channelId) {
        await sendLog(guild, {
          category: 'voice',
          action: 'VOICE_LEAVE',
          title: 'Выход из голосового канала',
          description: `Участник покинул голосовой канал`,
          target: member.user,
          fields: [
            { name: 'Канал', value: `🔊 **${oldState.channel.name}**`, inline: true }
          ]
        });
      }
      // Voice Channel Move
      else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        await sendLog(guild, {
          category: 'voice',
          action: 'VOICE_MOVE',
          title: 'Перемещение в голосовых каналах',
          description: `Участник сменил голосовой канал`,
          target: member.user,
          fields: [
            { name: 'Из канала', value: `🔊 **${oldState.channel.name}**`, inline: true },
            { name: 'В канал', value: `🔊 **${newState.channel.name}**`, inline: true }
          ]
        });
      }
      // Server Mute / Deafen toggle
      else if (oldState.serverMute !== newState.serverMute || oldState.serverDeaf !== newState.serverDeaf) {
        const actions = [];
        if (oldState.serverMute !== newState.serverMute) {
          actions.push(newState.serverMute ? 'Серверный мут включен' : 'Серверный мут выключен');
        }
        if (oldState.serverDeaf !== newState.serverDeaf) {
          actions.push(newState.serverDeaf ? 'Серверный заглуш включен' : 'Серверный заглуш выключен');
        }

        await sendLog(guild, {
          category: 'voice',
          action: 'VOICE_MOD_STATE',
          title: 'Изменение голосового статуса',
          description: actions.join(', '),
          target: member.user,
          fields: [
            { name: 'Канал', value: `🔊 **${newState.channel?.name || 'Вне канала'}**`, inline: true }
          ]
        });
      }
    });

    console.log('[Logging] Registered all 6 audit log category event handlers.');
  }
};
