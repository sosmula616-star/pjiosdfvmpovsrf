const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { unmuteUser } = require('../services/modService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять мут с пользователя')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('Пользователь для снятия мута')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Тип снимаемого мута')
        .setRequired(false)
        .addChoices(
          { name: '💬 Текстовый (Тайм-аут)', value: 'text' },
          { name: '🎙️ Голосовой (Voice Mute)', value: 'voice' },
          { name: '🔄 Все типы', value: 'all' }
        )
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Причина снятия мута')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const type = interaction.options.getString('type') || 'all';
    const reason = interaction.options.getString('reason') || 'Досрочное снятие наказания';

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: '❌ Участник не найден на сервере!', ephemeral: true });
    }

    await interaction.deferReply();
    try {
      if (type === 'all' || type === 'text') {
        await unmuteUser(interaction.guild, targetMember, interaction.user, 'text', reason);
      }
      if (type === 'all' || type === 'voice') {
        await unmuteUser(interaction.guild, targetMember, interaction.user, 'voice', reason);
      }

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔊 Мут успешно снят')
        .addFields(
          { name: '👤 Пользователь', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
          { name: '🛡️ Модератор', value: `${interaction.user.tag}`, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Ошибка при снятии мута: ${err.message}` });
    }
  }
};
