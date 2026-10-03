const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { parseDuration } = require('../../utils/timeParser');
const { banUser } = require('../services/modService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Заблокировать пользователя (на время или навсегда)')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('Пользователь для блокировки')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('duration')
        .setDescription('Срок бана (например: 10m, 2h, 1d, 7d, 30d, perm)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Причина блокировки')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const durationInput = interaction.options.getString('duration') || 'perm';
    const reason = interaction.options.getString('reason') || 'Нарушение правил сервера';

    // Hierarchy check
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (targetMember) {
      if (targetMember.id === interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Нельзя забанить владельца сервера!', ephemeral: true });
      }
      if (targetMember.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Вы не можете забанить пользователя с ролью равной или выше вашей!', ephemeral: true });
      }
      if (!targetMember.bannable) {
        return interaction.reply({ content: '❌ Бот не может забанить этого пользователя (роль бота ниже роли пользователя)!', ephemeral: true });
      }
    }

    const durationMs = parseDuration(durationInput);

    await interaction.deferReply();
    try {
      const result = await banUser(interaction.guild, targetUser, interaction.user, durationMs, reason);

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🔨 Пользователь заблокирован')
        .addFields(
          { name: '👤 Нарушитель', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
          { name: '🛡️ Модератор', value: `${interaction.user.tag}`, inline: true },
          { name: '⏳ Срок', value: result.durationText, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: `❌ Ошибка при блокировке: ${err.message}` });
    }
  }
};
