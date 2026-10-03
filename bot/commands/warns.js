const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const { formatTimestamp } = require('../../utils/timeParser');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warns')
    .setDescription('Посмотреть историю предупреждений пользователя')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('Пользователь для проверки варнов')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const warns = db.getWarns(interaction.guild.id, targetUser.id);

    const embed = new EmbedBuilder()
      .setColor(warns.length > 0 ? 0xF1C40F : 0x2ECC71)
      .setTitle(`📋 История предупреждений: ${targetUser.tag}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .setDescription(
        warns.length === 0
          ? '✅ У данного пользователя нет активных предупреждений.'
          : `Всего предупреждений: **${warns.length}**`
      );

    if (warns.length > 0) {
      // Show up to 10 latest warns
      warns.slice(0, 10).forEach((w, index) => {
        embed.addFields({
          name: `#${index + 1} | ID: \`${w.id}\``,
          value: `**Причина:** ${w.reason}\n**Модератор:** ${w.modTag || w.modId}\n**Дата:** ${formatTimestamp(w.timestamp)}`
        });
      });
      if (warns.length > 10) {
        embed.setFooter({ text: `И ещё ${warns.length - 10} варнов. Полный список доступен в Веб-панели!` });
      }
    }

    embed.setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }
};
