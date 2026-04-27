import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Toast,
  TextField,
  Frame,
  EmptyState,
  Icon,
  Banner,
  Badge,
  SkeletonPage,
  SkeletonBodyText,
  Link,
  InlineStack,
  Tooltip,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import axios from "axios";
import {
  ArrowRightIcon,
  ExternalIcon,
  ClipboardIcon,
} from '@shopify/polaris-icons';

import { authenticate } from "app/shopify.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";

/**
 *
 *
 *
 *
 * ~ Loader function
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Add a guard to prevent calling authenticate.admin() from the login path
  // console.log("loader function is executing")
  const { session } = await authenticate.admin(request);
  const shop_id = session.id;
  const publicInstance = axios.create({
    baseURL: `${process.env.SHOPIFY_CHATASBOT_SERVER_URI}/api/v1`,
    headers: { "Content-Type": "application/json" },
  });
  try {
    const response = await publicInstance.post(
      "/shopify/app/integration-check",
      { shop_id },
      {
        headers: {
          Authorization: `Bearer ${process.env.SHOPIFY_CHATASBOT_TOKEN}`,
        },
      },
    );
    if (response.status === 200 && response.data.is_success) {
      return Response.json({ data: response.data, error: null });
    }
    return Response.json({
      data: null,
      error: Array.isArray(response?.data?.message)
        ? response?.data?.message[0]?.msg
        : (response?.data?.message ?? "Integration check failed."),
    });
  } catch (error: any) {
    const isReinstalled = error?.response?.data?.data?.is_reinstalled ?? false;
    const errorMessage = error?.response?.data?.data?.message;
    // console.log(error);
    return Response.json({
      data: null,
      error: errorMessage,
      is_reinstalled: isReinstalled,
    });
  }
};


/**
 *
 *
 *
 *
 * ~ action function
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop_id = session.id;
  const formData = await request.formData();
  // console.log("form data", formData)
  const api_key = formData.get("api_key");
  const publicInstance = axios.create({
    baseURL: `${process.env.SHOPIFY_CHATASBOT_SERVER_URI}/api/v1`,
    headers: { "Content-Type": "application/json" },
  });

  if (!api_key) {
    return Response.json({
      success: false,
      message: "ChatAsBot API key is required.",
    });
  }

  try {
    const response = await publicInstance.post(
      "/shopify/app/installed",
      {
        shop_id,
        integration_token: api_key,
        store_domain: session.shop,
        access_token: session.accessToken,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SHOPIFY_CHATASBOT_TOKEN}`,
        },
      },
    );

    console.log("response is = ", response)
    if (response.status === 200 && response.data.is_success) {
      return Response.json({
        success: true,
        data: response.data.data, // Make sure to return .data to match loader
        error: null,
      });
    }
    return Response.json({
      success: false,
      message: Array.isArray(response?.data?.message)
        ? response?.data?.message[0]?.msg
        : (response?.data?.message ?? "Manual integration failed."),
      data: null,
      error: Array.isArray(response?.data?.message)
        ? response?.data?.message[0]?.msg
        : (response?.data?.message ?? "Manual integration failed."),
    });
  } catch (error: any) {
    console.log(error)
    const errorMessage =
      error?.response?.data?.message ??
      error?.message ??
      "Unexpected error during manual integration.";

    return Response.json({ data: null, error: errorMessage });
  }
};


/**
 *
 *
 *
 *
 * ~ default component
 */
