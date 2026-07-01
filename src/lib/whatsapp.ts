import { env } from "../env.js";

export type WhatsAppMessage = {
  to: string;
  content: string;
};

export type WhatsAppSender = {
  sendMessage(message: WhatsAppMessage): Promise<void>;
};

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
}

export class WhatsAppCloudClient implements WhatsAppSender {
  async sendMessage(message: WhatsAppMessage) {
    if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error("WhatsApp Cloud API is not configured");
    }

    const payload = env.WHATSAPP_TEMPLATE_NAME
      ? {
          messaging_product: "whatsapp",
          to: normalizePhone(message.to),
          type: "template",
          template: {
            name: env.WHATSAPP_TEMPLATE_NAME,
            language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: message.content }],
              },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: normalizePhone(message.to),
          type: "text",
          text: {
            preview_url: false,
            body: message.content,
          },
        };

    const response = await fetch(
      `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`WhatsApp message failed: ${response.status}${body ? ` ${body}` : ""}`);
    }
  }
}
