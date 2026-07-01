import { env } from "../env.js";

export type DiscordMessage = {
  channelId: string;
  content: string;
};

export type DiscordSender = {
  sendMessage(message: DiscordMessage): Promise<void>;
};

export class DiscordBotClient implements DiscordSender {
  async sendMessage(message: DiscordMessage) {
    if (!env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not configured");

    const response = await fetch(`https://discord.com/api/v10/channels/${message.channelId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: message.content,
        allowed_mentions: { parse: ["users"] },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Discord message failed: ${response.status}${body ? ` ${body}` : ""}`);
    }
  }
}
