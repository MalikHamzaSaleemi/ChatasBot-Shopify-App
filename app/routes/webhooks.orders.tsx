import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import axios from "axios";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log(`👉 ORDER WEBHOOK HIT: ${request.url}`);

  try {
    const { shop, payload, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} for ${shop}`);

    // Extract relevant data for order processing
    const orderData = {
      shop,
      topic,
      order_id: payload.id,
      order_number: payload.order_number,
      email: payload.email,
      phone: payload.phone || payload.customer?.phone || payload.shipping_address?.phone,
      first_name: payload.customer?.first_name || payload.shipping_address?.first_name,
      last_name: payload.customer?.last_name || payload.shipping_address?.last_name,
      total_price: payload.total_price,
      currency: payload.currency,
      tags: payload.tags,
      line_items: payload.line_items?.map((item: any) => ({
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        variant_id: item.variant_id,
      })),
    };

    // Forward to ChatAsBot VPS Universal Webhook Endpoint
    const vpsInstance = axios.create({
      baseURL: `${process.env.SHOPIFY_CHATASBOT_SERVER_URI}`, // Using base URI
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SHOPIFY_CHATASBOT_TOKEN}`,
        "x-shopify-topic": topic,
        "x-shopify-shop-domain": shop
      },
    });

    // We do NOT await this call so we can return 200 OK to Shopify immediately
    vpsInstance.post("/api/webhooks/shopify/public", payload)
      .then(() => console.log(`✅ Background: Forwarded ${topic} for ${shop} to VPS Universal Endpoint`))
      .catch((err) => console.error(`❌ Background: VPS forward failed for ${shop}:`, err.message));

    return new Response();
  } catch (error: any) {
    console.error("❌ Order webhook processing failed:", error?.message || error);
    return new Response("Webhook processing failed", { status: 400 });
  }
};
