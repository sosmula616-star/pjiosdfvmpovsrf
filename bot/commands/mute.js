const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { parseDuration } = require('../../utils/timeParser');
const { muteUser } = require('../services/modService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Замутить пользователя (текстовый тайм-аут или голосовой мут)')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('Пользователь для выдачи мута')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Тип мута')
        .setRequired(true)
        .addChoices(
          { name: '💬 Текстовый (Тайм-аут)', value: 'text' },
          { name: '🎙️ Голосовой (Voice Mute)', value: 'voice' }
        )
    )
    .addStringOption(opt =>
      opt.setName('duration')
        .setDescription('Срок мута (например: 10m, 1h, 1d, 7d, 28d)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Причина мута')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const type = interaction.options.getString('type');
    const durationInput = interaction.options.getString('duration') || '1h';
    const reason = interaction.options.getString('reason') || 'Нарушение правил общения';

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на этом сервере!', ephemeral: true });
    }

    if (targetMember.id === interaction.guild.ownerId) {
      return interaction.reply({ content: '❌ Нельзя замутить владельца сервера!', ephemeral: true });
    }

    if (targetMember.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: '❌ Вы не можете замутить пользователя с ролью равной или выше вашей!', ephemeral: true });
    }

    const durationMs = parseDuration(durationInput);

    await interaction.deferReply();
    try {
      const result = await muteUser(interaction.guild, targetMember, interaction.user, type, durationMs, reason);

      const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle(`🔇 Выдан ${type === 'voice' ? 'голосовой' : 'текстовый'} мут`)
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
      return interaction.editReply({ content: `❌ Ошибка при выдаче мута: ${err.message}` });
    }
  }
};
