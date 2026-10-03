const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const db = require('../../database/db');

// Schema of expected community categories and channels for daily integrity checks
const COMMUNITY_STRUCTURE = [
  {
    categoryName: '🚪 ВХОД & ВЕРИФИКАЦИЯ',
    channels: [
      { name: '✅│верификация', type: ChannelType.GuildText, isVerification: true }
    ]
  },
  {
    categoryName: '📌 ИНФОРМАЦИЯ | INFO',
    channels: [
      { name: '📜│правила-rules', type: ChannelType.GuildText, isRules: true },
      { name: '📢│объявления-news', type: ChannelType.GuildText },
      { name: '🤖│о-боте-about-bot', type: ChannelType.GuildText, isAbout: true },
      { name: '🎁│обновления-updates', type: ChannelType.GuildText }
    ]
  },
  {
    categoryName: '🇷🇺 РУ-СООБЩЕСТВО',
    channels: [
      { name: '💬│основной-чат', type: ChannelType.GuildText },
      { name: '🎵│делимся-треками', type: ChannelType.GuildText },
      { name: '💡│идеи-предложения', type: ChannelType.GuildText },
      { name: '❓│помощь-по-боту', type: ChannelType.GuildText },
      { name: '🔊│Музыкальная комната 1', type: ChannelType.GuildVoice },
      { name: '🔊│Музыкальная комната 2', type: ChannelType.GuildVoice },
      { name: '🔊│Голосовой чилл', type: ChannelType.GuildVoice }
    ]
  },
  {
    categoryName: '🇬🇧 ENGLISH COMMUNITY',
    channels: [
      { name: '💬│general-chat', type: ChannelType.GuildText },
      { name: '🎵│music-sharing', type: ChannelType.GuildText },
      { name: '💡│suggestions', type: ChannelType.GuildText },
      { name: '❓│bot-help', type: ChannelType.GuildText },
      { name: '🔊│Music Lounge 1', type: ChannelType.GuildVoice },
      { name: '🔊│Music Lounge 2', type: ChannelType.GuildVoice },
      { name: '🔊│Voice Hangout', type: ChannelType.GuildVoice }
    ]
  },
  {
    categoryName: '🎫 ПОДДЕРЖКА | SUPPORT',
    channels: [
      { name: '📩│создать-тикет', type: ChannelType.GuildText },
      { name: '🐛│баг-репорты', type: ChannelType.GuildText }
    ]
  },
  {
    categoryName: '🛡️ ПЕРСОНАЛ | STAFF ONLY',
    isStaff: true,
    channels: [
      { name: '💬│чат-модерации', type: ChannelType.GuildText },
      { name: '🤖│бот-команды-стафф', type: ChannelType.GuildText }
    ]
  },
  {
    categoryName: '📋 ЖУРНАЛ АУДИТА | LOGS',
    isLogs: true,
    channels: [
      { name: '🚨│логи-антикраш', type: ChannelType.GuildText, logKey: 'antiCrash' },
      { name: '🔨│логи-модерации', type: ChannelType.GuildText, logKey: 'moderation' },
      { name: '💬│логи-сообщений', type: ChannelType.GuildText, logKey: 'messages' },
      { name: '👥│логи-участников', type: ChannelType.GuildText, logKey: 'members' },
      { name: '🛠️│логи-каналов-ролей', type: ChannelType.GuildText, logKey: 'channelsRoles' },
      { name: '🎙️│логи-голосовых', type: ChannelType.GuildText, logKey: 'voice' }
    ]
  }
];

/**
 * Configure permission overwrites for Mute, Ban, and Verified roles across all channels
 */
