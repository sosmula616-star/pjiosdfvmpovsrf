const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('../services/logService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription('Удалить конкретный варн или очистить все варны пользователя')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('Пользователь')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('warn_id')
        .setDescription('ID конкретного варна (если не указано — удалятся все)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const warnId = interaction.options.getString('warn_id');

    if (warnId) {
      const removed = db.removeWarn(warnId.trim());
      if (!removed) {
        return interaction.reply({ content: `❌ Предупреждение с ID \`${warnId}\` не найдено!`, ephemeral: true });
      }

      await sendLog(interaction.guild, {
        category: 'moderation',
        action: 'WARN_DELETE',
        title: 'Удалено предупреждение',
        description: `Модератор удалил варн \`${warnId}\``,
        executor: interaction.user,
        target: targetUser,
        color: 0x2ECC71
      });

      return interaction.reply({ content: `✅ Предупреждение \`${warnId}\` для пользователя ${targetUser.tag} успешно удалено.` });
    } else {
      const count = db.clearUserWarns(interaction.guild.id, targetUser.id);

      await sendLog(interaction.guild, {
        category: 'moderation',
        action: 'WARN_CLEAR_ALL',
        title: 'Очищены все предупреждения',
        description: `Сняты все предупреждения с пользователя. Удалено варнов: ${count}`,
        executor: interaction.user,
        target: targetUser,
        color: 0x2ECC71
      });

      return interaction.reply({ content: `✅ Все предупреждения (${count} шт.) пользователя ${targetUser.tag} успешно очищены.` });
    }
  }
};
