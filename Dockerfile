FROM node:22.15.1-alpine3.20

RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV SHOPIFY_APP_URL=https://cab.chatasbot.com
ENV SHOPIFY_API_KEY=cd653c249292b78010f157bf4b4d21c8
ENV SHOPIFY_API_SECRET=""
ENV SHOPIFY_REDIRECT_URI=https://cab.chatasbot.com/auth/shopify/callback
ENV SCOPES=read_assigned_fulfillment_orders,read_draft_orders,read_merchant_managed_fulfillment_orders,read_order_edits,read_orders,read_product_feeds,read_product_listings,read_products,read_publications,write_assigned_fulfillment_orders,write_draft_orders,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_product_feeds,write_product_listings,write_products,write_publications
ENV SHOPIFY_CHATASBOT_SERVER_URI=https://live.chatasbot.com
#ENV SHOPIFY_CHATASBOT_SERVER_URI=https://dev.chatasbot.com
ENV SHOPIFY_CHATASBOT_TOKEN=""

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force
# Remove CLI packages since we don't need them in production by default.
# Remove this line if you want to run CLI commands in your container.
RUN npm remove @shopify/cli

COPY . .

RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "docker-start"]