async function applySpecialRoleOverwrites(guild, specialRoles = {}) {
  const settings = db.getGuildSettings(guild.id);
  const roles = {
    muteRoleId: specialRoles.muteRoleId || settings.specialRoles?.muteRoleId,
    banRoleId: specialRoles.banRoleId || settings.specialRoles?.banRoleId,
    verifiedRoleId: specialRoles.verifiedRoleId || settings.specialRoles?.verifiedRoleId
  };

  let updatedCount = 0;
  const everyoneRole = guild.roles.everyone;

  for (const [, channel] of guild.channels.cache) {
    try {
      const isVerificationChannel = channel.name.includes('верификац') || channel.name.includes('verify');

      // 1. Mute Role: deny sending text, reactions, and speaking in voice
      if (roles.muteRoleId) {
        if (channel.isTextBased()) {
          await channel.permissionOverwrites.edit(roles.muteRoleId, {
            SendMessages: false,
            AddReactions: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
            SendMessagesInThreads: false
          }).catch(() => {});
        } else if (channel.isVoiceBased()) {
          await channel.permissionOverwrites.edit(roles.muteRoleId, {
            Speak: false
          }).catch(() => {});
        }
      }

      // 2. Ban Role: deny view and connect everywhere
      if (roles.banRoleId) {
        await channel.permissionOverwrites.edit(roles.banRoleId, {
          ViewChannel: false,
          SendMessages: false,
          Connect: false
        }).catch(() => {});
      }

      // 3. Verification & Everyone Isolation:
      // If verification channel: @everyone sees it, verified users don't need it
      if (isVerificationChannel) {
        await channel.permissionOverwrites.edit(everyoneRole, {
          ViewChannel: true,
          SendMessages: false,
          ReadMessageHistory: true
        }).catch(() => {});
        if (roles.verifiedRoleId) {
          await channel.permissionOverwrites.edit(roles.verifiedRoleId, {
            ViewChannel: false
          }).catch(() => {});
        }
      } else {
        // Community channels: hide from @everyone, show to verified users
        if (!channel.name.includes('логи-') && !channel.name.includes('персонал') && !channel.name.includes('staff')) {
          await channel.permissionOverwrites.edit(everyoneRole, {
            ViewChannel: false
          }).catch(() => {});
          if (roles.verifiedRoleId) {
            await channel.permissionOverwrites.edit(roles.verifiedRoleId, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
              Connect: true,
              Speak: true
            }).catch(() => {});
          }
        }
      }

      updatedCount++;
    } catch (e) {
      console.warn(`[Permissions] Overwrite error for channel ${channel.name}:`, e.message);
    }
  }

  return { success: true, updatedCount };
}

/**
 * Creates the complete Music Bot Community structure on a Guild:
 * - Special roles (Admin, Moderator, Verified Listener, Muted, Banned)
 * - Verification channel with interactive button
 * - RU and EN categories & channels
 * - Logging channels
 * - Formatted bilingual rules and bot info embeds
 */
