const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const { formatSecondsToTime } = require('../../utils/timeParser');

/**
 * Creates visual text progress bar
 */
function createProgressBar(percent, length = 12) {
  const filledLength = Math.round((percent / 100) * length);
  const emptyLength = length - filledLength;
  return '▰'.repeat(Math.max(0, filledLength)) + '▱'.repeat(Math.max(0, emptyLength));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Посмотреть профиль участника (уровень, время в войсе, опыт и значки)')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('Пользователь для просмотра')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target') || interaction.user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    const profile = db.getProfile(
      interaction.guild.id,
      targetUser.id,
      targetUser.tag,
      targetUser.displayAvatarURL({ dynamic: true })
    );

    const bar = createProgressBar(profile.progressPercent, 12);
    const voiceTimeFormatted = formatSecondsToTime(profile.voiceTimeSeconds);

    const embed = new EmbedBuilder()
      .setColor(targetMember?.displayHexColor && targetMember.displayHexColor !== '#000000' ? targetMember.displayHexColor : 0x9333EA)
      .setAuthor({
        name: `Профиль участника: ${targetUser.username}`,
        iconURL: targetUser.displayAvatarURL({ dynamic: true })
      })
      .setTitle(`🌟 Уровень ${profile.level} • ${profile.customTitle || 'Слушатель'}`)
      .setDescription(
        `> *${profile.bio || 'Участник музыкального сообщества Musicium.'}*\n\n` +
        `**Прогресс уровня:**\n` +
        `${bar} **${profile.progressPercent}%** (\`${profile.xp}\` / \`${profile.nextLevelXp}\` XP)`
      )
      .addFields(
        {
          name: '🎙️ Время в голосовых',
          value: `\`${voiceTimeFormatted}\``,
          inline: true
        },
        {
          name: '💬 Сообщений',
          value: `\`${profile.messages}\``,
          inline: true
        },
        {
          name: '⚡ Всего XP',
          value: `\`${profile.xp}\``,
          inline: true
        },
        {
          name: '🏅 Достижения & Значки',
          value: profile.badges && profile.badges.length > 0 ? profile.badges.join(' • ') : '—',
          inline: false
        }
      )
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
      .setImage(profile.bannerUrl)
      .setFooter({ text: 'Настроить баннер профиля можно через /setprofile или Веб-панель' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
};
