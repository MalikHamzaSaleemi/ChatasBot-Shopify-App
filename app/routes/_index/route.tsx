import {
  Page,
  Card,
  Text,
  BlockStack,
  Banner,
  DescriptionList,
} from "@shopify/polaris";
import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {

  return (
    <Page title="ChatAsBot – Smart Order Notifications" fullWidth>
      <BlockStack gap="400">
        <Banner title="Stay Connected with Your Customers" onDismiss={() => { }}>
          <Text as="p" tone="subdued">
            ChatAsBot keeps your customers updated automatically — from order
            confirmation to delivery — all through automated triggers!livery and feedback reminders.
            All notifications are sent directly through WhatsApp, Instagram, or Messenger.
          </Text>
        </Banner>

        <Card>
          <Text as="p" variant="bodyMd">
            To connect your store, please install this app directly from the Shopify App Store or open it from your Shopify Admin.
          </Text>

          <DescriptionList
            items={[
              {
                term: 'Order Confirmations',
                description:
                  'Automatically notify customers when their order is placed — instantly and reliably.',
              },
              {
                term: 'Shipping Updates',
                description:
                  'Send real-time updates when an order is packed, shipped, or out for delivery.',
              },
              {
                term: 'Delivery Alerts',
                description:
                  'Confirm successful delivery or inform customers of any delays with friendly automated messages.',
              },
              {
                term: 'Customer Feedback',
                description:
                  'Collect feedback or ratings after delivery to improve service quality and customer experience.',
              },
              {
                term: 'Smart Chat Sync',
                description:
                  'AI-powered assistant keeps track of all order chats, tags them, and syncs them with your store dashboard.',
              },
            ]}
          />
        </Card>
      </BlockStack>
    </Page>
  );

}
