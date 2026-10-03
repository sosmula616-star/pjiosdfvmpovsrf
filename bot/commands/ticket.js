const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('../services/logService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Создать приватный тикет обращения к поддержке')
    .addStringOption(option =>
      option.setName('category')
        .setDescription('Тематика обращения')
        .setRequired(true)
        .addChoices(
          { name: '📩 Техподдержка (помощь по боту)', value: 'support' },
          { name: '🐛 Сообщить об ошибке / Баг-репорт', value: 'bug' },
          { name: '❓ Вопрос или жалоба', value: 'question' }
        )
    )
    .addStringOption(option =>
      option.setName('subject')
        .setDescription('Краткая тема или описание проблемы')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    const user = interaction.user;
    const category = interaction.options.getString('category');
    const subject = interaction.options.getString('subject') || 'Обращение в поддержку';

    // Check if user already has an open ticket
    const openTickets = db.getTickets(guild.id, 'open').filter(t => t.authorId === user.id);
    if (openTickets.length >= 3) {
      return interaction.reply({
        content: '⚠️ У вас уже есть 3 активных открытых тикета! Пожалуйста, дождитесь ответа персонала или закройте предыдущие обращения.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Find or create ticket category
      let ticketCat = guild.channels.cache.find(c => 
        c.type === ChannelType.GuildCategory && 
        (c.name.toLowerCase().includes('тикет') || c.name.toLowerCase().includes('ticket') || c.name.toLowerCase().includes('поддержк'))
      );

      // Find staff roles
      const adminRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('админ') || r.name.toLowerCase().includes('admin'));
      const modRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('модератор') || r.name.toLowerCase().includes('moderator'));

      const cleanUserName = user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 15) || 'user';
      const channelName = `🎫│${category === 'bug' ? 'баг' : 'тикет'}-${cleanUserName}`;

      const overwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ReadMessageHistory
          ]
        }
      ];

      if (adminRole) {
        overwrites.push({
          id: adminRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }
      if (modRole) {
        overwrites.push({
          id: modRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }

      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: ticketCat ? ticketCat.id : null,
        permissionOverwrites: overwrites,
        topic: `Тикет пользователя ${user.tag} (ID: ${user.id}) | Категория: ${category}`
      });

      // Save ticket in DB
      const ticketRecord = db.createTicket(guild.id, ticketChannel.id, user, category, subject);

      // Send welcome message in ticket channel
      const welcomeEmbed = new EmbedBuilder()
        .setColor(category === 'bug' ? 0xE74C3C : 0x5865F2)
        .setTitle(`🎫 Тикет #${ticketRecord.ticketNumber}: ${subject}`)
        .setDescription(
          `Здравствуйте, ${user}!\n\n` +
          `Спасибо за обращение в поддержку музыкального сообщества **Musicium**.\n` +
          `Опишите ваш вопрос или проблему как можно подробнее. Наша команда модерации и разработчиков ответит вам в ближайшее время.\n\n` +
          `• **Категория:** \`${category.toUpperCase()}\`\n` +
          `• **Создатель:** ${user} (\`${user.id}\`)\n` +
          `• **Статус:** 🟢 Открыт`
        )
        .setFooter({ text: 'Используйте кнопки ниже для управления тикетом' })
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_ticket_close')
          .setLabel('Закрыть тикет')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('btn_ticket_transcript')
          .setLabel('Транскрипт')
          .setEmoji('📋')
          .setStyle(ButtonStyle.Secondary)
      );

      const staffPing = adminRole ? `<@&${adminRole.id}>` : (modRole ? `<@&${modRole.id}>` : '');
      await ticketChannel.send({
        content: `👋 Приветствуем, ${user}! ${staffPing ? `${staffPing} — новое обращение!` : ''}`,
        embeds: [welcomeEmbed],
        components: [actionRow]
      });

      // Audit Log
      await sendLog(guild, {
        category: 'moderation',
        action: 'TICKET_CREATED',
        title: `Создан тикет #${ticketRecord.ticketNumber}`,
        description: `Пользователь **${user.tag}** открыл обращение в канале ${ticketChannel}`,
        executor: user,
        fields: [
          { name: 'Категория', value: category, inline: true },
          { name: 'Тема', value: subject, inline: true }
        ],
        color: 0x3498DB
      });

      return interaction.editReply({
        content: `✅ Ваш тикет успешно создан: ${ticketChannel}! Перейдите в канал, чтобы продолжить диалог.`
      });
    } catch (err) {
      console.error('[Ticket Command Error]', err);
      return interaction.editReply({ content: `❌ Ошибка создания тикета: ${err.message}` });
    }
  }
};