export default function Index() {
  const {
    data: loaderData,
    error: loaderError,
  } = useLoaderData<typeof loader>();

  // console.log("Loader Data:", loaderData);

  const fetcher = useFetcher<typeof action>();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const statusFromUrl = searchParams.get("status");
  const messageFromUrl = searchParams.get("message");

  // Move all hooks to the top, before any conditional returns
  // const [currentModalOpen, setCurrentModalOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [toastContent, setToastContent] = useState<string | null>(null);
  // const [showReinstallModal, setShowReinstallModal] = useState(
  //   is_reinstalled ?? false,
  // );
  const [step, setStep] = useState(1);
  const [imgLoaded, setImgLoaded] = useState(false);
  const navigate = useNavigate();

  // useEffect(() => {
  //   setShowReinstallModal(is_reinstalled ?? false);
  // }, [is_reinstalled]);

  useEffect(() => {
    if (statusFromUrl && messageFromUrl) {
      setToastContent(`${statusFromUrl}: ${messageFromUrl}`);
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState({}, document.title, url.toString());
    }
  }, [statusFromUrl, messageFromUrl]);

  useEffect(() => {
    const img = new Image();
    img.src =
      "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
    img.onload = () => {
      setImgLoaded(true);
    };
  }, []);

  useEffect(() => {
    if (fetcher.data) {
      setToastContent(
        fetcher.data.success
          ? "Integration successful!"
          : (fetcher.data.message ?? "Failed to get the shop information. Please try again later or contact support."),
      );
      if (fetcher.data.success) {
        // setCurrentModalOpen(false);
        setApiKey("");
        navigate(".", { replace: true });
      }
    }
  }, [fetcher.data, navigate]);

  // const openReconnectModal = () => {
  //   setApiKey("");
  //   // setCurrentModalOpen(true);
  // };

  // Replace handleApiKeySubmit to use fetcher.submit
  const handleApiKeySubmit = () => {
    const formData = new FormData();
    formData.append("api_key", apiKey);
    const currentUrl = new URL(window.location.href);
    const shop = currentUrl.searchParams.get("shop");
    const actionPath = shop ? `/app?index&shop=${encodeURIComponent(shop)}` : "/app?index";
    fetcher.submit(formData, { method: "post", action: actionPath });
  };

  // Dashboard UI for successful connection
  const renderDashboard = () => (
    <>
      <TitleBar title="ChatAsBot" />
      <Page
        title="Dashboard"
        titleMetadata={<Badge tone="success">Connected</Badge>}
        fullWidth
      >
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              <Banner
                tone="info"
                title="ChatAsBot Integration"
                onDismiss={() => { }}
              >
                <p>Your ChatAsBot account is successfully connected.</p>
                <div style={{ marginTop: "10px" }}>
                  <Button
                    variant="primary"
                    icon={ExternalIcon}
                    onClick={() => window.open("https://chatasbot.com/", "_blank")}
                  >Goto ChatAsBot</Button>
                </div>
              </Banner>
            </Layout.Section>
          </Layout>
          <Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h5">Connection Status</Text>
                  <Text as="p">
                    <strong>Status:</strong> {loaderData?.is_success ? <Badge tone="success">Connected</Badge> : "Not Connected"}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            {/* <Layout.Section variant="oneThird">
            <Card>
              <Text variant="headingMd" as="h5">Today Activity</Text>
            </Card>
          </Layout.Section> */}

          </Layout>
          {/* --- Test Credentials Card --- */}
          {/* <TestCredentialsCard onCopy={handleCopy} /> */}
        </BlockStack>
      </Page>
    </>

  );

  const isConnected = fetcher.data?.success || loaderData?.is_success;

  function handleCopy(text: string): void {
    navigator.clipboard.writeText(text)
      .then(() => setToastContent("Copied to clipboard!"))
      .catch(() => setToastContent("Failed to copy."));
  }

  // Remove all early returns before hooks, instead use conditional rendering inside return
  return (
    <Frame>
      {isConnected ? (
        <>
          {renderDashboard()}
          {(toastContent || fetcher.data?.success) && (
            <Toast
              content={toastContent || (fetcher.data?.success ? "Integration successful!" : "")}
              error={
                (toastContent && (toastContent?.toLowerCase()?.includes("fail") ||
                  toastContent?.toLowerCase()?.includes("error"))) ||
                fetcher.data?.success === false
              }
              onDismiss={() => setToastContent(null)}
            />
          )}
        </>
      ) : !imgLoaded ? (
        <SkeletonPage fullWidth>
          <Card>
            <EmptyState image="">
              <SkeletonBodyText lines={3} />
              Loading...
            </EmptyState>
          </Card>
        </SkeletonPage>
      ) : (
        <Page title="Connect ChatAsBot" fullWidth>
          <TitleBar title="ChatAsBot" />
          <Card>
            {step === 1 && (
              <EmptyState
                heading="Connect ChatAsBot"
                action={{
                  content: `Connect ChatAsBot`,
                  icon: ArrowRightIcon,
                  onAction: () => setStep(2),
                }}
                secondaryAction={{
                  content: `I don't have an account`,
                  url: "https://chatasbot.com/signup",
                  icon: ExternalIcon,
                  target: "_blank",
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Connect your ChatAsBot account to automatically sync your ChatAsBot orders with Shopify.
                </p>
              </EmptyState>
            )}

            {step === 2 && (
              <EmptyState
                heading="ChatAsBot API Key"
                action={{
                  content: fetcher.state === "submitting" ? "Connecting..." : "Connect",
                  onAction: handleApiKeySubmit,
                  loading: fetcher.state === "submitting",
                }}
                secondaryAction={{
                  content: `Generate API Key`,
                  url: "https://live.chatasbot.com/dashboard/apikeys/",
                  icon: ExternalIcon,
                  target: "_blank",
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <BlockStack gap="500">
                  <p>Your secure token connects ChatAsBot to Shopify</p>
                  <TextField
                    name="api_key"
                    label="ChatAsBot API Key"
                    type="text"
                    value={apiKey}
                    onChange={setApiKey}
                    autoComplete="off"
                    placeholder="Enter your ChatAsBot API Key"
                    disabled={fetcher.state === "submitting"}
                  />
                  <InlineStack gap="200" align="center">
                    <Text as="p">Need help finding your API Key?</Text>
                    <Link url="https://chatasbot.com/blog/how-to-generate-a-chatasbot-api-key-step-by-step-guide-for-shopify-integration/" target="_blank">
                      <InlineStack gap="100" align="center">
                        View Guideline
                        <Icon source={ExternalIcon} />
                      </InlineStack>
                    </Link>
                  </InlineStack>

                  {/* --- Test Credentials Card --- */}
                  {/* <TestCredentialsCard onCopy={handleCopy} /> */}

                  {fetcher.data?.success === false && (
                    <Text as="p" tone="critical">
                      {fetcher.data.message}
                    </Text>
                  )}
                </BlockStack>
              </EmptyState>
            )}
          </Card>
          {toastContent && (
            <Toast
              content={toastContent}
              error={
                toastContent?.toLowerCase()?.includes("fail") ||
                toastContent?.toLowerCase()?.includes("error")
              }
              onDismiss={() => setToastContent(null)}
            />
          )}
        </Page>
      )}
    </Frame>
  );
}

const TEST_CREDENTIALS = [
  { label: "User", value: "3173337425" },
  { label: "Pass", value: "ChatAsBot25#" },
];

export function TestCredentialsCard({ onCopy }: { onCopy: (text: string) => void }) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingMd" as="h5">Test Credentials</Text>
        <Text as="p" tone="subdued">
          Use these credentials for testing ChatAsBot integration.
        </Text>
        <BlockStack gap="200">
          {TEST_CREDENTIALS.map((cred) => (
            <InlineStack gap="100" align="center" key={cred.label}>
              <Badge tone="info">{cred.label}</Badge>
              <div style={{ minWidth: 220 }}>
                {cred.label === "User" ? (
                  <Tooltip
                    content="Please choose country Pakistan, then paste this number. This is a Pakistani mobile number."
                    preferredPosition="above"
                  >
                    <TextField
                      value={cred.value}
                      label=""
                      readOnly
                      autoComplete="off"
                      connectedRight={
                        <Button
                          icon={ClipboardIcon}
                          variant="tertiary"
                          onClick={() => onCopy(cred.value)}
                          accessibilityLabel={`Copy ${cred.label}`}
                        />
                      }
                    />
                  </Tooltip>
                ) : (
                  <TextField
                    value={cred.value}
                    label=""
                    readOnly
                    autoComplete="off"
                    connectedRight={
                      <Button
                        icon={ClipboardIcon}
                        variant="tertiary"
                        onClick={() => onCopy(cred.value)}
                        accessibilityLabel={`Copy ${cred.label}`}
                      />
                    }
                  />
                )}
              </div>
            </InlineStack>
          ))}
        </BlockStack>
        {/* Add note below User field */}
        <div style={{ marginTop: 8 }}>
          <Text as="p" tone="critical" variant="bodySm">
            For <strong>User</strong>: Please choose country <strong>Pakistan</strong> then paste this number, as it is a Pakistani mobile number (<strong>3173337425</strong>).
          </Text>
        </div>
      </BlockStack>
    </Card>
  );
}
