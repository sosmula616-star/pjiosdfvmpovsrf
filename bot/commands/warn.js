const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { warnUser } = require('../services/modService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Выдать официальное предупреждение пользователю')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('Пользователь для предупреждения')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Причина предупреждения')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason');

    if (targetUser.id === interaction.guild.ownerId) {
      return interaction.reply({ content: '❌ Нельзя выдать варн владельцу сервера!', ephemeral: true });
    }
    if (targetUser.bot) {
      return interaction.reply({ content: '❌ Нельзя выдавать варны ботам!', ephemeral: true });
    }

    await interaction.deferReply();
    try {
      const result = await warnUser(interaction.guild, targetUser, interaction.user, reason);

      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('⚠️ Предупреждение выдано')
        .addFields(
          { name: '👤 Нарушитель', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
          { name: '🛡️ Модератор', value: `${interaction.user.tag}`, inline: true },
          { name: '📊 Всего варнов', value: `\`${result.totalWarns}\``, inline: true },
          { name: '📝 Причина', value: reason, inline: false },
          { name: '🆔 ID варна', value: `\`${result.warn.id}\``, inline: false }
        )
        .setFooter({ text: 'Просмотреть все варны пользователя: /warns' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Ошибка при выдаче варна: ${err.message}` });
    }
  }
};
