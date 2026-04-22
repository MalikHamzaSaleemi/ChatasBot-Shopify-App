import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import axios from "axios";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log(`👉 CHECKOUT WEBHOOK HIT: ${request.url}`);

  try {
    const { shop, payload, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} for ${shop}`);

    // Extract relevant data for the abandoned cart notification
    const checkoutData = {
      shop,
      topic,
      checkout_id: payload.id,
      cart_token: payload.cart_token,
      email: payload.email,
      phone: payload.phone || payload.customer?.phone || payload.shipping_address?.phone,
      first_name: payload.customer?.first_name || payload.shipping_address?.first_name,
      last_name: payload.customer?.last_name || payload.shipping_address?.last_name,
      abandoned_checkout_url: payload.abandoned_checkout_url,
      total_price: payload.total_price,
      currency: payload.currency,
      line_items: payload.line_items?.map((item: any) => ({
        title: item.title,
        quantity: item.quantity,
        price: item.price,
      })),
    };

    // Forward to ChatAsBot VPS API
    const vpsInstance = axios.create({
      baseURL: `${process.env.SHOPIFY_CHATASBOT_SERVER_URI}/api/v1`,
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SHOPIFY_CHATASBOT_TOKEN}`
      },
    });

    await vpsInstance.post("/shopify/webhook/abandoned-checkout", checkoutData);
    console.log(`✅ Forwarded abandoned checkout data for ${shop} to VPS`);

    return new Response();
  } catch (error: any) {
    console.error("❌ Checkout webhook processing failed:", error?.message || error);
    return new Response("Webhook processing failed", { status: 400 });
  }
};
