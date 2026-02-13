const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');

// --- CONFIGURATION ---
const TOKEN = 'MTQ3MTk4MjU2MTE0MzAzMzkwNg.GnCt1l.BBrAyamkwAib6xNdRYffItPUXd9lPtW3ubqrSQ';
const CLIENT_ID = '1471982561143033906';
const GUILD_ID = '1278094002817597472';
const ADMIN_ID = '694986869204713482';
const PLAYER_IDS = ['694986869204713482', '1445073473243447417'];
const CHALLENGE_CH_ID = '1471981226578415822';
const CHAT_CH_ID = '1471981485895450777';

const CHALLENGES = [
    "Take a photo of the vehicle fleet number you are currently on or nearest! (For trains this is always 6 digits, and is at each end somewhere.)",
    "Take a selfie with a timetable board.",
    "Get off at the next stop and video the vehicle leaving.",
    "Take a photo of the vehicle and identify the manufacturer of it.",
    "Take a photo of an 'Emergency Exit' sign. They aren't always on vehicles.",
    "Record a 5-second video of the next stop being announced or displayed somewhere.",
    "Find a contactless reader and take a photo of it. For trains, the barriers count. If you are on a tram, there are readers being installed round the city."
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

let playerData = {};
PLAYER_IDS.forEach(id => {
    playerData[id] = { points: 0, active: false, paused: false, timeLeft: 300, timer: null };
});

// --- SLASH COMMAND DEFINITIONS ---
const commands = [
    { name: 'score', description: 'Show the current points standings' },
    { name: 'start', description: 'Begin the random challenge loop' }
];

// --- LOGIC ---

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 1. EMERGENCY SYNC (Type !sync in any channel)
    if (message.content === '!sync' && message.author.id === ADMIN_ID) {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        try {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
            message.reply("✅ Slash commands synced to this server! Refresh Discord (Ctrl+R).");
        } catch (err) { console.error(err); message.reply("❌ Sync failed."); }
        return;
    }

    // 2. PROOF HANDLING (Ping bot + Attachment + Chat Channel)
    const data = playerData[message.author.id];
    if (message.channelId === CHAT_CH_ID && message.attachments.size > 0 && message.mentions.has(client.user) && data?.active && !data?.paused) {
        data.paused = true;
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_${message.author.id}`).setLabel('Correct (+1pt)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_${message.author.id}`).setLabel('Incorrect (Resume)').setStyle(ButtonStyle.Danger)
        );

        await message.reply({ 
            content: `🛡️ **Proof Received.** Timer paused. <@${ADMIN_ID}>, please verify.\n**Player Message:** "${message.content}"`,
            components: [row]
        });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'score') {
            const embed = new EmbedBuilder().setTitle("West Midlands Challenge").setColor(0x0099FF);
            PLAYER_IDS.forEach(id => embed.addFields({ name: `Player`, value: `<@${id}>: ${playerData[id].points}pts`, inline: false }));
            await interaction.reply({ embeds: [embed] });
        }
        if (interaction.commandName === 'start') {
            await interaction.reply("🚀 Challenge loop initiated! Keep your eyes on <#" + CHALLENGE_CH_ID + ">.");
            queueNextChallenge();
        }
    }

    if (interaction.isButton()) {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: "Only Admin can verify.", ephemeral: true });

        const [action, pId] = interaction.customId.split('_');
        const data = playerData[pId];

        if (action === 'approve') {
            data.points += 1;
            stopChallenge(pId, "✅ **Challenge Approved!** +1 point.");
            await interaction.update({ components: [] });
        } else if (action === 'reject') {
            data.paused = false;
            await interaction.update({ content: "❌ **Proof rejected.** Timer is ticking again!", components: [] });
        }
    }
});

function queueNextChallenge(pId) {
    // Generate a random time between 30 and 60 minutes (in milliseconds)
    const minMs = 15 * 60 * 1000;
    const maxMs = 45 * 60 * 1000;
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);

    console.log(`Next challenge for ${pId} queued in ${delay / 1000 / 60} minutes.`);

    setTimeout(() => {
        triggerChallenge(pId);
    }, delay);
}

async function triggerChallenge(pId) {
    const data = playerData[pId];
    data.active = true;
    data.timeLeft = 300;
    data.paused = false;

    const challenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    const chChannel = client.channels.cache.get(CHALLENGE_CH_ID);
    const chatChannel = client.channels.cache.get(CHAT_CH_ID);

    if (chChannel) {
        chChannel.send(`🚨 **CHALLENGE!** <@${pId}>\n**Task:** ${challenge}\n5 Minutes! Send proof in <#${CHAT_CH_ID}> and ping me!`);
    }

    data.timer = setInterval(() => {
        if (!data.paused) {
            data.timeLeft--;
            if (data.timeLeft <= 0) {
                data.points -= 2;
                stopChallenge(pId, `⏰ **TIME'S UP!** <@${pId}> failed and lost 2 points.`);
            }
        }
    }, 1000);
}

function stopChallenge(pId, msg) {
    const data = playerData[pId];
    clearInterval(data.timer);
    data.active = false;
    data.paused = false;
    client.channels.cache.get(CHAT_CH_ID).send(msg);
}

client.login(TOKEN);
