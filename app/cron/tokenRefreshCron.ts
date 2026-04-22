import cron from 'node-cron';
import { refreshShopifyToken } from '../shopify.server';  // Adjust the import path
import prisma from '../db.server';  // Ensure correct path to prisma

// Cron job to refresh Shopify token every 24 hours (at midnight)
cron.schedule('*/2 * * * *', async () => {
  try {
    // Get all sessions where the expiration date is in the next 24 hours or has already passed
    const currentTime = new Date();
    const expiryThreshold = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

    const shopsToRefresh = await prisma.session.findMany({
      where: {
        expires: {
          lte: expiryThreshold, // Expiry date is less than or equal to 24 hours from now
        },
      },
    });

    for (const shop of shopsToRefresh) {
      const refreshToken = shop.refreshToken;

      if (refreshToken) {
        await refreshShopifyToken(shop.shop, refreshToken);  // Call the refresh function
      } else {
        console.log(`No refresh token found for shop: ${shop.shop}`);
      }
    }

    console.log('Shopify tokens refreshed successfully for all expired or soon-to-expire tokens.');
  } catch (error) {
    console.error('Error refreshing Shopify tokens:', error);
  }
});