async function setupCommunityServer(guild, initiatedBy = null) {
  const statusLog = [];
  const log = (msg) => {
    console.log(`[Setup] ${msg}`);
    statusLog.push(msg);
  };

  log(`Starting community setup for guild: "${guild.name}" (${guild.id})`);

  // 1. Create or find basic staff & special roles
  let adminRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('администратор') || r.name.toLowerCase().includes('admin'));
  if (!adminRole) {
    adminRole = await guild.roles.create({
      name: '🛡️ Администратор',
      color: 0xE74C3C,
      hoist: true,
      permissions: [PermissionFlagsBits.Administrator],
      reason: 'Автоматическое создание ролей сервера Musicium'
    });
    log('Created role: 🛡️ Администратор');
  }

  let modRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('модератор') || r.name.toLowerCase().includes('moderator'));
  if (!modRole) {
    modRole = await guild.roles.create({
      name: '⚔️ Модератор',
      color: 0x3498DB,
      hoist: true,
      permissions: [
        PermissionFlagsBits.ViewAuditLog,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.MoveMembers
      ],
      reason: 'Автоматическое создание ролей сервера Musicium'
    });
    log('Created role: ⚔️ Модератор');
  }

  // Verified Member Role
  let verifiedRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('слушатель') || r.name.toLowerCase().includes('verified') || r.name.toLowerCase().includes('участник'));
  if (!verifiedRole) {
    verifiedRole = await guild.roles.create({
      name: '🎵 Слушатель',
      color: 0x9B59B6,
      hoist: false,
      reason: 'Роль верифицированного участника Musicium'
    });
    log('Created role: 🎵 Слушатель (Верификация)');
  }

  // Muted Role
  let muteRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('замучен') || r.name.toLowerCase().includes('muted'));
  if (!muteRole) {
    muteRole = await guild.roles.create({
      name: '🔇 Замучен',
      color: 0x7F8C8D,
      hoist: false,
      reason: 'Роль мута (ограничение отправки сообщений и голоса)'
    });
    log('Created role: 🔇 Замучен');
  }

  // Banned Role (Quarantine / Blacklist)
  let banRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('заблокирован') || r.name.toLowerCase().includes('banned') || r.name.toLowerCase().includes('quarantine'));
  if (!banRole) {
    banRole = await guild.roles.create({
      name: '⛔ Заблокирован',
      color: 0x2C3E50,
      hoist: false,
      reason: 'Роль блокировки и карантина (полный запрет доступа)'
    });
    log('Created role: ⛔ Заблокирован');
  }

  // Save special roles to DB
  db.updateGuildSettings(guild.id, {
    specialRoles: {
      muteRoleId: muteRole.id,
      banRoleId: banRole.id,
      verifiedRoleId: verifiedRole.id
    }
  });

  const everyoneRole = guild.roles.everyone;
  const logChannelsSaved = {};

  // 2. Build Categories and Channels
  for (const catDef of COMMUNITY_STRUCTURE) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === catDef.categoryName.toLowerCase());

    const overwrites = [
      {
        id: everyoneRole.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: adminRole.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages]
      }
    ];

    if (!catDef.isStaff && !catDef.isLogs) {
      if (catDef.categoryName.includes('ВХОД')) {
        // Verification category: visible to everyone
        overwrites[0].deny = [];
        overwrites[0].allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
      } else {
        // Community categories: visible to verified role
        overwrites.push({
          id: verifiedRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
        });
      }
    } else if (catDef.isStaff) {
      overwrites.push({
        id: modRole.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      });
    }

    if (!cat) {
      cat = await guild.channels.create({
        name: catDef.categoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites
      });
      log(`Created category: ${catDef.categoryName}`);
    }

    // Create channels in category
    for (const chDef of catDef.channels) {
      let ch = guild.channels.cache.find(c => c.name.toLowerCase() === chDef.name.toLowerCase() && c.parentId === cat.id);

      if (!ch) {
        ch = await guild.channels.create({
          name: chDef.name,
          type: chDef.type,
          parent: cat.id
        });
        log(`Created channel: ${chDef.name}`);

        // Setup special verification interactive button embed
        if (chDef.isVerification) {
          const verifyEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🛡️ ВЕРИФИКАЦИЯ СООБЩЕСТВА MUSICIUM / VERIFICATION')
            .setDescription(
              `Добро пожаловать на официальный сервер музыкального бота **Musicium**!\n\n` +
              `Чтобы получить полный доступ ко всем текстовым и голосовым комнатам, нажмите на зеленую кнопку **«Пройти верификацию»** ниже.\n\n` +
              `Welcome! Click the green button below to verify and unlock all channels.`
            )
            .setImage('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80')
            .setFooter({ text: 'Musicium Protection System • Автоматический допуск' })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('verify_member')
              .setLabel('✅ Пройти верификацию / Verify')
              .setStyle(ButtonStyle.Success)
          );

          await ch.send({ embeds: [verifyEmbed], components: [row] });
          log('Sent interactive verification button message.');
        }

        // Send Rules embeds
        if (chDef.isRules) {
          await sendBilingualRules(ch);
          log('Sent bilingual rules to #правила-rules');
        }

        // Send About Bot guide
        if (chDef.isAbout) {
          await sendBotGuide(ch);
          log('Sent music guide to #о-боте-about-bot');
        }

        // Send Interactive Ticket & Bug Report Panel to #создать-тикет
        if (chDef.name.includes('создать-тикет') || chDef.name.includes('create-ticket')) {
          await sendTicketPanel(ch);
          log('Sent interactive ticket & bug report panel to #создать-тикет');
        }
      }

      if (chDef.logKey) {
        logChannelsSaved[chDef.logKey] = ch.id;
      }
    }
  }

  // 3. Save log channel IDs & Special Role configuration
  db.updateGuildSettings(guild.id, {
    logChannels: logChannelsSaved,
    expectedChannels: COMMUNITY_STRUCTURE
  });

  // 4. Apply Mute, Ban, and Verification permissions everywhere
  await applySpecialRoleOverwrites(guild);
  log('Configured permission overwrites for Mute and Ban roles across all channels.');

  // Record audit log
  db.addLog(guild.id, 'moderation', 'SERVER_SETUP', 'Автонастройка сервера', 'Создана полная структура с каналом верификации, ролями бана/мута и 6 журналами аудита', initiatedBy, null, [
    { name: 'Канал верификации', value: '✅│верификация' },
    { name: 'Роли', value: `@${verifiedRole.name}, @${muteRole.name}, @${banRole.name}` }
  ]);

  return {
    success: true,
    statusLog,
    specialRoles: db.getGuildSettings(guild.id).specialRoles
  };
}

