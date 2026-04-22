import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { isRouteErrorResponse, useFetcher, useLoaderData, useRevalidator, useRouteError } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "app/shopify.server";

type Rule = {
  id: string;
  original: string;
  renamed: string;
  active: boolean;
  applyHide: boolean;
  applyRename: boolean;
  applyReorder: boolean;
  makeDefault: boolean;
  position: string;
};

function configToRules(config: Record<string, any>): Rule[] {
  const entries = Object.entries(config || {}).filter(([k]) => !k.startsWith("__"));
  if (!entries.length) return [];

  return entries.map(([name, v]: any, i) => ({
    id: `rule-${i}`,
    original: name,
    renamed: v?.newName ?? "",
    active: v?.active !== false,
    applyHide: v?.hidden === true,
    applyRename: v?.rename !== false,
    applyReorder: v?.reorder !== false,
    makeDefault: v?.defaultSelected === true,
    position: String(typeof v?.order === "number" ? v.order : i),
  }));
}

function createRule(index: number, original = ""): Rule {
  return {
    id: `rule-${Date.now()}-${index}`,
    original,
    renamed: "",
    active: true,
    applyHide: false,
    applyRename: false,
    applyReorder: false,
    makeDefault: false,
    position: String(index),
  };
}

function getInitialRules(config: Record<string, any>, detectedPaymentMethods: string[]): Rule[] {
  const fromConfig = configToRules(config);
  // Keep configured rules even when a method is not in quick-pick.
  // This supports custom checkout labels entered manually by the merchant.
  if (fromConfig.length > 0) return fromConfig;
  if (detectedPaymentMethods.length > 0) {
    return detectedPaymentMethods.map((method, index) => createRule(index, method));
  }
  return [createRule(0)];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const response = await admin.graphql(`query {
      translatableResources(first: 50, resourceType: PAYMENT_GATEWAY) {
        nodes { translatableContent { value } }
      }
      orders(first: 100, reverse: true, sortKey: CREATED_AT) {
        edges {
          node {
            paymentGatewayNames
          }
        }
      }
      paymentCustomizations(first: 25) {
        nodes {
          id
          title
          enabled
          metafield(namespace: "$app:chatasbot-renamer-app", key: "function-configuration") { value }
        }
      }
    }`);
    const json = (await response.json()) as any;

    const hasAccessDenied = json.errors?.some((err: any) => err.message?.includes("Access denied"));
    if (hasAccessDenied) {
      return Response.json({
        needsUpdate: true,
        shop: session.shop,
        isEnabled: false,
        config: {},
        detectedPaymentMethods: [],
      });
    }

    const customization = (json.data?.paymentCustomizations?.nodes || []).find((n: any) => n.title === "ChatAsBot Gateway");
    let config: Record<string, any> = {};
    if (customization?.metafield?.value) {
      try {
        config = JSON.parse(customization.metafield.value);
      } catch {}
    }
    const fromTranslatable = (json.data?.translatableResources?.nodes || [])
      .map((n: any) => n.translatableContent?.[0]?.value)
      .filter(Boolean);
    const fromOrders = (json.data?.orders?.edges || [])
      .flatMap((edge: any) => edge?.node?.paymentGatewayNames || [])
      .filter(Boolean);
    const detectedPaymentMethods = Array.from(
      new Map<string, string>(
        [...fromTranslatable, ...fromOrders]
          .filter(Boolean)
          .map((name: string) => [name.trim().toLowerCase(), name.trim()] as [string, string])
      ).values(),
    );

    return Response.json({
      shop: session.shop,
      isEnabled: customization?.enabled ?? false,
      customizationId: customization?.id || null,
      config,
      detectedPaymentMethods,
    });
  } catch (error: any) {
    const isAccessDenied = error?.message?.includes("Access denied") || error?.response?.data?.errors?.[0]?.message?.includes("Access denied");
    return Response.json({
      needsUpdate: isAccessDenied,
      shop: session.shop,
      isEnabled: false,
      customizationId: null,
      config: {},
      detectedPaymentMethods: [],
      error: isAccessDenied
        ? null
        : (error?.message || error?.response?.data?.errors?.[0]?.message || "Failed to load payment configuration."),
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "saveConfig") {
      const configValue = formData.get("config");
      const customizationIdValue = formData.get("customizationId");
      const config = typeof configValue === "string" ? configValue : "{}";
      const customizationId = typeof customizationIdValue === "string" ? customizationIdValue : "";
      if (!customizationId) return Response.json({ success: false, message: "Activate extension first." });

      const response = await admin.graphql(
        `mutation paymentCustomizationUpdate($id: ID!, $input: PaymentCustomizationInput!) {
          paymentCustomizationUpdate(id: $id, paymentCustomization: $input) {
            userErrors { message }
          }
        }`,
        {
          variables: {
            id: customizationId,
            input: {
              metafields: [{
                namespace: "$app:chatasbot-renamer-app",
                key: "function-configuration",
                type: "json",
                value: config,
              }],
            },
          },
        },
      );
      const json = (await response.json()) as any;
      const topErr = json?.errors?.[0]?.message;
      if (topErr) return Response.json({ success: false, message: topErr });
      const err = json.data?.paymentCustomizationUpdate?.userErrors?.[0]?.message;
      if (err) return Response.json({ success: false, message: err });
      return Response.json({ success: true, message: "Saved." });
    }

    const fnRes = await admin.graphql(`query { shopifyFunctions(first: 100) { nodes { id title apiType } } }`);
    const fnJson = (await fnRes.json()) as any;
    const fnTopErr = fnJson?.errors?.[0]?.message;
    if (fnTopErr) return Response.json({ success: false, message: fnTopErr });
    const functionNodes = fnJson.data?.shopifyFunctions?.nodes || [];
    const normalize = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    const fn =
      functionNodes.find((n: any) => n.title === "ChatAsBot-renamer-App") ||
      functionNodes.find((n: any) => n.apiType === "PAYMENT_CUSTOMIZATION" && normalize(n.title || "") === normalize("ChatAsBot-renamer-App")) ||
      functionNodes.find((n: any) => n.apiType === "PAYMENT_CUSTOMIZATION" && normalize(n.title || "").includes("chatasbotrenamerapp")) ||
      functionNodes.find((n: any) => n.apiType === "PAYMENT_CUSTOMIZATION");

    if (!fn) {
      return Response.json({
        success: false,
        message: "Function not found. Deploy the extension first (shopify app deploy), then try Activate again.",
      });
    }

    const listRes = await admin.graphql(`query { paymentCustomizations(first: 50) { nodes { id title } } }`);
    const listJson = (await listRes.json()) as any;
    const listTopErr = listJson?.errors?.[0]?.message;
    if (listTopErr) return Response.json({ success: false, message: listTopErr });
    const existing = listJson.data?.paymentCustomizations?.nodes?.find((n: any) => n.title === "ChatAsBot Gateway");

    if (actionType === "deactivate" && existing?.id) {
      await admin.graphql(`mutation($id: ID!) { paymentCustomizationUpdate(id: $id, paymentCustomization: { enabled: false }) { paymentCustomization { id } } }`, { variables: { id: existing.id } });
      return Response.json({ success: true, message: "Deactivated." });
    }

    if (existing?.id) {
      await admin.graphql(`mutation($id: ID!) { paymentCustomizationUpdate(id: $id, paymentCustomization: { enabled: true }) { paymentCustomization { id } } }`, { variables: { id: existing.id } });
      return Response.json({ success: true, message: "Activated." });
    }

    const create = await admin.graphql(
      `mutation($input: PaymentCustomizationInput!) {
        paymentCustomizationCreate(paymentCustomization: $input) {
          userErrors { message }
        }
      }`,
      { variables: { input: { title: "ChatAsBot Gateway", enabled: true, functionId: fn.id } } },
    );
    const createJson = (await create.json()) as any;
    const createTopErr = createJson?.errors?.[0]?.message;
    if (createTopErr) return Response.json({ success: false, message: createTopErr });
    const err = createJson.data?.paymentCustomizationCreate?.userErrors?.[0]?.message;
    if (err) return Response.json({ success: false, message: err });
    return Response.json({ success: true, message: "Activated." });
  } catch (error: any) {
    return Response.json({
      success: false,
      message:
        error?.message ||
        error?.response?.data?.errors?.[0]?.message ||
        "Payment configuration request failed.",
    });
  }
};

