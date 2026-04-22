import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    const action = url.searchParams.get("action");
    if (action === "delete") {
      await db.session.deleteMany({ where: { shop } });
      return new Response(`✅ Manually DELETED session for ${shop}`);
    }

    const sessions = await db.session.findMany({ where: { shop } });
    const details = sessions.map((s: any) => `ID: ${s.id}, Shop: ${s.shop}, Online: ${s.isOnline}`).join("\n");
    return new Response(
      sessions.length > 0
        ? `Session FOUND for ${shop} (Count: ${sessions.length})\n${details}`
        : `Session NOT FOUND for ${shop}`
    );
  }

  console.log("👉 WEBHOOK ROUTE HIT (GET): /webhooks/app/uninstalled");
  return new Response("Webhook route is working! Add ?shop=your-shop.myshopify.com to check DB.");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("👉 WEBHOOK ROUTE HIT: /webhooks/app/uninstalled");

  try {
    const { shop, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    await db.session.deleteMany({ where: { shop } });
    console.log(`✅ Session deleted successfully for shop: ${shop}`);

    return new Response();
  } catch (error) {
    console.error("❌ Webhook processing failed:", error);

    // Fallback: If authentication fails, try to extract shop from headers and delete anyway
    const shop = request.headers.get("X-Shopify-Shop-Domain");
    if (shop) {
      console.log(`⚠️ Authentication failed, but attempting force delete for shop: ${shop}`);
      await db.session.deleteMany({ where: { shop } });
      console.log(`✅ FORCE DELETED session for shop: ${shop}`);
      return new Response("Force deleted session", { status: 200 });
    }

    return new Response(`Webhook action hit! Error: ${error}`, { status: 400 });
  }
};
