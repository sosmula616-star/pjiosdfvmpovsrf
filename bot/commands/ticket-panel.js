const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Отправить интерактивную панель создания тикетов и баг-репортов в этот канал')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎫 ЦЕНТР ПОДДЕРЖКИ & БАГ-РЕПОРТОВ MUSICIUM')
      .setDescription(
        `Нужна помощь по боту, хотите задать вопрос администрации или нашли баг?\n` +
        `Выберите нужную категорию ниже, нажав на соответствующую кнопку:\n\n` +
        `• **📩 Техническая поддержка** — вопросы по настройке бота, музыке, правам и премиуму.\n` +
        `• **🐛 Сообщить о баге (Баг-репорт)** — ошибка в воспроизведении, вылет или сбой команды.\n` +
        `• **❓ Вопрос администрации** — жалобы, предложения и сотрудничество.\n\n` +
        `*После нажатия откроется форма с подробностями и будет создан ваш персональный приватный канал обращения!*`
      )
      .setImage('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80')
      .setFooter({ text: 'Musicium Staff • Служба заботы о пользователях' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_ticket_support')
        .setLabel('Техподдержка')
        .setEmoji('📩')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('btn_ticket_bug')
        .setLabel('Сообщить о баге')
        .setEmoji('🐛')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('btn_ticket_question')
        .setLabel('Вопрос администрации')
        .setEmoji('❓')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Панель тикетов и баг-репортов успешно опубликована в этом канале!', ephemeral: true });
  }
};
