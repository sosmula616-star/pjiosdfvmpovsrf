const { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelType, 
  PermissionFlagsBits, 
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('../services/logService');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    const guild = interaction.guild;

    // ----------------------------------------------------
    // 1. BUTTON INTERACTIONS
    // ----------------------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // 1.1. Verification Button
      if (customId === 'verify_member') {
        const member = interaction.member;
        const settings = db.getGuildSettings(guild.id);
        let verifiedRoleId = settings.specialRoles?.verifiedRoleId;

        let role = verifiedRoleId ? guild.roles.cache.get(verifiedRoleId) : null;
        if (!role) {
          role = guild.roles.cache.find(r => r.name.toLowerCase().includes('слушатель') || r.name.toLowerCase().includes('verified'));
        }

        if (!role) {
          return interaction.reply({
            content: '❌ Роль верификации не найдена на сервере! Обратитесь к администрации.',
            ephemeral: true
          });
        }

        if (member.roles.cache.has(role.id)) {
          return interaction.reply({
            content: 'ℹ️ Вы уже прошли верификацию ранее!',
            ephemeral: true
          });
        }

        try {
          await member.roles.add(role, 'Успешная верификация через кнопку');

          await sendLog(guild, {
            category: 'members',
            action: 'MEMBER_VERIFIED',
            title: 'Участник прошел верификацию',
            description: `Пользователь получил роль @${role.name} и доступ к каналам сообщества`,
            target: member.user,
            color: 0x2ECC71
          });

          return interaction.reply({
            content: `🎉 **Верификация успешно пройдена!**\nВам выдана роль **@${role.name}**. Все каналы сообщества Musicium теперь открыты для вас. Приятного общения и прослушивания музыки!`,
            ephemeral: true
          });
        } catch (err) {
          return interaction.reply({
            content: `❌ Не удалось выдать роль верификации (проверьте права бота): ${err.message}`,
            ephemeral: true
          });
        }
      }

      // 1.2. Ticket Panel: Open Support Ticket Modal
      if (customId === 'btn_ticket_support') {
        const modal = new ModalBuilder()
          .setCustomId('modal_ticket_support')
          .setTitle('📩 Обращение в техподдержку');

        const subjectInput = new TextInputBuilder()
          .setCustomId('ticket_subject')
          .setLabel('Тема обращения')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Например: Вопрос по правам бота или настройке')
          .setRequired(true)
          .setMaxLength(100);

        const descInput = new TextInputBuilder()
          .setCustomId('ticket_desc')
          .setLabel('Подробное описание проблемы')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Опишите подробно, с чем вам требуется помощь...')
          .setRequired(true)
          .setMaxLength(1000);

        modal.addComponents(
          new ActionRowBuilder().addComponents(subjectInput),
          new ActionRowBuilder().addComponents(descInput)
        );

        return interaction.showModal(modal);
      }

      // 1.3. Ticket Panel: Open Bug Report Modal
      if (customId === 'btn_ticket_bug') {
        const modal = new ModalBuilder()
          .setCustomId('modal_ticket_bug')
          .setTitle('🐛 Баг-репорт разработчикам');

        const titleInput = new TextInputBuilder()
          .setCustomId('bug_title')
          .setLabel('Краткая суть бага')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Например: Ошибка при воспроизведении трека по ссылке')
          .setRequired(true)
          .setMaxLength(100);

        const descInput = new TextInputBuilder()
          .setCustomId('bug_desc')
          .setLabel('Что именно произошло?')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Опишите ошибку и текст ошибки, если он был...')
          .setRequired(true)
          .setMaxLength(1000);

        const stepsInput = new TextInputBuilder()
          .setCustomId('bug_steps')
          .setLabel('Шаги воспроизведения (как повторить баг)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('1. Ввел команду...\n2. Выбрал опцию...\n3. Произошло...')
          .setRequired(false)
          .setMaxLength(500);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(stepsInput)
        );

        return interaction.showModal(modal);
      }

      // 1.4. Ticket Panel: Open Question Modal
      if (customId === 'btn_ticket_question') {
        const modal = new ModalBuilder()
          .setCustomId('modal_ticket_question')
          .setTitle('❓ Вопрос администрации');

        const subjectInput = new TextInputBuilder()
          .setCustomId('question_subject')
          .setLabel('Тема вопроса')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Например: Предложение по развитию или жалоба')
          .setRequired(true)
          .setMaxLength(100);

        const descInput = new TextInputBuilder()
          .setCustomId('question_desc')
          .setLabel('Ваше сообщение')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Напишите ваш вопрос или обращение к старшей администрации...')
          .setRequired(true)
          .setMaxLength(1000);

        modal.addComponents(
          new ActionRowBuilder().addComponents(subjectInput),
          new ActionRowBuilder().addComponents(descInput)
        );

        return interaction.showModal(modal);
      }

      // 1.5. Inside Ticket: Close Ticket Button
      if (customId === 'btn_ticket_close') {
        const ticket = db.getTicketByChannel(interaction.channel.id);
        if (!ticket) {
          return interaction.reply({
            content: '⚠️ Этот канал не является активным тикетом в базе данных.',
            ephemeral: true
          });
        }

        db.closeTicket(interaction.channel.id, interaction.user.tag, 'Закрыто по кнопке');

        const embed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle(`🔒 Тикет #${ticket.ticketNumber} закрывается`)
          .setDescription(
            `Обращение закрыто пользователем ${interaction.user}.\n` +
            `Транскрипт сохранен в базе данных PostgreSQL.\n\n` +
            `*Канал будет автоматически удален через 5 секунд...*`
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        await sendLog(guild, {
          category: 'moderation',
          action: 'TICKET_CLOSED',
          title: `Тикет #${ticket.ticketNumber} закрыт`,
          description: `Тикет пользователя <@${ticket.authorId}> закрыт пользователем **${interaction.user.tag}**`,
          executor: interaction.user,
          color: 0xE74C3C
        });

        setTimeout(async () => {
          await interaction.channel.delete('Тикет закрыт').catch(() => {});
        }, 5000);
        return;
      }

      // 1.6. Inside Ticket: Generate Transcript Button
      if (customId === 'btn_ticket_transcript') {
        const ticket = db.getTicketByChannel(interaction.channel.id);
        const transcript = ticket?.transcript || [];

        if (transcript.length === 0) {
          return interaction.reply({
            content: 'ℹ️ В этом тикете пока нет сохраненных сообщений для транскрипта.',
            ephemeral: true
          });
        }

        const lines = transcript.map(m => {
          const t = new Date(m.timestamp).toLocaleTimeString('ru-RU');
          return `[${t}] ${m.author}: ${m.content}`;
        }).join('\n');

        const buffer = Buffer.from(`=== ТРАНСКРИПТ ТИКЕТА #${ticket.ticketNumber} ===\nТема: ${ticket.subject}\nСоздатель: ${ticket.authorTag}\nДата: ${new Date(ticket.createdAt).toLocaleString('ru-RU')}\n\n${lines}`, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: `transcript-ticket-${ticket.ticketNumber}.txt` });

        return interaction.reply({
          content: `📋 **Транскрипт тикета #${ticket.ticketNumber}:** (сообщений: ${transcript.length})`,
          files: [attachment],
          ephemeral: true
        });
      }

      // 1.7. Bug Report Status Buttons: in_progress, fixed, rejected
      if (customId.startsWith('bug_')) {
        const member = interaction.member;
        const isStaff = member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isStaff) {
          return interaction.reply({
            content: '❌ Только модераторы и разработчики могут изменять статус баг-репортов!',
            ephemeral: true
          });
        }

        let newStatus = 'new';
        let statusText = '';
        let newColor = 0xF1C40F;

        let reportId = null;
        if (customId.startsWith('bug_in_progress_')) {
          reportId = customId.replace('bug_in_progress_', '');
          newStatus = 'in_progress';
          statusText = '⚙️ В работе (разработчики решают проблему)';
          newColor = 0x3498DB;
        } else if (customId.startsWith('bug_fixed_')) {
          reportId = customId.replace('bug_fixed_', '');
          newStatus = 'fixed';
          statusText = '✅ Исправлено (патч применен)';
          newColor = 0x2ECC71;
        } else if (customId.startsWith('bug_rejected_')) {
          reportId = customId.replace('bug_rejected_', '');
          newStatus = 'rejected';
          statusText = '❌ Отклонено (не является багом / не воспроизводится)';
          newColor = 0x95A5A6;
        }

        const updated = db.updateBugReportStatus(reportId, newStatus, null, interaction.user.tag);
        if (!updated) {
          return interaction.reply({ content: '⚠️ Баг-репорт не найден в базе данных.', ephemeral: true });
        }

        // Update message embed
        const msg = interaction.message;
        if (msg && msg.embeds.length > 0) {
          const oldEmbed = msg.embeds[0];
          const newEmbed = EmbedBuilder.from(oldEmbed)
            .setColor(newColor)
            .setFields(
              oldEmbed.fields.map(f => f.name === 'Статус' ? { name: 'Статус', value: statusText, inline: true } : f)
            );

          await msg.edit({ embeds: [newEmbed] }).catch(() => {});
        }

        return interaction.reply({
          content: `🔄 Статус баг-репорта #${updated.reportNumber} успешно изменен на: **${statusText}**`,
          ephemeral: true
        });
      }

      return;
    }

    // ----------------------------------------------------
    // 2. MODAL SUBMISSIONS
    // ----------------------------------------------------
    if (interaction.isModalSubmit()) {
      const modalId = interaction.customId;
      const user = interaction.user;

      let category = 'support';
      let subject = 'Обращение';
      let description = '';
      let steps = '';

      if (modalId === 'modal_ticket_support') {
        category = 'support';
        subject = interaction.fields.getTextInputValue('ticket_subject');
        description = interaction.fields.getTextInputValue('ticket_desc');
      } else if (modalId === 'modal_ticket_bug') {
        category = 'bug';
        subject = interaction.fields.getTextInputValue('bug_title');
        description = interaction.fields.getTextInputValue('bug_desc');
        steps = interaction.fields.getTextInputValue('bug_steps') || 'Не указаны';
      } else if (modalId === 'modal_ticket_question') {
        category = 'question';
        subject = interaction.fields.getTextInputValue('question_subject');
        description = interaction.fields.getTextInputValue('question_desc');
      }

      // Check open tickets limit
      const openTickets = db.getTickets(guild.id, 'open').filter(t => t.authorId === user.id);
      if (openTickets.length >= 3) {
        return interaction.reply({
          content: '⚠️ У вас уже есть 3 открытых тикета! Дождитесь ответа персонала или закройте предыдущие.',
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

        if (!ticketCat) {
          ticketCat = await guild.channels.create({
            name: '🎫 ТИКЕТЫ & ПОДДЕРЖКА',
            type: ChannelType.GuildCategory
          }).catch(() => null);
        }

        const adminRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('админ') || r.name.toLowerCase().includes('admin'));
        const modRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('модератор') || r.name.toLowerCase().includes('moderator'));

        const cleanName = user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 12) || 'user';
        const channelName = `🎫│${category === 'bug' ? 'баг' : 'тикет'}-${cleanName}`;

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

        if (adminRole) overwrites.push({ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        if (modRole) overwrites.push({ id: modRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

        const ticketChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: ticketCat ? ticketCat.id : null,
          permissionOverwrites: overwrites,
          topic: `Тикет #${category}: ${user.tag} (${user.id})`
        });

        // Record in Database
        const ticketRecord = db.createTicket(guild.id, ticketChannel.id, user, category, subject);
        db.addTicketMessage(ticketChannel.id, user.tag, `[Создание тикета] Тема: ${subject} | Сообщение: ${description}`);

        // If it was a bug, also register Bug Report in DB and post to #баг-репорты
        let bugRecord = null;
        if (category === 'bug') {
          bugRecord = db.createBugReport(guild.id, user, subject, description, steps, 'medium');

          const bugChannel = guild.channels.cache.find(c => 
            c.isTextBased() && (c.name.includes('баг') || c.name.includes('bug'))
          );

          if (bugChannel) {
            const bugEmbed = new EmbedBuilder()
              .setColor(0xE74C3C)
              .setTitle(`🐛 Баг-репорт #${bugRecord.reportNumber}: ${subject}`)
              .setDescription(`**Описание ошибки:**\n${description}\n\n**Шаги для повторения:**\n${steps}`)
              .addFields(
                { name: '👤 Автор', value: `${user} (\`${user.id}\`)`, inline: true },
                { name: '⚡ Важность', value: '🟡 Средняя', inline: true },
                { name: 'Статус', value: '🟡 Новый', inline: true }
              )
              .setThumbnail(user.displayAvatarURL({ dynamic: true }))
              .setFooter({ text: `ID: ${bugRecord.id} • Тикет: #${ticketRecord.ticketNumber}` })
              .setTimestamp();

            const bugRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`bug_in_progress_${bugRecord.id}`).setLabel('В работу').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`bug_fixed_${bugRecord.id}`).setLabel('Исправлено').setEmoji('✅').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`bug_rejected_${bugRecord.id}`).setLabel('Отклонить').setEmoji('❌').setStyle(ButtonStyle.Secondary)
            );

            await bugChannel.send({ embeds: [bugEmbed], components: [bugRow] }).catch(() => {});
          }
        }

        // Welcome Embed inside the newly created ticket channel
        const welcomeEmbed = new EmbedBuilder()
          .setColor(category === 'bug' ? 0xE74C3C : 0x5865F2)
          .setTitle(`🎫 Тикет #${ticketRecord.ticketNumber}: ${subject}`)
          .setDescription(
            `Здравствуйте, ${user}!\n\n` +
            `Ваше обращение принято и передано команде Musicium Staff.\n\n` +
            `• **Суть вопроса / Описание:**\n>>> ${description}\n\n` +
            (steps ? `• **Шаги для повторения:**\n>>> ${steps}\n\n` : '') +
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
          title: `Создан тикет #${ticketRecord.ticketNumber} [${category}]`,
          description: `Пользователь **${user.tag}** открыл обращение: **"${subject}"** в канале ${ticketChannel}`,
          executor: user,
          fields: [
            { name: 'Категория', value: category, inline: true },
            { name: 'Баг-репорт', value: bugRecord ? `Зарегистрирован (#${bugRecord.reportNumber})` : 'Нет', inline: true }
          ],
          color: 0x3498DB
        });

        return interaction.editReply({
          content: `✅ **Ваш тикет #${ticketRecord.ticketNumber} успешно создан:** ${ticketChannel}\nПерейдите в канал для общения с персоналом.`
        });
      } catch (err) {
        console.error('[Ticket Modal Error]', err);
        return interaction.editReply({ content: `❌ Ошибка создания тикета: ${err.message}` });
      }
    }

    // ----------------------------------------------------
    // 3. CHAT SLASH COMMANDS
    // ----------------------------------------------------
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[Command] Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(`[Command Error] /${interaction.commandName}:`, error);
      const replyContent = { content: '❌ Произошла ошибка при выполнении этой команды!', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(replyContent).catch(() => {});
      } else {
        await interaction.reply(replyContent).catch(() => {});
      }
    }
  }
};
