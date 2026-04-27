import "@shopify/shopify-app-remix/adapters/node";
import axios from "axios";
import type { Session } from "@shopify/shopify-app-remix/server";
import { AppDistribution, DeliveryMethod, LATEST_API_VERSION, shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import './cron/tokenRefreshCron';

// Axios instance for communication with your external server
const publicInstance = axios.create({
  baseURL: `${process.env.SHOPIFY_CHATASBOT_SERVER_URI}/api/v1`,
  headers: { "Content-Type": "application/json" },
});

// Shopify app configuration
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: LATEST_API_VERSION,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  useOnlineTokens: false,  // This ensures offline tokens are used
  webhooks: {
    "app/uninstalled": {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: `${process.env.SHOPIFY_CHATASBOT_SERVER_URI}/webhooks/app/uninstalled`,
    },
    "checkouts/create": {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/checkouts",
    },
    "checkouts/update": {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/checkouts",
    },
    "orders/create": {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      console.log(`👉 Running afterAuth hook | {shop: ${session.shop}}`);
      console.log(`👉 Attempting to register webhooks...`);
      const registration = await shopify.registerWebhooks({ session });
      console.log("---------------------------------------------------");
      console.log("WEBHOOK REGISTRATION DETAILS:");
      console.log(JSON.stringify(registration, null, 2));
      console.log("---------------------------------------------------");
      console.log(`✅ Webhooks registered successfully for shop: ${session.shop}`);

      // Manually check and upsert the session to ensure the latest access token is saved
      try {
        const existingSession = await prisma.session.findFirst({
          where: { shop: session.shop },
        });

        if (existingSession) {
          console.log(`Session exists for shop ${session.shop}, updating token...`);
          await prisma.session.updateMany({
            where: { shop: session.shop },
            data: {
              accessToken: session.accessToken,
              expires: session.expires,
              isOnline: session.isOnline,
              scope: session.scope,
              state: session.state,
            },
          });
          console.log(`✅ Session updated successfully for shop: ${session.shop} : access token: ${session.accessToken}`);
        } else {
          console.log(`No session found for shop ${session.shop}, creating new...`);
          await prisma.session.create({
            data: {
              id: session.id,
              shop: session.shop,
              accessToken: session.accessToken,
              expires: session.expires,
              isOnline: session.isOnline,
              scope: session.scope,
              state: session.state,
            },
          });
        }
      } catch (error) {
        console.error(`Failed to manually upsert session for shop ${session.shop}:`, error);
      }

    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

// Callback function after successful authentication
async function yourNodeServerCallback(session: Session) {
  console.log(session, 'session from Shopify');
  try {
    // Double check that we're only processing offline tokens
    if (session.isOnline) {
      console.log('🚨 Security check: Attempted to send online token to external server');
      return null;
    }

    console.log(`📤 Sending offline token for shop: ${session.shop}`);
    const payload = { session };
    console.log('Request Payload:', JSON.stringify(payload, null, 2));
    console.log('Request Headers:', JSON.stringify({
      Authorization: `Bearer ${process.env.SHOPIFY_CHATASBOT_TOKEN ? '***PRESENT***' : '***MISSING***'}`,
      "Content-Type": "application/json"
    }, null, 2));

    // Sending the session data to an external server
    const response = await publicInstance.post(
      "/shopify/app/redirect",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.SHOPIFY_CHATASBOT_TOKEN}`,
        },
      },
    );

    if (response?.data?.data) {
      console.log('Response Data:', response.data.data);
    } else {
      console.error('Failed to send session data. Full response:', JSON.stringify(response?.data, null, 2));
    }

    return response?.data?.data;
  } catch (error) {
    console.error('Callback to Node.js server failed:', error);
    // You can add more specific error handling here if needed
  }
}

// Handle app uninstallation - removing only session data from the database
async function handleAppUninstall(shop: string) {
  try {
    console.log(`🚨 App uninstalled for shop: ${shop}`);

    // Delete session data related to the uninstalled shop
    await prisma.session.deleteMany({
      where: {
        shop,
      },
    });

    console.log(`Session data removed for shop: ${shop}`);
  } catch (error) {
    console.error(`Failed to remove session data for shop ${shop}:`, error);
  }
}


// Other code...

async function refreshShopifyToken(shop: string, refreshToken: string) {
  const url = `https://${shop}.myshopify.com/admin/oauth/access_token`;

  try {
    const response = await axios.post(url, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;

    // Now update your database with the new access token and refresh token
    await prisma.session.update({
      where: { shop },
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // Set expiry for 24 hours from now
      },
    });

    console.log('Shopify token refreshed successfully');
  } catch (error) {
    console.error('Failed to refresh Shopify token:', error);
  }
}

export { refreshShopifyToken };  // Add this line to export the function



export default shopify;
export const apiVersion = LATEST_API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

