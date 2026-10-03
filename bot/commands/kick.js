const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { sendLog } = require('../services/logService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Исключить пользователя с сервера')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('Пользователь для исключения')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Причина исключения')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason') || 'Нарушение правил сервера';

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: '❌ Пользователь не найден на сервере!', ephemeral: true });
    }

    if (targetMember.id === interaction.guild.ownerId) {
      return interaction.reply({ content: '❌ Нельзя кикнуть создателя сервера!', ephemeral: true });
    }

    if (targetMember.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: '❌ Вы не можете кикнуть пользователя с ролью равной или выше вашей!', ephemeral: true });
    }

    if (!targetMember.kickable) {
      return interaction.reply({ content: '❌ Бот не имеет прав исключить данного участника (роль бота ниже роли участника)!', ephemeral: true });
    }

    await interaction.deferReply();
    try {
      // DM user
      try {
        const dm = new EmbedBuilder()
          .setColor(0xE67E22)
          .setTitle(`👢 Вы были исключены с сервера ${interaction.guild.name}`)
          .addFields(
            { name: 'Причина', value: reason },
            { name: 'Модератор', value: interaction.user.tag }
          )
          .setTimestamp();
        await targetUser.send({ embeds: [dm] }).catch(() => {});
      } catch (e) {}

      await targetMember.kick(`[Kick] ${reason} | Модератор: ${interaction.user.tag}`);

      await sendLog(interaction.guild, {
        category: 'moderation',
        action: 'KICK',
        title: 'Исключение участника (Кик)',
        description: 'Пользователь был кикнут с сервера.',
        executor: interaction.user,
        target: targetUser,
        fields: [
          { name: 'Причина', value: reason, inline: false }
        ],
        color: 0xE67E22
      });

      const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('👢 Участник исключен')
        .addFields(
          { name: '👤 Пользователь', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
          { name: '🛡️ Модератор', value: `${interaction.user.tag}`, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Ошибка при исключении: ${err.message}` });
    }
  }
};
