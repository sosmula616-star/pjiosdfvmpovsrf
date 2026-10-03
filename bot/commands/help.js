const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Список команд стафф-бота Musicium и руководство'),

  async execute(interaction) {
    const port = process.env.DASHBOARD_PORT || 3000;
    const dashboardUrl = `http://localhost:${port}`;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🛡️ Musicium Staff Bot — Справочник команд')
      .setDescription(
        `Комплексная система модерации, защиты сервера (Антикраш) и управления правами сообщества Musicium.\n\n` +
        `🌐 **Веб-панель управления:** [${dashboardUrl}](${dashboardUrl})`
      )
      .addFields(
        {
          name: '🔨 Модерация',
          value:
            '`/ban <target> [duration] [reason]` — Бан на время или навсегда\n' +
            '`/unban <user_id> [reason]` — Разбан по ID пользователя\n' +
            '`/mute <target> <type: text|voice> [duration] [reason]` — Текстовый или голосовой мут с таймером\n' +
            '`/unmute <target> [type] [reason]` — Снятие мута\n' +
            '`/kick <target> [reason]` — Исключение участника\n' +
            '`/warn <target> <reason>` — Выдать предупреждение\n' +
            '`/warns <target>` — Просмотреть историю варнов\n' +
            '`/clearwarns <target> [warn_id]` — Снять варн(ы)'
        },
        {
          name: '🚀 Автоматизация сервера',
          value:
            '`/setup-server` — Автоматически создать структуру сообщества (RU & EN разделы, правила, каналы логов, роли)'
        },
        {
          name: '🛡️ Антикраш (Anti-Crash)',
          value:
            '• Защита от массового удаления/создания каналов\n' +
            '• Защита от удаления ролей\n' +
            '• Защита от массовых банов и киков\n' +
            '• Авто-карантин/бан нарушителя и мгновенный алерт владельцу\n' +
            '• Настройка лимитов и вайтлистов доступна через **Веб-панель**!'
        },
        {
          name: '📋 Система логирования (6 категорий)',
          value:
            '🚨 `логи-антикраш` • 🔨 `логи-модерации` • 💬 `логи-сообщений`\n' +
            '👥 `логи-участников` • 🛠️ `логи-каналов-ролей` • 🎙️ `логи-голосовых`'
        }
      )
      .setFooter({ text: 'Musicium Staff Protection System' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
