import discord
from discord import app_commands, ui
from discord.ext import tasks
import random
import asyncio
import time

# --- CONFIGURATION ---
TOKEN = 'MTQ3MTk4MjU2MTE0MzAzMzkwNg.GnCt1l.BBrAyamkwAib6xNdRYffItPUXd9lPtW3ubqrSQ'
ADMIN_ID = 694986869204713482  # Your Discord ID
PLAYER_IDS = [694986869204713482, 1445073473243447417] # The IDs of you and your friend

# Channel where the bot posts challenges (make this read-only for players)
CHALLENGE_CHANNEL_ID = 123456789012345678 
# Channel where players talk and send proof
CHAT_CHANNEL_ID = 987654321098765432

# Challenges from image_0.png, updated to ensure they all ask for a photo/video.
CHALLENGES = [
    "Take a photo of the vehicle fleet number!",
    "Take a selfie with the destination board.",
    "Photograph the seat moquette (pattern).",
    "Take a photo of the vehicle and tell me its manufacturer (e.g. 'This is an ADL').",
    "Take a photo of a 'Safety First' or 'Emergency Exit' sign.",
    "Record a 5-second video of the next stop announcement.",
    "Find a contactless/Osprey reader and take a photo."
]

class VerifyView(ui.View):
    def __init__(self, bot, player_id):
        super().__init__(timeout=None)
        self.bot = bot
        self.player_id = player_id

    @ui.button(label="✅ Correct (+1 pt)", style=discord.ButtonStyle.success)
    async def approve(self, interaction: discord.Interaction, button: ui.Button):
        if interaction.user.id != ADMIN_ID:
            return await interaction.response.send_message("Only the Admin can verify.", ephemeral=True)
        
        self.bot.player_data[self.player_id]['points'] += 1
        if self.bot.player_data[self.player_id]['active_task']:
            self.bot.player_data[self.player_id]['active_task'].cancel()
        self.bot.player_data[self.player_id]['active_challenge'] = False
        self.bot.player_data[self.player_id]['paused'] = False
        
        chat_channel = self.bot.get_channel(CHAT_CHANNEL_ID)
        await interaction.response.edit_message(content=f"✅ **Challenge Complete!** <@{self.player_id}> earned 1 point.", view=None)
        await chat_channel.send(f"🎉 <@{self.player_id}> got the point! Challenge over.")

    @ui.button(label="❌ Incorrect (Resume Timer)", style=discord.ButtonStyle.danger)
    async def reject(self, interaction: discord.Interaction, button: ui.Button):
        if interaction.user.id != ADMIN_ID:
            return await interaction.response.send_message("Only the Admin can verify.", ephemeral=True)
        
        # Resume the timer
        self.bot.player_data[self.player_id]['paused'] = False
        chat_channel = self.bot.get_channel(CHAT_CHANNEL_ID)
        await interaction.response.edit_message(content=f"❌ **Rejected.** Timer resumed for <@{self.player_id}>.", view=None)
        await chat_channel.send(f"⚠️ **Proof Rejected!** The clock is ticking again for <@{self.player_id}>! Get it right!")

class TransportBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.all())
        self.tree = app_commands.CommandTree(self)
        self.player_data = {pid: {
            'points': 0, 
            'active_challenge': False, 
            'paused': False, 
            'remaining_seconds': 300,
            'active_task': None
        } for pid in PLAYER_IDS}

    async def setup_hook(self):
        self.challenge_loop.start()

    @tasks.loop(minutes=1)
    async def challenge_loop(self):
        for pid in PLAYER_IDS:
            if not self.player_data[pid]['active_challenge'] and random.randint(1, 45) == 1:
                self.player_data[pid]['active_task'] = asyncio.create_task(self.run_challenge_timer(pid))

    async def run_challenge_timer(self, pid):
        self.player_data[pid]['active_challenge'] = True
        self.player_data[pid]['remaining_seconds'] = 300
        self.player_data[pid]['paused'] = False
        
        challenge = random.choice(CHALLENGES)
        challenge_channel = self.get_channel(CHALLENGE_CHANNEL_ID)
        chat_channel = self.get_channel(CHAT_CHANNEL_ID)

        # Send pings to both channels to ensure they see it
        await challenge_channel.send(
            f"🚨 **CHALLENGE PING!** <@{pid}>\n"
            f"**Task:** {challenge}\n"
            f"You have **5 minutes**. Post your photo/video proof in <#{CHAT_CHANNEL_ID}> and **ping me** (@{self.user.name}) to stop the timer!"
        )
        await chat_channel.send(f"⚡ <@{pid}> has been challenged! Check <#{CHALLENGE_CHANNEL_ID}> for details.")

        while self.player_data[pid]['remaining_seconds'] > 0:
            if not self.player_data[pid]['paused']:
                await asyncio.sleep(1)
                self.player_data[pid]['remaining_seconds'] -= 1
            else:
                # Timer is paused, wait a bit
                await asyncio.sleep(0.5)
        
        # Time's up
        if self.player_data[pid]['active_challenge']:
            self.player_data[pid]['points'] -= 2
            self.player_data[pid]['active_challenge'] = False
            self.player_data[pid]['paused'] = False
            await chat_channel.send(f"⏰ **TIME'S UP!** <@{pid}> failed the challenge and lost 2 points.")

    async def on_message(self, message):
        # Ignore bot messages, messages outside the chat channel, no attachments, or no bot ping
        if (message.author.bot or 
            message.channel.id != CHAT_CHANNEL_ID or 
            not message.attachments or 
            self.user not in message.mentions):
            return
        
        pid = message.author.id
        if pid in PLAYER_IDS and self.player_data[pid]['active_challenge'] and not self.player_data[pid]['paused']:
            self.player_data[pid]['paused'] = True
            
            # Prepare verification message for Admin
            content = f"🛡️ **Proof Received from <@{pid}>!** Timer paused.\n"
            content += f"**User's Message:** \"{message.content}\"\n" # Include user text for manufacturer check
            content += f"**Admin <@{ADMIN_ID}>, verify this proof:**"
            
            view = VerifyView(self, pid)
            await message.channel.send(content, view=view)

    @app_commands.command(name="score", description="Show current challenge standings")
    async def score(self, interaction: discord.Interaction):
        embed = discord.Embed(title="Birmingham Challenge Standings", color=discord.Color.blue())
        for pid in PLAYER_IDS:
            embed.add_field(name=f"Player", value=f"<@{pid}>: {self.player_data[pid]['points']} pts", inline=False)
        await interaction.response.send_message(embed=embed)

bot = TransportBot()
bot.run(TOKEN)
