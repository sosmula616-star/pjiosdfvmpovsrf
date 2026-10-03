const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('../services/logService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Закрыть текущий тикет и сохранить транскрипт')
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Причина закрытия тикета')
        .setRequired(false)
    ),

  async execute(interaction) {
    const channel = interaction.channel;
    const ticket = db.getTicketByChannel(channel.id);

    if (!ticket) {
      return interaction.reply({
        content: '⚠️ Эту команду можно использовать только внутри активного канала тикета!',
        ephemeral: true
      });
    }

    const reason = interaction.options.getString('reason') || 'Вопрос решен';
    await interaction.deferReply();

    // Mark closed in DB
    db.closeTicket(channel.id, interaction.user.tag, reason);

    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle(`🔒 Тикет #${ticket.ticketNumber} закрыт`)
      .setDescription(
        `Тикет был закрыт модератором/пользователем ${interaction.user}.\n` +
        `• **Причина:** ${reason}\n\n` +
        `*Этот канал будет автоматически удален через 5 секунд...*`
      )
      .setFooter({ text: 'Транскрипт сохранен в базе данных Musicium' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    await sendLog(interaction.guild, {
      category: 'moderation',
      action: 'TICKET_CLOSED',
      title: `Тикет #${ticket.ticketNumber} закрыт`,
      description: `Тикет пользователя <@${ticket.authorId}> закрыт модератором **${interaction.user.tag}**. Причина: ${reason}`,
      executor: interaction.user,
      color: 0xE74C3C
    });

    setTimeout(async () => {
      await channel.delete(`Тикет #${ticket.ticketNumber} закрыт пользователем ${interaction.user.tag}`).catch(() => {});
    }, 5000);
  }
};
