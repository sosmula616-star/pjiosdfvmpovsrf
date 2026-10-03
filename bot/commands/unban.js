const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { unbanUser } = require('../services/modService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Разблокировать пользователя по ID')
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('ID заблокированного пользователя')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Причина разблокировки')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const userId = interaction.options.getString('userid').trim();
    const reason = interaction.options.getString('reason') || 'Снятие блокировки модератором';

    await interaction.deferReply();
    try {
      await unbanUser(interaction.guild, userId, interaction.user, reason);

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Пользователь разблокирован')
        .addFields(
          { name: '🆔 User ID', value: `\`${userId}\``, inline: true },
          { name: '🛡️ Модератор', value: `${interaction.user.tag}`, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Не удалось разбанить пользователя (\`${userId}\`). Проверьте, забанен ли он: ${err.message}` });
    }
  }
};
