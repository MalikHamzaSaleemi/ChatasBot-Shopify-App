import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import axios from "axios";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log(`👉 CHECKOUT WEBHOOK HIT: ${request.url}`);

  try {
    const { shop, payload, topic, webhookId } = await authenticate.webhook(request);
    console.log(`Received ${topic} for ${shop} (ID: ${webhookId})`);

    // Forward to ChatAsBot VPS Universal Webhook Endpoint
    const vpsInstance = axios.create({
      baseURL: `${process.env.SHOPIFY_CHATASBOT_SERVER_URI}`, // Using base URI
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SHOPIFY_CHATASBOT_TOKEN}`,
        "x-shopify-topic": topic,
        "x-shopify-shop-domain": shop,
        "x-shopify-webhook-id": webhookId
      },
    });

    // We do NOT await this call so we can return 200 OK to Shopify immediately
    vpsInstance.post("/api/webhooks/shopify/public", payload)
      .then(() => console.log(`✅ Background: Forwarded ${topic} for ${shop} to VPS Universal Endpoint`))
      .catch((err) => console.error(`❌ Background: VPS forward failed for ${shop}:`, err.message));

    return new Response();
  } catch (error: any) {
    console.error("❌ Checkout webhook processing failed:", error?.message || error);
    return new Response("Webhook processing failed", { status: 400 });
  }
};
