require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');

// --- CONFIGURATION ---
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1471982561143033906';
const GUILD_ID = '1278094002817597472';
const ADMIN_ID = '694986869204713482';
const PLAYER_IDS = ['694986869204713482', '1445073473243447417'];
const CHALLENGE_CH_ID = '1471981226578415822';
const CHAT_CH_ID = '1471981485895450777';
const STATUS_CH_ID = '1471997005596332135'; // The Progress Channel

const OPERATORS = [
    "National Express West Midlands", "National Express Coventry", "Diamond Bus", 
    "Stagecoach", "Arriva", "West Midlands Metro", "West Midlands Railway", 
    "London Northwestern", "Avanti West Coast", "CrossCountry", 
    "Chiltern Railways", "Transport for Wales"
];

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

let startTime = null;
let statusMessage = null;
let playerData = {};

PLAYER_IDS.forEach(id => {
    playerData[id] = { 
        penaltyMinutes: 0, // Time added/removed via challenges
        activeChallenge: false,
        challengePaused: false,
        challengeTimeLeft: 300,
        challengeTimer: null,
        completedOps: [],
        finished: false,
        finishTime: null
    };
});

// Helper to format time strings
function formatDuration(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// --- UPDATE STATUS CHANNEL EVERY MINUTE ---
async function updateStatusEmbed() {
    if (!startTime || !statusMessage) return;

    const embed = new EmbedBuilder()
        .setTitle("🕒 LIVE: West Midlands Transport Challenge")
        .setColor(0x2B2D31)
        .setTimestamp();

    PLAYER_IDS.forEach(id => {
        const data = playerData[id];
        const elapsedMs = (data.finishTime || Date.now()) - startTime;
        const adjustedMs = elapsedMs + (data.penaltyMinutes * 60000);
        
        let opList = OPERATORS.map(op => data.completedOps.includes(op) ? `✅ ${op}` : `⬜ ${op}`).join('\n');
        
        embed.addFields({
            name: `Player: ${client.users.cache.get(id)?.username || id}`,
            value: `**Current Adjusted Time:** \`${formatDuration(adjustedMs)}\`\n*(Raw: ${formatDuration(elapsedMs)} | Mod: ${data.penaltyMinutes}m)*\n\n**Operators:**\n${opList}`,
            inline: true
        });
    });

    try {
        await statusMessage.edit({ embeds: [embed] });
    } catch (e) { console.error("Failed to edit status message"); }
}

// --- LOGIC ---

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // EMERGENCY SYNC
    if (message.content === '!sync' && message.author.id === ADMIN_ID) {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        const commands = [{ name: 'start', description: 'Begin the challenge' }];
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        message.reply("✅ Status Sync Complete.");
    }

    // CHECK-IN / CHALLENGE HANDLING
    if (message.channelId === CHAT_CH_ID && message.attachments.size > 0 && message.mentions.has(client.user)) {
        const pId = message.author.id;
        const data = playerData[pId];
        if (!data || data.finished) return;

        const matchedOp = OPERATORS.find(op => message.content.toLowerCase().includes(op.toLowerCase()));

        if (matchedOp) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`opApprove_${pId}_${matchedOp}`).setLabel(`Approve ${matchedOp}`).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`opReject_${pId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
            );
            await message.reply({ content: `🎫 **Operator Check-in:** ${matchedOp}`, components: [row] });
        } else if (data.activeChallenge && !data.challengePaused) {
            data.challengePaused = true;
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`approve_${pId}`).setLabel('Correct (-10m Time)').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`reject_${pId}`).setLabel('Incorrect (Resume)').setStyle(ButtonStyle.Danger)
            );
            await message.reply({ content: `🛡️ **Challenge Proof Received.** Clock paused for verification.`, components: [row] });
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'start') {
        startTime = Date.now();
        const statusChan = client.channels.cache.get(STATUS_CH_ID);
        statusMessage = await statusChan.send("🚀 Initializing Challenge Board...");
        
        PLAYER_IDS.forEach(id => queueNextChallenge(id));
        setInterval(updateStatusEmbed, 60000); // Update every 1 minute
        await interaction.reply("Challenge Started! Progress is being tracked in <#" + STATUS_CH_ID + ">.");
    }

    if (interaction.isButton()) {
        if (interaction.user.id !== ADMIN_ID) return;
        const parts = interaction.customId.split('_');
        const [type, pId] = parts;
        const data = playerData[pId];

        if (type === 'opApprove') {
            const opName = parts[2];
            if (!data.completedOps.includes(opName)) data.completedOps.push(opName);
            await interaction.update({ content: `✅ **${opName}** approved.`, components: [] });
            if (data.completedOps.length === OPERATORS.length) {
                data.finished = true;
                data.finishTime = Date.now();
            }
        } else if (type === 'approve') {
            data.penaltyMinutes -= 10; // REMOVE 10 MINUTES FOR WINNING
            stopChallenge(pId, `🌟 Challenge Approved! **10 minutes deducted** from <@${pId}>'s total time.`);
            await interaction.update({ components: [] });
        } else if (type === 'reject') {
            data.challengePaused = false;
            await interaction.update({ content: "❌ Rejected. Clock is ticking!", components: [] });
        }
        updateStatusEmbed();
    }
});

function queueNextChallenge(pId) {
    if (playerData[pId].finished) return;
    const delay = Math.floor(Math.random() * (45 - 15 + 1) + 15) * 60000;
    setTimeout(() => triggerChallenge(pId), delay);
}

async function triggerChallenge(pId) {
    const data = playerData[pId];
    if (data.finished) return;

    data.activeChallenge = true;
    data.challengeTimeLeft = 120;
    data.challengePaused = false;

    const challenge = "Take a photo of the vehicle fleet number!"; // (Shortened for brevity)
    client.channels.cache.get(CHALLENGE_CH_ID).send(`🚨 **CHALLENGE!** <@${pId}>\nTask: ${challenge}`);

    data.challengeTimer = setInterval(() => {
        if (!data.challengePaused) {
            data.challengeTimeLeft--;
            if (data.challengeTimeLeft <= 0) {
                data.penaltyMinutes += 10; // ADD 10 MINUTES FOR FAILING
                stopChallenge(pId, `⏰ **TIME'S UP!** <@${pId}> failed. **10 minutes added** to their total time.`);
            }
        }
    }, 1000);
}

function stopChallenge(pId, msg) {
    const data = playerData[pId];
    clearInterval(data.challengeTimer);
    data.activeChallenge = false;
    client.channels.cache.get(CHAT_CH_ID).send(msg);
    queueNextChallenge(pId);
}

client.login(TOKEN);