/**
 * Daily Integrity Checker: checks all community channels and auto-recreates missing ones
 */
async function checkAndRestoreChannels(guild) {
  if (!guild) return null;
  const status = { checked: 0, restored: 0, logs: [] };

  const settings = db.getGuildSettings(guild.id);
  const now = Date.now();
  db.updateGuildSettings(guild.id, { lastChannelCheck: now });

  for (const catDef of COMMUNITY_STRUCTURE) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === catDef.categoryName.toLowerCase());
    if (!cat) {
      cat = await guild.channels.create({
        name: catDef.categoryName,
        type: ChannelType.GuildCategory,
        reason: 'Daily Auto-Restore: Восстановление отсутствующей категории'
      }).catch(() => null);
      status.restored++;
      status.logs.push(`Восстановлена категория: ${catDef.categoryName}`);
    }

    if (!cat) continue;

    for (const chDef of catDef.channels) {
      status.checked++;
      let ch = guild.channels.cache.find(c => c.name.toLowerCase() === chDef.name.toLowerCase() && c.parentId === cat.id);

      if (!ch) {
        ch = await guild.channels.create({
          name: chDef.name,
          type: chDef.type,
          parent: cat.id,
          reason: 'Daily Auto-Restore: Восстановление отсутствующего канала'
        }).catch(() => null);

        if (ch) {
          status.restored++;
          status.logs.push(`Восстановлен канал: #${chDef.name}`);

          if (chDef.isVerification) {
            const verifyEmbed = new EmbedBuilder()
              .setColor(0x5865F2)
              .setTitle('🛡️ ВЕРИФИКАЦИЯ СООБЩЕСТВА MUSICIUM / VERIFICATION')
              .setDescription('Нажмите на зеленую кнопку **«Пройти верификацию»** ниже для доступа к серверу.')
              .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('verify_member')
                .setLabel('✅ Пройти верификацию / Verify')
                .setStyle(ButtonStyle.Success)
            );
            await ch.send({ embeds: [verifyEmbed], components: [row] }).catch(() => {});
          } else if (chDef.isRules) {
            await sendBilingualRules(ch).catch(() => {});
          } else if (chDef.isAbout) {
            await sendBotGuide(ch).catch(() => {});
          }
        }
      }
    }
  }

  // Re-apply mute, ban, and verification overwrites
  await applySpecialRoleOverwrites(guild);

  if (status.restored > 0) {
    db.addLog(guild.id, 'anticrash', 'CHANNELS_RESTORED', 'Автовосстановление каналов', `Восстановлено недостающих каналов/категорий: ${status.restored}`, { tag: 'Daily Channel Guard' });
  }

  return status;
}

