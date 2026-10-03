const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

module.exports = {
  registerProfileEvents(client) {
    // 1. Message activity & XP tracker
    client.on('messageCreate', async (message) => {
      if (!message.guild || message.author.bot) return;

      // Record message in ticket transcript if sent inside an open ticket
      db.addTicketMessage(message.channel.id, message.author.tag, message.content);

      const { profile, leveledUp, newLevel } = db.addMessageActivity(
        message.guild.id,
        message.author.id,
        message.author.tag,
        message.author.displayAvatarURL()
      );

      // Level up announcement
      if (leveledUp) {
        try {
          const levelEmbed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🎉 Повышение уровня!')
            .setDescription(`Поздравляем, <@${message.author.id}>! Вы достигли **Уровня ${newLevel}**!`)
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: '⚡ Всего опыта (XP)', value: `\`${profile.xp}\``, inline: true },
              { name: '🎖️ Титул', value: `\`${profile.customTitle || 'Слушатель'}\``, inline: true }
            )
            .setFooter({ text: 'Musicium Community • /profile для просмотра' })
            .setTimestamp();

          await message.channel.send({ embeds: [levelEmbed] }).catch(() => {});
        } catch (e) {}
      }
    });

    // 2. Voice State Tracking
    client.on('voiceStateUpdate', async (oldState, newState) => {
      const member = newState.member || oldState.member;
      if (!member || member.user.bot) return;

      const guildId = (newState.guild || oldState.guild).id;

      // User joins voice
      if (!oldState.channelId && newState.channelId) {
        db.startVoiceSession(guildId, member.id);
      }
      // User leaves voice
      else if (oldState.channelId && !newState.channelId) {
        db.endVoiceSession(guildId, member.id);
      }
    });

    // 3. Periodic voice heartbeat every 60 seconds
    setInterval(() => {
      client.guilds.cache.forEach(guild => {
        guild.voiceStates.cache.forEach(vs => {
          if (vs.channelId && vs.member && !vs.member.user.bot && !vs.serverMute && !vs.selfMute) {
            db.addVoiceSeconds(guild.id, vs.member.id, 60);
          }
        });
      });
    }, 60000);

    console.log('[Profiles] Registered message and voice activity profile listeners.');
  }
};