export default function PaymentConfigPage() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<any>();
  const revalidator = useRevalidator();

  const [rules, setRules] = useState<Rule[]>(() => getInitialRules(loaderData.config || {}, loaderData.detectedPaymentMethods || []));
  const [isEnabled, setIsEnabled] = useState(Boolean(loaderData.isEnabled));
  const methodsDetectedCount = loaderData.detectedPaymentMethods.length;
  const hasCustomization = Boolean(loaderData.customizationId);
  const pendingActionType = fetcher.formData?.get("actionType");
  const isActivating = fetcher.state !== "idle" && pendingActionType === "enable";
  const isDeactivating = fetcher.state !== "idle" && pendingActionType === "deactivate";
  const isSaving = fetcher.state !== "idle" && pendingActionType === "saveConfig";
  let setupStep = 3;
  if (!isEnabled) {
    setupStep = 1;
  } else if (!hasCustomization) {
    setupStep = 2;
  }
  const [alertMessage, setAlertMessage] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [pendingSuccessMessage, setPendingSuccessMessage] = useState<string | null>(null);
  const handledResponseKeyRef = useRef<string | null>(null);
  const hasInitializedRulesRef = useRef(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const normalizedOriginals = rules
    .map((rule) => rule.original.trim().toLowerCase())
    .filter(Boolean);
  const hasDuplicateMethods = new Set(normalizedOriginals).size !== normalizedOriginals.length;

  useEffect(() => {
    setIsEnabled(Boolean(loaderData.isEnabled));

    // Preserve unsaved edits during normal revalidation.
    // Only hydrate rules initially or after explicit manual refresh.
    if (!hasInitializedRulesRef.current || isManualRefreshing) {
      setRules(getInitialRules(loaderData.config || {}, loaderData.detectedPaymentMethods || []));
      hasInitializedRulesRef.current = true;
      setIsManualRefreshing(false);
    }
  }, [loaderData.isEnabled, loaderData.config, loaderData.detectedPaymentMethods, isManualRefreshing]);

  useEffect(() => {
    if (fetcher.state !== "idle") {
      setAlertMessage(null);
      handledResponseKeyRef.current = null;
      return;
    }

    if (!fetcher.data) return;
    const responseKey = `${String(fetcher.data.success)}:${String(fetcher.data.message ?? "")}`;
    if (handledResponseKeyRef.current === responseKey) return;
    handledResponseKeyRef.current = responseKey;

    if (fetcher.data.success) {
      setPendingSuccessMessage(fetcher.data.message || "Saved.");
      revalidator.revalidate();
      return;
    }

    if (fetcher.data.message) {
      setAlertMessage({ tone: "critical", text: fetcher.data.message });
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  useEffect(() => {
    if (!pendingSuccessMessage) return;
    if (revalidator.state !== "idle" || fetcher.state !== "idle") return;

    setAlertMessage({ tone: "success", text: pendingSuccessMessage });
    setPendingSuccessMessage(null);
  }, [pendingSuccessMessage, revalidator.state, fetcher.state]);

  const save = () => {
    if (hasDuplicateMethods) {
      setAlertMessage({ tone: "critical", text: "Duplicate payment methods found. Please keep each payment method in only one rule." });
      return;
    }

    const config: Record<string, any> = {};
    for (const r of rules) {
      const key = r.original.trim();
      if (!key) continue;
      config[key] = {
        active: r.active,
        hidden: r.applyHide,
        rename: r.applyRename,
        reorder: r.applyReorder,
        defaultSelected: r.makeDefault,
        newName: r.renamed,
        order: Number.parseInt(r.position || "0", 10) || 0,
      };
    }
    const form = new FormData();
    form.append("actionType", "saveConfig");
    form.append("config", JSON.stringify(config));
    form.append("customizationId", loaderData.customizationId || "");
    fetcher.submit(form, { method: "post" });
  };

  const refreshMethods = () => {
    setIsManualRefreshing(true);
    setAlertMessage(null);
    revalidator.revalidate();
  };

  return (
    <Page>
      <TitleBar title="Payment Rename" />
      <Layout>
        <Layout.Section>
          {loaderData.needsUpdate && (
            <Banner tone="warning" title="Permissions update required">
              <p>This feature requires `read_translations` and payment customization scopes.</p>
              <Button url={`/auth?shop=${loaderData.shop}`} target="_top">Update App Permissions</Button>
            </Banner>
          )}

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h5">Payment checkout customization</Text>
              <Text as="p" tone="subdued">
                Rename, reorder, hide, and set default payment methods. You can prepare rules before activating.
              </Text>

              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h6" variant="headingSm">Setup progress</Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Button
                        size="slim"
                        variant="plain"
                        loading={isManualRefreshing || revalidator.state !== "idle"}
                        onClick={refreshMethods}
                      >
                        Refresh methods
                      </Button>
                      <Badge tone={isEnabled ? "success" : "attention"}>
                        {isEnabled ? "Extension active" : "Extension inactive"}
                      </Badge>
                    </InlineStack>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    Detected payment methods: <strong>{methodsDetectedCount}</strong>
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: "8px",
                    }}
                  >
                    <div style={{ padding: "8px", borderRadius: "8px", background: setupStep >= 1 ? "#e3f1df" : "#f1f2f4" }}>
                      <Text as="p" variant="bodySm">1. Activate extension</Text>
                    </div>
                    <div style={{ padding: "8px", borderRadius: "8px", background: setupStep >= 2 ? "#e3f1df" : "#f1f2f4" }}>
                      <Text as="p" variant="bodySm">2. Configure rules</Text>
                    </div>
                    <div style={{ padding: "8px", borderRadius: "8px", background: setupStep >= 3 ? "#e3f1df" : "#f1f2f4" }}>
                      <Text as="p" variant="bodySm">3. Save and test checkout</Text>
                    </div>
                  </div>
                </BlockStack>
              </Card>
              <details
                style={{
                  border: "1px solid #d9d9d9",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  background: "#ffffff",
                }}
              >
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>How to use this extension</summary>
                <div style={{ marginTop: "10px" }}>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      <strong>Quick start</strong>
                    </Text>
                    <ul style={{ margin: 0, paddingLeft: "18px" }}>
                      <li><Text as="span" tone="subdued">Activate extension</Text></li>
                      <li><Text as="span" tone="subdued">Add one rule per payment method</Text></li>
                      <li><Text as="span" tone="subdued">Save and test checkout</Text></li>
                    </ul>

                    <Text as="p" variant="bodySm">
                      <strong>Main options</strong>
                    </Text>
                    <ul style={{ margin: 0, paddingLeft: "18px" }}>
                      <li><Text as="span" tone="subdued"><strong>Rule is active</strong>: Turn this rule on/off</Text></li>
                      <li><Text as="span" tone="subdued"><strong>Hide at checkout</strong>: Remove method from checkout</Text></li>
                      <li><Text as="span" tone="subdued"><strong>Rename display title</strong>: Show a custom method name</Text></li>
                      <li><Text as="span" tone="subdued"><strong>Set position</strong>: Move method order (smaller = higher)</Text></li>
                      <li><Text as="span" tone="subdued"><strong>Set as default</strong>: Try to preselect one method</Text></li>
                    </ul>
                  </BlockStack>
                </div>
              </details>

              {!isEnabled && (
                <Banner tone="warning" title="Extension is not active">
                  <BlockStack gap="200">
                    <Text as="p" tone="subdued">
                      Activate once, then create and save your payment rules.
                    </Text>
                    <div style={{ width: "fit-content", justifySelf: "start" }}>
                      <Button loading={isActivating} disabled={isDeactivating} onClick={() => { fetcher.submit({ actionType: "enable" }, { method: "post" }); }}>
                        Activate Extension
                      </Button>
                    </div>
                  </BlockStack>
                </Banner>
              )}

              {isEnabled && rules.map((rule, index) => (
                <Card key={rule.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="h6" variant="headingSm">Rule #{index + 1}</Text>
                      <Button tone="critical" variant="plain" onClick={() => setRules(rules.filter((_, i) => i !== index))}>Remove</Button>
                    </InlineStack>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: "12px",
                        alignItems: "start",
                      }}
                    >
                    <Select
                        label="Quick pick"
                      options={[
                        {
                          label:
                            rule.original &&
                            !loaderData.detectedPaymentMethods.includes(rule.original)
                              ? "Custom"
                              : "Select detected method",
                          value: "",
                        },
                        ...loaderData.detectedPaymentMethods
                          .filter((method: string) => {
                            const normalizedMethod = method.trim().toLowerCase();
                            const selectedByAnotherRule = rules.some(
                              (x, i) => i !== index && x.original.trim().toLowerCase() === normalizedMethod,
                            );
                            return !selectedByAnotherRule || rule.original.trim().toLowerCase() === normalizedMethod;
                          })
                          .map((method: string) => ({ label: method, value: method })),
                      ]}
                        value={loaderData.detectedPaymentMethods.includes(rule.original) ? rule.original : ""}
                        onChange={(v) => {
                          if (!v) return;
                          setRules(rules.map((x, i) => (i === index ? { ...x, original: v } : x)));
                        }}
                      />
                      <TextField
                        label="Original name"
                        value={rule.original}
                        onChange={(v) => setRules(rules.map((x, i) => (i === index ? { ...x, original: v } : x)))}
                        helpText="You can type a custom checkout payment name not listed in Quick pick."
                        autoComplete="off"
                      />
                    </div>
                    <Divider />
                    <BlockStack gap="200">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: "8px 12px",
                          alignItems: "center",
                        }}
                      >
                        <Checkbox label="Rule is active" checked={rule.active} onChange={(v) => setRules(rules.map((x, i) => (i === index ? { ...x, active: v } : x)))} />
                        <Checkbox label="Hide at checkout" checked={rule.applyHide} onChange={(v) => setRules(rules.map((x, i) => (i === index ? { ...x, applyHide: v } : x)))} />
                      </div>
                      <Checkbox label="Rename display title" checked={rule.applyRename} onChange={(v) => setRules(rules.map((x, i) => (i === index ? { ...x, applyRename: v } : x)))} />
                      {rule.applyRename && (
                        <TextField
                          label="New name"
                          value={rule.renamed}
                          onChange={(v) => setRules(rules.map((x, i) => (i === index ? { ...x, renamed: v } : x)))}
                          autoComplete="off"
                        />
                      )}
                      <Checkbox label="Set position" checked={rule.applyReorder} onChange={(v) => setRules(rules.map((x, i) => (i === index ? { ...x, applyReorder: v } : x)))} />
                      {rule.applyReorder && (
                        <TextField
                          label="Position"
                          type="number"
                          value={rule.position}
                          onChange={(v) => setRules(rules.map((x, i) => (i === index ? { ...x, position: v } : x)))}
                          autoComplete="off"
                        />
                      )}
                      <Checkbox label="Set as default" checked={rule.makeDefault} onChange={(v) => setRules(rules.map((x, i) => ({ ...x, makeDefault: i === index ? v : false })))} />
                    </BlockStack>
                  </BlockStack>
                </Card>
              ))}

              {isEnabled && (
                <InlineStack gap="300">
                  <Button onClick={() => setRules([...rules, createRule(rules.length)])}>Add New Rule</Button>
                  <Button variant="primary" onClick={save} loading={isSaving} disabled={!hasCustomization || isActivating || isDeactivating || hasDuplicateMethods}>Save Changes</Button>
                  <div style={{ marginLeft: "auto" }}>
                    <Button tone="critical" loading={isDeactivating} disabled={isActivating} onClick={() => { fetcher.submit({ actionType: "deactivate" }, { method: "post" }); }}>Deactivate Extension</Button>
                  </div>
                </InlineStack>
              )}

              {hasDuplicateMethods && (
                <Banner tone="critical" title="Duplicate payment method">
                  <p>Each payment method can be used once only. Change duplicate rules before saving.</p>
                </Banner>
              )}

              {!hasCustomization && (
                <Banner tone="info" title="Activate to save configuration">
                  <p>Rules are ready. Click <strong>Activate Extension</strong> first, then save your configuration.</p>
                </Banner>
              )}

              {loaderData.error && (
                <Banner tone="critical" title="Failed to load payment rename data">
                  <p>{loaderData.error}</p>
                </Banner>
              )}

              {alertMessage && (
                <Banner tone={alertMessage.tone}>{alertMessage.text}</Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  let title = "Payment Rename failed to render";
  let details = "Unexpected UI error. Please refresh and check logs.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    details = typeof error.data === "string" ? error.data : JSON.stringify(error.data);
  } else if (error instanceof Error) {
    details = error.message;
  }

  return (
    <Page>
      <TitleBar title="Payment Rename" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd" tone="critical">
                {title}
              </Text>
              <Text as="p" tone="subdued">
                {details}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