/**
 * Start daily recurring integrity checker (runs once every 24 hours)
 */
function startDailyChannelGuard(client) {
  console.log('[DailyGuard] Initializing daily channel integrity checker (24h schedule)...');
  setInterval(async () => {
    client.guilds.cache.forEach(async (guild) => {
      try {
        console.log(`[DailyGuard] Checking channels on guild "${guild.name}"...`);
        const res = await checkAndRestoreChannels(guild);
        if (res && res.restored > 0) {
          console.log(`[DailyGuard] Guild ${guild.name}: Restored ${res.restored} missing channels!`);
        }
      } catch (err) {
        console.error(`[DailyGuard] Error checking guild ${guild.id}:`, err.message);
      }
    });
  }, 24 * 60 * 60 * 1000); // 24 hours
}

// Helpers for rules and bot guide embeds
async function sendBilingualRules(ch) {
  const embedRu = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📜 ПРАВИЛА СООБЩЕСТВА MUSICIUM [RU]')
    .setDescription('Добро пожаловать на официальный сервер поддержки и сообщества музыкального бота! Ознакомьтесь с правилами поведения:')
    .addFields(
      { name: '1. Уважение и поведение', value: 'Запрещены оскорбления, травля, провокации и дискриминация.' },
      { name: '2. Спам и флуд', value: 'Запрещен флуд текстом, реакциями, эмодзи, капсом и массовые упоминания.' },
      { name: '3. Реклама и ссылки', value: 'Реклама других серверов строго запрещена. Музыка разрешена в #делимся-треками.' },
      { name: '4. Контент 18+', value: 'Шок-контент и NSFW строго запрещены.' },
      { name: '5. Голосовой этикет', value: 'Не используйте soundboard со скримерами и не мешайте слушать музыку.' }
    )
    .setFooter({ text: 'Musicium Staff Protection System' })
    .setTimestamp();

  const embedEn = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('📜 MUSICIUM COMMUNITY RULES [EN]')
    .setDescription('Welcome to the official Musicium Bot Community! Please follow community guidelines:')
    .addFields(
      { name: '1. Respect & Courtesy', value: 'Harassment, hate speech, and toxicity are strictly forbidden.' },
      { name: '2. Spam & Flooding', value: 'Do not flood chat with repeated text, excessive emojis, or pings.' },
      { name: '3. Self-Promotion', value: 'No unauthorized promotion or invite links.' },
      { name: '4. Voice Channels', value: 'Respect others listening to music and refrain from screamers.' }
    )
    .setFooter({ text: 'Musicium Staff Protection System' })
    .setTimestamp();

  await ch.send({ embeds: [embedRu, embedEn] });
}

async function sendBotGuide(ch) {
  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('🎵 КОМАНДЫ БОТА MUSICIUM / BOT GUIDE')
    .setDescription('Musicium — премиальный музыкальный бот с кристально чистым звуком и поддержкой плейлистов 24/7!')
    .addFields(
      { name: '🎧 Воспроизведение', value: '`/play <песня/ссылка>` — Запустить трек\n`/skip` — Пропустить\n`/stop` — Остановить и очистить\n`/queue` — Показать очередь' },
      { name: '🎛️ Эффекты звука', value: '`/filter bassboost` — Басбуст\n`/filter nightcore` — Найткор\n`/filter 8d` — 8D звук' }
    )
    .setTimestamp();

  await ch.send({ embeds: [embed] });
}

async function sendTicketPanel(ch) {
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

  await ch.send({ embeds: [embed], components: [row] });
}

module.exports = {
  setupCommunityServer,
  checkAndRestoreChannels,
  startDailyChannelGuard,
  applySpecialRoleOverwrites,
  sendTicketPanel
};
