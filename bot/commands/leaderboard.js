const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const { formatSecondsToTime } = require('../../utils/timeParser');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Таблица лидеров сервера по уровню, голосовой активности или сообщениям')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Критерий сортировки топа')
        .setRequired(false)
        .addChoices(
          { name: '⚡ По уровню и опыту (XP)', value: 'xp' },
          { name: '🎙️ По времени в голосовых каналах', value: 'voice' },
          { name: '💬 По количеству сообщений', value: 'messages' }
        )
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type') || 'xp';
    const top = db.getLeaderboard(interaction.guild.id, type, 10);

    const typeNames = {
      xp: '⚡ Топ по уровню & опыту (XP)',
      voice: '🎙️ Топ по голосовой активности',
      messages: '💬 Топ по сообщениям'
    };

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    const embed = new EmbedBuilder()
      .setColor(0x06B6D4)
      .setTitle(`🏆 ${typeNames[type]}`)
      .setDescription(
        top.length === 0
          ? 'Пока нет данных об активности на этом сервере. Общайтесь в чатах и слушайте музыку в войсе!'
          : top.map((p, i) => {
              const medal = medals[i] || `#${i + 1}`;
              if (type === 'voice') {
                return `${medal} **${p.userTag || p.userId}** — \`${formatSecondsToTime(p.voiceTimeSeconds)}\` (Ур. ${p.level})`;
              }
              if (type === 'messages') {
                return `${medal} **${p.userTag || p.userId}** — \`${p.messages}\` сообщ. (Ур. ${p.level})`;
              }
              return `${medal} **${p.userTag || p.userId}** — **Уровень ${p.level}** (\`${p.xp}\` XP)`;
            }).join('\n\n')
      )
      .setFooter({ text: 'Musicium Leaderboard • Полный рейтинг доступен в Веб-панели' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
};
