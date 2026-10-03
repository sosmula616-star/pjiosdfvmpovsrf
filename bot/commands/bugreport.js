const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('../services/logService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bugreport')
    .setDescription('Отправить официальный баг-репорт разработчикам Musicium')
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Краткая суть бага (заголовок)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('description')
        .setDescription('Подробное описание: что пошло не так?')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('steps')
        .setDescription('Шаги воспроизведения ошибки')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('severity')
        .setDescription('Серьезность ошибки')
        .setRequired(false)
        .addChoices(
          { name: '🟢 Низкая (Косметический баг / опечатка)', value: 'low' },
          { name: '🟡 Средняя (Команда работает с ошибкой)', value: 'medium' },
          { name: '🟠 Высокая (Не играет музыка / сбой прав)', value: 'high' },
          { name: '🔴 Критическая (Бот крашится / уязвимость)', value: 'critical' }
        )
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    const user = interaction.user;
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const steps = interaction.options.getString('steps') || 'Не указаны';
    const severity = interaction.options.getString('severity') || 'medium';

    await interaction.deferReply({ ephemeral: true });

    try {
      // Find bugs channel (e.g., #баг-репорты or #логи-антикраш)
      const bugChannel = guild.channels.cache.find(c => 
        c.isTextBased() && (c.name.includes('баг') || c.name.includes('bug'))
      );

      const severityColors = {
        low: 0x2ECC71,
        medium: 0xF1C40F,
        high: 0xE67E22,
        critical: 0xE74C3C
      };

      const severityLabels = {
        low: '🟢 Низкая',
        medium: '🟡 Средняя',
        high: '🟠 Высокая',
        critical: '🔴 КРИТИЧЕСКАЯ'
      };

      // Create record in DB first
      const report = db.createBugReport(guild.id, user, title, description, steps, severity);

      const embed = new EmbedBuilder()
        .setColor(severityColors[severity] || 0xF1C40F)
        .setTitle(`🐛 Баг-репорт #${report.reportNumber}: ${title}`)
        .setDescription(`**Описание ошибки:**\n${description}\n\n**Шаги для воспроизведения:**\n${steps}`)
        .addFields(
          { name: '👤 Автор', value: `${user} (\`${user.id}\`)`, inline: true },
          { name: '⚡ Серьезность', value: severityLabels[severity], inline: true },
          { name: 'Статус', value: '🟡 Новый (Ожидает рассмотрения)', inline: true }
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `ID Бага: ${report.id} • Musicium Bug Tracker` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bug_in_progress_${report.id}`)
          .setLabel('В работе')
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`bug_fixed_${report.id}`)
          .setLabel('Исправлено')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`bug_rejected_${report.id}`)
          .setLabel('Отклонить')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Secondary)
      );

      let msg = null;
      if (bugChannel) {
        msg = await bugChannel.send({ embeds: [embed], components: [row] });
        report.messageId = msg.id;
        db.save('bugReports');
      }

      // Audit Log
      await sendLog(guild, {
        category: 'moderation',
        action: 'BUG_REPORT_SUBMITTED',
        title: `Новый баг-репорт #${report.reportNumber}`,
        description: `Пользователь **${user.tag}** отправил баг: **"${title}"**`,
        executor: user,
        fields: [
          { name: 'Важность', value: severityLabels[severity], inline: true },
          { name: 'Канал', value: bugChannel ? `${bugChannel}` : 'Не найден', inline: true }
        ],
        color: severityColors[severity]
      });

      return interaction.editReply({
        content: `✅ **Ваш баг-репорт #${report.reportNumber} успешно зарегистрирован!**\nОн передан разработчикам и отображается на панели управления.`
      });
    } catch (err) {
      console.error('[Bug Report Command Error]', err);
      return interaction.editReply({ content: `❌ Ошибка отправки баг-репорта: ${err.message}` });
    }
  }
};
