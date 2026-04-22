import { TitleBar } from "@shopify/app-bridge-react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { isRouteErrorResponse, useLoaderData, useLocation, useNavigation, useRouteError, useSearchParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  TextField,
  Text,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { authenticate } from "app/shopify.server";

type StatRow = {
  method: string;
  orders: number;
  revenue: number;
  share: number;
};
type ComparisonRow = {
  method: string;
  currentOrders: number;
  previousOrders: number;
  currentRevenue: number;
  previousRevenue: number;
  orderDeltaPct: number;
  revenueDeltaPct: number;
};

function rangeToDays(value: string | null): number {
  if (value === "7") return 7;
  if (value === "90") return 90;
  return 30;
}

function percentageDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function isIsoDate(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const safeEmpty = (days: number, message: string) =>
    Response.json({
      days,
      currency: "USD",
      totalOrders: 0,
      totalRevenue: 0,
      previousTotalOrders: 0,
      previousTotalRevenue: 0,
      orderDelta: 0,
      revenueDelta: 0,
      aovDelta: 0,
      cancelledRate: 0,
      refundedRate: 0,
      refundedOrders: 0,
      refundedAmount: 0,
      averageOrderValue: 0,
      topMethod: "N/A",
      topMethodOrders: 0,
      stats: [],
      comparison: [],
      countrySplit: [],
      aovByMethod: [],
      hourlyOrders: Array.from({ length: 24 }, () => 0),
      alerts: [],
      refundCancelByMethod: [],
      customerMixByMethod: [],
      ruleImpactSnapshot: {
        configuredMethods: 0,
        configuredOrders: 0,
        configuredRevenue: 0,
        configuredShare: 0,
        unconfiguredOrders: 0,
        unconfiguredRevenue: 0,
        unconfiguredShare: 0,
      },
      error: message,
      rangeValue: "30",
      customStart: null,
      customEnd: null,
      needsUpdate: message.includes("Access denied"),
      shop: "",
      appUrl: process.env.SHOPIFY_APP_URL || "https://chatasbot.com",
    });

  const url = new URL(request.url);
  const rangeParam = url.searchParams.get("days");
  const customStartParam = url.searchParams.get("start");
  const customEndParam = url.searchParams.get("end");
  const hasCustomRange = rangeParam === "custom" && isIsoDate(customStartParam) && isIsoDate(customEndParam);
  const days = hasCustomRange
    ? Math.max(
      1,
      Math.ceil(
        (new Date(`${customEndParam}T00:00:00.000Z`).getTime()
          - new Date(`${customStartParam}T00:00:00.000Z`).getTime()) / 86400000,
      ) + 1,
    )
    : rangeToDays(rangeParam);

  try {
    const { admin, session } = await authenticate.admin(request);

  const now = new Date();
  let currentFromDate = new Date(now);
  currentFromDate.setUTCHours(0, 0, 0, 0);
  currentFromDate.setUTCDate(currentFromDate.getUTCDate() - days);
  let currentToDateExclusive: Date | null = null;

  if (hasCustomRange) {
    currentFromDate = new Date(`${customStartParam}T00:00:00.000Z`);
    currentToDateExclusive = new Date(`${customEndParam}T00:00:00.000Z`);
    currentToDateExclusive.setUTCDate(currentToDateExclusive.getUTCDate() + 1);
  }

  const previousFromDate = new Date(currentFromDate);
  previousFromDate.setUTCDate(previousFromDate.getUTCDate() - days);
  const previousToDateExclusive = new Date(currentFromDate);
  const createdAtFilter = previousFromDate.toISOString();
  const createdAtUpper = currentToDateExclusive?.toISOString();

    const ordersQuery = `#graphql
      query PaymentStatsOrders($query: String!, $after: String) {
        orders(first: 250, after: $after, reverse: true, sortKey: CREATED_AT, query: $query) {
          edges {
            cursor
            node {
              id
              createdAt
              cancelledAt
              paymentGatewayNames
              customer { id }
              billingAddress { countryCodeV2 }
              totalRefundedSet {
                shopMoney {
                  amount
                }
              }
              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
        paymentCustomizations(first: 25) {
          nodes {
            title
            metafield(namespace: "$app:chatasbot-renamer-app", key: "function-configuration") {
              value
            }
          }
        }
      }
    `;

    let allEdges: any[] = [];
    let paymentCustomizationNodes: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let pages = 0;
    while (hasNextPage && pages < 8) {
      const response = await admin.graphql(ordersQuery, {
        variables: {
          query: createdAtUpper
            ? `created_at:>=${createdAtFilter} created_at:<${createdAtUpper}`
            : `created_at:>=${createdAtFilter}`,
          after: cursor,
        },
      });
      const json = (await response.json()) as any;
      const hasAccessDenied = json.errors?.some((err: any) => err.message?.includes("Access denied"));

      if (hasAccessDenied || json?.errors?.length) {
        const msg = json.errors[0]?.message || "Failed to load Shopify analytics data.";
        const empty = safeEmpty(days, msg);
        const data = await empty.json();
        return Response.json({
          ...data,
          needsUpdate: hasAccessDenied,
          shop: session.shop,
        });
      }

      const orders = json.data?.orders;
      const edges = orders?.edges || [];
      allEdges = allEdges.concat(edges);
      hasNextPage = Boolean(orders?.pageInfo?.hasNextPage) && edges.length > 0;
      cursor = hasNextPage ? edges[edges.length - 1]?.cursor || null : null;
      if (!paymentCustomizationNodes.length) {
        paymentCustomizationNodes = json.data?.paymentCustomizations?.nodes || [];
      }
      pages += 1;
    }
    const edges = allEdges;

  const currentByMethod = new Map<string, {
    orders: number;
    revenue: number;
    cancelled: number;
    refundedOrders: number;
    refundedAmount: number;
    guest: number;
    customer: number;
    newCustomer: number;
    returningCustomer: number;
  }>();
  const previousByMethod = new Map<string, { orders: number; revenue: number }>();
  const countryByMethod = new Map<string, { orders: number; revenue: number }>();
  const hourlyOrders = Array.from({ length: 24 }, () => 0);
  let totalOrders = 0;
  let totalRevenue = 0;
  let previousTotalOrders = 0;
  let previousTotalRevenue = 0;
  let cancelledOrders = 0;
  let refundedOrders = 0;
  let refundedAmount = 0;
  let currency = "USD";
  const customerOrderCount = new Map<string, number>();

  for (const edge of edges) {
    const customerId = edge?.node?.customer?.id;
    if (!customerId) continue;
    customerOrderCount.set(customerId, (customerOrderCount.get(customerId) || 0) + 1);
  }

  for (const edge of edges) {
    const node = edge?.node;
    if (!node) continue;

    const createdAt = new Date(node.createdAt);
    const inCurrentRange = currentToDateExclusive
      ? createdAt >= currentFromDate && createdAt < currentToDateExclusive
      : createdAt >= currentFromDate;
    const amount = Number.parseFloat(node.currentTotalPriceSet?.shopMoney?.amount || "0");
    currency = node.currentTotalPriceSet?.shopMoney?.currencyCode || currency;
    const methods: string[] = node.paymentGatewayNames?.length
      ? node.paymentGatewayNames
      : ["Unknown"];
    const methodKey = methods[0];
    const isCancelled = Boolean(node.cancelledAt);
    const orderRefundedAmount = Number.parseFloat(node.totalRefundedSet?.shopMoney?.amount || "0");
    const isRefunded = orderRefundedAmount > 0;
    const isGuest = !node.customer?.id;
    const isReturning = Boolean(node.customer?.id) && (customerOrderCount.get(node.customer.id) || 0) > 1;
    const country = node.billingAddress?.countryCodeV2 || "Unknown";

    if (inCurrentRange) {
      totalOrders += 1;
      totalRevenue += amount;
      if (isCancelled) cancelledOrders += 1;
      if (isRefunded) {
        refundedOrders += 1;
        refundedAmount += orderRefundedAmount;
      }
      hourlyOrders[createdAt.getUTCHours()] += 1;

      const current = currentByMethod.get(methodKey) || {
        orders: 0,
        revenue: 0,
        cancelled: 0,
        refundedOrders: 0,
        refundedAmount: 0,
        guest: 0,
        customer: 0,
        newCustomer: 0,
        returningCustomer: 0,
      };
      current.orders += 1;
      current.revenue += amount;
      if (isCancelled) current.cancelled += 1;
      if (isRefunded) {
        current.refundedOrders += 1;
        current.refundedAmount += orderRefundedAmount;
      }
      if (isGuest) current.guest += 1;
      else {
        current.customer += 1;
        if (isReturning) current.returningCustomer += 1;
        else current.newCustomer += 1;
      }
      currentByMethod.set(methodKey, current);

      const countryKey = `${country}__${methodKey}`;
      const countryCurrent = countryByMethod.get(countryKey) || { orders: 0, revenue: 0 };
      countryCurrent.orders += 1;
      countryCurrent.revenue += amount;
      countryByMethod.set(countryKey, countryCurrent);
    } else if (createdAt >= previousFromDate && createdAt < previousToDateExclusive) {
      previousTotalOrders += 1;
      previousTotalRevenue += amount;
      const previous = previousByMethod.get(methodKey) || { orders: 0, revenue: 0 };
      previous.orders += 1;
      previous.revenue += amount;
      previousByMethod.set(methodKey, previous);
    }
  }

  const stats: StatRow[] = Array.from(currentByMethod.entries())
    .map(([method, values]) => ({
      method,
      orders: values.orders,
      revenue: values.revenue,
      share: totalOrders ? (values.orders / totalOrders) * 100 : 0,
    }))
    .sort((a, b) => b.orders - a.orders);
  const averageOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
  const topMethod = stats[0]?.method ?? "N/A";
  const topMethodOrders = stats[0]?.orders ?? 0;
  const cancelledRate = totalOrders ? (cancelledOrders / totalOrders) * 100 : 0;
  const refundedRate = totalOrders ? (refundedOrders / totalOrders) * 100 : 0;

  const allMethods = new Set<string>([
    ...Array.from(currentByMethod.keys()),
    ...Array.from(previousByMethod.keys()),
  ]);
  const comparison: ComparisonRow[] = Array.from(allMethods)
    .map((method) => {
      const current = currentByMethod.get(method) || {
        orders: 0,
        revenue: 0,
      };
      const previous = previousByMethod.get(method) || { orders: 0, revenue: 0 };
      const orderDeltaPct = percentageDelta(current.orders, previous.orders);
      const revenueDeltaPct = percentageDelta(current.revenue, previous.revenue);
      return {
        method,
        currentOrders: current.orders,
        previousOrders: previous.orders,
        currentRevenue: current.revenue,
        previousRevenue: previous.revenue,
        orderDeltaPct,
        revenueDeltaPct,
      };
    })
    .sort((a, b) => b.currentRevenue - a.currentRevenue);

  const countrySplit = Array.from(countryByMethod.entries())
    .map(([key, values]) => {
      const [countryCode, method] = key.split("__");
      return { countryCode, method, orders: values.orders, revenue: values.revenue };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 12);

  const aovByMethod = Array.from(currentByMethod.entries())
    .map(([method, values]) => ({
      method,
      aov: values.orders ? values.revenue / values.orders : 0,
      orders: values.orders,
      cancelled: values.cancelled,
      cancelledRate: values.orders ? (values.cancelled / values.orders) * 100 : 0,
      guest: values.guest,
      customer: values.customer,
    }))
    .sort((a, b) => b.aov - a.aov);
  const refundCancelByMethod = Array.from(currentByMethod.entries())
    .map(([method, values]) => ({
      method,
      cancelledRate: values.orders ? (values.cancelled / values.orders) * 100 : 0,
      refundedRate: values.orders ? (values.refundedOrders / values.orders) * 100 : 0,
      refundedAmount: values.refundedAmount,
    }))
    .sort((a, b) => b.refundedAmount - a.refundedAmount);
  const customerMixByMethod = Array.from(currentByMethod.entries())
    .map(([method, values]) => ({
      method,
      newCustomer: values.newCustomer,
      returningCustomer: values.returningCustomer,
      guest: values.guest,
      customer: values.customer,
    }))
    .sort((a, b) => (b.newCustomer + b.returningCustomer + b.guest) - (a.newCustomer + a.returningCustomer + a.guest));

  const previousAverageOrderValue = previousTotalOrders ? previousTotalRevenue / previousTotalOrders : 0;
  const orderDelta = percentageDelta(totalOrders, previousTotalOrders);
  const revenueDelta = percentageDelta(totalRevenue, previousTotalRevenue);
  const aovDelta = percentageDelta(averageOrderValue, previousAverageOrderValue);

  const alerts = comparison
    .filter((row) => row.currentOrders + row.previousOrders >= 3)
    .filter((row) => Math.abs(row.revenueDeltaPct) >= 20 || Math.abs(row.orderDeltaPct) >= 20)
    .slice(0, 5)
    .map((row) => ({
      method: row.method,
      message: `${row.method}: revenue ${row.revenueDeltaPct >= 0 ? "up" : "down"} ${Math.abs(row.revenueDeltaPct).toFixed(1)}%, orders ${row.orderDeltaPct >= 0 ? "up" : "down"} ${Math.abs(row.orderDeltaPct).toFixed(1)}%`,
    }));

  const gatewayCustomization = paymentCustomizationNodes.find((node: any) => node.title === "ChatAsBot Gateway");
  let configuredMethodNames: string[] = [];
  if (gatewayCustomization?.metafield?.value) {
    try {
      const config = JSON.parse(gatewayCustomization.metafield.value);
      configuredMethodNames = Object.keys(config || {}).map((name) => name.trim().toLowerCase());
    } catch {
      configuredMethodNames = [];
    }
  }
  const configuredSet = new Set(configuredMethodNames);
  let configuredOrders = 0;
  let configuredRevenue = 0;
  for (const row of stats) {
    if (configuredSet.has(row.method.trim().toLowerCase())) {
      configuredOrders += row.orders;
      configuredRevenue += row.revenue;
    }
  }
  const unconfiguredOrders = Math.max(0, totalOrders - configuredOrders);
  const unconfiguredRevenue = Math.max(0, totalRevenue - configuredRevenue);
  const ruleImpactSnapshot = {
    configuredMethods: configuredSet.size,
    configuredOrders,
    configuredRevenue,
    configuredShare: totalOrders ? (configuredOrders / totalOrders) * 100 : 0,
    unconfiguredOrders,
    unconfiguredRevenue,
    unconfiguredShare: totalOrders ? (unconfiguredOrders / totalOrders) * 100 : 0,
  };

    return Response.json({
    rangeValue: hasCustomRange ? "custom" : String(days),
    customStart: hasCustomRange ? customStartParam : null,
    customEnd: hasCustomRange ? customEndParam : null,
    days,
    currency,
    totalOrders,
    totalRevenue,
    previousTotalOrders,
    previousTotalRevenue,
    orderDelta,
    revenueDelta,
    aovDelta,
    cancelledRate,
    refundedRate,
    refundedOrders,
    refundedAmount,
    averageOrderValue,
    topMethod,
    topMethodOrders,
    stats,
    comparison,
    countrySplit,
    aovByMethod,
    hourlyOrders,
    alerts,
    refundCancelByMethod,
    customerMixByMethod,
    ruleImpactSnapshot,
    });
  } catch (error: any) {
    const message =
      error?.message ||
      error?.response?.data?.errors?.[0]?.message ||
      "Unexpected analytics error in production.";
    return safeEmpty(days, message);
  }
};

export default function PaymentStatsPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigation = useNavigation();
  const isFiltering =
    navigation.state !== "idle" &&
    navigation.location?.pathname === location.pathname &&
    navigation.location.search !== location.search;

  const rangeOptions = [
    { label: "Last 7 days", value: "7" },
    { label: "Last 30 days", value: "30" },
    { label: "Last 90 days", value: "90" },
    { label: "Custom date range", value: "custom" },
  ];
  const [selectedRange, setSelectedRange] = useState(data.rangeValue || String(data.days));
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [customStart, setCustomStart] = useState(data.customStart || "");
  const [customEnd, setCustomEnd] = useState(data.customEnd || "");
  useEffect(() => {
    setSelectedRange(data.rangeValue || String(data.days));
    setCustomStart(data.customStart || "");
    setCustomEnd(data.customEnd || "");
  }, [data.rangeValue, data.days, data.customStart, data.customEnd]);
  const canApplyCustom = useMemo(
    () => Boolean(customStart && customEnd && customStart <= customEnd),
    [customStart, customEnd],
  );

  const revenueSortedStats = [...data.stats].sort((a, b) => b.revenue - a.revenue);
  const maxOrders = Math.max(1, ...data.stats.map((row) => row.orders));
  const maxRevenue = Math.max(1, ...data.stats.map((row) => row.revenue));
  const maxHourly = Math.max(1, ...data.hourlyOrders);
  const aovCards = data.aovByMethod.slice(0, 8);
  const hourlySeries = data.hourlyOrders.map((value: number, hour: number) => ({
    key: `h-${String(hour).padStart(2, "0")}`,
    hourLabel: `${String(hour).padStart(2, "0")}:00`,
    value,
  }));
  const comparisonCards = data.comparison.slice(0, 6);
  const countryCards = data.countrySplit.slice(0, 8);
  const hourlyChartHeight = 92;
  const hourlyChartWidth = 780;
  const hourlyPadding = 14;
  const barGap = 4;
  const barCount = hourlySeries.length;
  const barWidth = (hourlyChartWidth - hourlyPadding * 2 - barGap * (barCount - 1)) / barCount;
  const withSign = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  const donutData = data.stats.slice(0, 6);
  const donutColors = ["#2c6ecb", "#008060", "#8a5cf6", "#d97706", "#c026d3", "#0ea5e9"];
  let currentAngle = -90;
  const donutSegments = donutData.map((row, index) => {
    const sweep = (row.share / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sweep;
    currentAngle = endAngle;
    return { row, index, startAngle, endAngle };
  });
  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const angleRad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
  };
  const buildArcPath = (cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) => {
    const startOuter = polarToCartesian(cx, cy, rOuter, startAngle);
    const endOuter = polarToCartesian(cx, cy, rOuter, endAngle);
    const startInner = polarToCartesian(cx, cy, rInner, endAngle);
    const endInner = polarToCartesian(cx, cy, rInner, startAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return [
      `M ${startOuter.x} ${startOuter.y}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
      `L ${startInner.x} ${startInner.y}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
      "Z",
    ].join(" ");
  };

  const exportAnalyticsCsv = () => {
    const esc = (value: string) => `"${String(value).replaceAll('"', '""')}"`;
    const lines: string[] = [
      "Metric,Value",
      `${esc("Range days")},${data.days}`,
      `${esc("Total orders")},${data.totalOrders}`,
      `${esc("Total revenue")},${data.totalRevenue.toFixed(2)}`,
      `${esc("Average order value")},${data.averageOrderValue.toFixed(2)}`,
      `${esc("Top method")},${esc(data.topMethod)}`,
      "",
      "Payment method,Orders,Revenue,Share",
    ];
    for (const row of data.stats) {
      lines.push(`${esc(row.method)},${row.orders},${row.revenue.toFixed(2)},${row.share.toFixed(2)}%`);
    }
    lines.push("", "Method,Cancelled %,Refunded %,Refunded amount");
    for (const row of data.refundCancelByMethod) {
      lines.push(`${esc(row.method)},${row.cancelledRate.toFixed(2)}%,${row.refundedRate.toFixed(2)}%,${row.refundedAmount.toFixed(2)}`);
    }
    lines.push("", "Method,New customers,Returning customers,Guest/Customer");
    for (const row of data.customerMixByMethod) {
      lines.push(`${esc(row.method)},${row.newCustomer},${row.returningCustomer},${row.guest}/${row.customer}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-stats-${data.days}d.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Page>
      <TitleBar title="Payment Method Stats" />
      <Layout>
        <Layout.Section>
          {data.needsUpdate && (
            <Banner tone="warning" title="Permissions update required">
              <p>This page requires `read_orders` and `read_payment_customizations` scopes.</p>
              <Button url={`/auth?shop=${data.shop}`} target="_top">Update App Permissions</Button>
            </Banner>
          )}
          <Card>
            <BlockStack gap="200">
              {data.error && (
                <Card>
                  <Text as="p" tone="critical">
                    Analytics failed to load: {String(data.error)}
                  </Text>
                </Card>
              )}
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">Usage overview</Text>
                <InlineStack gap="200">
                  <Button onClick={exportAnalyticsCsv}>Export analytics (CSV)</Button>
                  <div style={{ minWidth: 180 }}>
                    <Select
                      label=""
                      options={rangeOptions}
                      value={selectedRange}
                      onChange={(value) => {
                        setSelectedRange(value);
                        if (value === "custom") {
                          setIsCustomModalOpen(true);
                          return;
                        }

                        const next = new URLSearchParams(searchParams);
                        next.set("days", value);
                        next.delete("start");
                        next.delete("end");
                        setSearchParams(next);
                      }}
                    />
                  </div>
                </InlineStack>
              </InlineStack>
              <Modal
                open={isCustomModalOpen}
                onClose={() => setIsCustomModalOpen(false)}
                title="Select custom date range"
                primaryAction={{
                  content: "Apply",
                  onAction: () => {
                    const next = new URLSearchParams(searchParams);
                    next.set("days", "custom");
                    next.set("start", customStart);
                    next.set("end", customEnd);
                    setSearchParams(next);
                    setIsCustomModalOpen(false);
                  },
                  disabled: !canApplyCustom,
                  loading: isFiltering,
                }}
                secondaryActions={[
                  {
                    content: "Cancel",
                    onAction: () => setIsCustomModalOpen(false),
                  },
                ]}
              >
                <Modal.Section>
                  <BlockStack gap="300">
                    <Text as="p" tone="subdued">
                      Pick the start and end date for analytics filtering.
                    </Text>
                    <TextField label="Start date" type="date" value={customStart} onChange={setCustomStart} autoComplete="off" />
                    <TextField label="End date" type="date" value={customEnd} onChange={setCustomEnd} autoComplete="off" />
                  </BlockStack>
                </Modal.Section>
              </Modal>
              {isFiltering && (
                <>
                  <div
                    style={{
                      position: "fixed",
                      inset: 0,
                      background: "rgba(0, 0, 0, 0.2)",
                      zIndex: 9999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        background: "#fff",
                        borderRadius: 12,
                        border: "1px solid #d9d9d9",
                        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                        padding: "16px 20px",
                      }}
                    >
                      <Text as="p" variant="headingSm">
                        Fetching updated analytics...
                      </Text>
                    </div>
                  </div>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Updating stats...
                  </Text>
                </>
              )}

              <InlineStack gap="400">
                {data.rangeValue === "custom" && data.customStart && data.customEnd && (
                  <Badge tone="info">{"Range: " + data.customStart + " to " + data.customEnd}</Badge>
                )}
                <Badge tone="info">{"Orders: " + data.totalOrders + " (" + withSign(data.orderDelta) + ")"}</Badge>
                <Badge tone="success">{"Revenue: " + data.currency + " " + data.totalRevenue.toFixed(2) + " (" + withSign(data.revenueDelta) + ")"}</Badge>
                <Badge>{"Methods: " + data.stats.length}</Badge>
                <Badge tone="attention">{"AOV: " + data.currency + " " + data.averageOrderValue.toFixed(2) + " (" + withSign(data.aovDelta) + ")"}</Badge>
                <Badge tone="info">{"Top: " + data.topMethod + " (" + data.topMethodOrders + ")"}</Badge>
                <Badge tone="attention">{"Cancelled: " + data.cancelledRate.toFixed(1) + "%"}</Badge>
                <Badge tone="critical">{"Refunded: " + data.refundedRate.toFixed(1) + "% (" + data.currency + " " + data.refundedAmount.toFixed(2) + ")"}</Badge>
              </InlineStack>

              <details
                style={{
                  border: "1px solid #d9d9d9",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  background: "linear-gradient(180deg,#ffffff 0%,#fafbfc 100%)",
                }}
              >
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  Analytics guide - what each stat means
                </summary>
                <div style={{ marginTop: "12px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: "10px",
                    }}
                  >
                    <Card>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm"><strong>Orders / Revenue / AOV</strong></Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Core performance KPIs. Delta % compares with previous equal date range.
                        </Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm"><strong>Top method</strong></Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Payment method with highest order count in selected range.
                        </Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm"><strong>Cancelled / Refunded</strong></Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Risk indicators. Higher rates may indicate checkout friction or payment issues.
                        </Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm"><strong>Rule impact snapshot</strong></Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Shows how much volume/revenue is covered by methods configured in your rules.
                        </Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm"><strong>Orders/Revenue by method</strong></Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Method ranking. Use it to prioritize rename/default/order strategies.
                        </Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm"><strong>Method share chart</strong></Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Relative method mix. Quick view of dependency on each payment method.
                        </Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm"><strong>Hourly distribution (UTC)</strong></Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Best order hours. Useful for campaigns and operational planning.
                        </Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm"><strong>Trend / AOV risk / Country split</strong></Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Compare movement, identify risky methods, and see regional payment behavior.
                        </Text>
                      </BlockStack>
                    </Card>
                  </div>
                </div>
              </details>

              <div style={{ columnCount: 2, columnGap: "16px" }}>
                <div style={{ breakInside: "avoid", marginBottom: "16px" }}>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">Rule impact snapshot</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone="info">{"Configured methods: " + data.ruleImpactSnapshot.configuredMethods}</Badge>
                        <Badge tone="success">{"Configured share: " + data.ruleImpactSnapshot.configuredShare.toFixed(1) + "%"}</Badge>
                        <Badge tone={data.ruleImpactSnapshot.unconfiguredShare > 0 ? "attention" : undefined}>
                          {"Unconfigured share: " + data.ruleImpactSnapshot.unconfiguredShare.toFixed(1) + "%"}
                        </Badge>
                      </InlineStack>
                      <div style={{ background: "#eef1f4", borderRadius: 8, height: 10 }}>
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, data.ruleImpactSnapshot.configuredShare))}%`,
                            background: "#008060",
                            borderRadius: 8,
                            height: 10,
                          }}
                        />
                      </div>
                      <InlineStack align="space-between">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {"Configured: " + data.ruleImpactSnapshot.configuredOrders + " orders"}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {data.currency + " " + data.ruleImpactSnapshot.configuredRevenue.toFixed(2)}
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {"Unconfigured: " + data.ruleImpactSnapshot.unconfiguredOrders + " orders"}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {data.currency + " " + data.ruleImpactSnapshot.unconfiguredRevenue.toFixed(2)}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </div>

                <div style={{ breakInside: "avoid", marginBottom: "16px" }}>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">Refund and cancellation by method</Text>
                    {data.refundCancelByMethod.slice(0, 6).map((row: { method: string; cancelledRate: number; refundedRate: number; refundedAmount: number }) => (
                        <Card key={`risk-${row.method}`}>
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="p" variant="bodyMd"><strong>{row.method}</strong></Text>
                              <Badge tone={row.refundedRate > 5 || row.cancelledRate > 5 ? "critical" : "success"}>
                                {"Risk " + (row.refundedRate + row.cancelledRate).toFixed(1) + "%"}
                              </Badge>
                            </InlineStack>
                            <InlineStack gap="300">
                              <Text as="p" variant="bodySm">{"Cancelled: " + row.cancelledRate.toFixed(1) + "%"}</Text>
                              <Text as="p" variant="bodySm">{"Refunded: " + row.refundedRate.toFixed(1) + "%"}</Text>
                              <Text as="p" variant="bodySm">{data.currency + " " + row.refundedAmount.toFixed(2)}</Text>
                            </InlineStack>
                            <div style={{ background: "#eef1f4", borderRadius: 8, height: 8 }}>
                              <div
                                style={{
                                  width: `${Math.max(6, Math.min(100, row.refundedRate + row.cancelledRate))}%`,
                                  background: row.refundedRate + row.cancelledRate > 5 ? "#d82c0d" : "#008060",
                                  borderRadius: 8,
                                  height: 8,
                                }}
                              />
                            </div>
                          </BlockStack>
                        </Card>
                      ))}
                    </BlockStack>
                  </Card>
                </div>

                {data.alerts.length > 0 && (
                  <div style={{ breakInside: "avoid", marginBottom: "16px" }}>
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">Smart alerts</Text>
                        {data.alerts.map((alert: any) => (
                          <Text key={alert.method} as="p" tone="subdued">{alert.message}</Text>
                        ))}
                      </BlockStack>
                    </Card>
                  </div>
                )}

                <div style={{ breakInside: "avoid", marginBottom: "16px" }}>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">Orders by method</Text>
                      {data.stats.slice(0, 8).map((row: StatRow) => (
                        <BlockStack key={`orders-${row.method}`} gap="200">
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodySm">{row.method}</Text>
                            <Text as="p" variant="bodySm">{row.orders}</Text>
                          </InlineStack>
                          <div style={{ background: "#f1f2f4", borderRadius: 6, height: 8 }}>
                            <div
                              style={{
                                width: `${(row.orders / maxOrders) * 100}%`,
                                background: "#2c6ecb",
                                borderRadius: 6,
                                height: 8,
                              }}
                            />
                          </div>
                        </BlockStack>
                      ))}
                    </BlockStack>
                  </Card>
                </div>

                <div style={{ breakInside: "avoid", marginBottom: "16px" }}>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">Revenue by method</Text>
                      {revenueSortedStats.slice(0, 8).map((row: StatRow) => (
                        <BlockStack key={`revenue-${row.method}`} gap="200">
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodySm">{row.method}</Text>
                            <Text as="p" variant="bodySm">{data.currency + " " + row.revenue.toFixed(2)}</Text>
                          </InlineStack>
                          <div style={{ background: "#f1f2f4", borderRadius: 6, height: 8 }}>
                            <div
                              style={{
                                width: `${(row.revenue / maxRevenue) * 100}%`,
                                background: "#008060",
                                borderRadius: 6,
                                height: 8,
                              }}
                            />
                          </div>
                        </BlockStack>
                      ))}
                    </BlockStack>
                  </Card>
                </div>
              </div>

              <Card>
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">Method share chart</Text>
                  {donutData.length === 0 ? (
                    <Text as="p" tone="subdued">No payment method data available.</Text>
                  ) : (
                    <InlineStack gap="500" blockAlign="center">
                      <svg width="220" height="220" aria-label="Payment method share chart">
                        {donutSegments.map((segment: { row: StatRow; index: number; startAngle: number; endAngle: number }) => (
                          <path
                            key={segment.row.method}
                            d={buildArcPath(110, 110, 90, 55, segment.startAngle, segment.endAngle)}
                            fill={donutColors[segment.index % donutColors.length]}
                          />
                        ))}
                      </svg>
                      <BlockStack gap="200">
                        {donutData.map((row, index) => (
                          <InlineStack key={`legend-${row.method}`} gap="200" blockAlign="center">
                            <div
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 2,
                                background: donutColors[index % donutColors.length],
                              }}
                            />
                            <Text as="span" variant="bodySm">
                              {`${row.method} - ${row.share.toFixed(1)}%`}
                            </Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">Hourly orders distribution (UTC)</Text>
                  <div style={{ width: "100%", overflowX: "auto" }}>
                    <svg width={hourlyChartWidth} height={hourlyChartHeight} aria-label="Hourly orders mini chart">
                      <line x1={hourlyPadding} y1={hourlyChartHeight - 16} x2={hourlyChartWidth - hourlyPadding} y2={hourlyChartHeight - 16} stroke="#d2d5d8" />
                      {hourlySeries.map((entry: any, index: number) => {
                        const height = (entry.value / maxHourly) * (hourlyChartHeight - 34);
                        const x = hourlyPadding + index * (barWidth + barGap);
                        const y = hourlyChartHeight - 16 - height;
                        return (
                          <g key={entry.key}>
                            <rect
                              x={x}
                              y={y}
                              width={barWidth}
                              height={Math.max(2, height)}
                              rx={2}
                              fill={entry.value > 0 ? "#5c6ac4" : "#e4e7ea"}
                            />
                            {index % 3 === 0 && (
                              <text x={x + barWidth / 2} y={hourlyChartHeight - 3} textAnchor="middle" fontSize="9" fill="#6d7175">
                                {entry.hourLabel.slice(0, 2)}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Compact view by hour. Dark bars indicate higher order volume.
                  </Text>
                </BlockStack>
              </Card>

              <Layout>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">Method trend comparison</Text>
                      {comparisonCards.map((row: ComparisonRow) => (
                        <Card key={`cmp-${row.method}`}>
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="p" variant="bodyMd"><strong>{row.method}</strong></Text>
                              <Badge tone={row.revenueDeltaPct >= 0 ? "success" : "critical"}>
                                {withSign(row.revenueDeltaPct)}
                              </Badge>
                            </InlineStack>
                            <InlineStack align="space-between">
                              <Text as="p" variant="bodySm" tone="subdued">{"Orders: " + row.currentOrders + " vs " + row.previousOrders}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {data.currency + " " + row.currentRevenue.toFixed(2) + " vs " + data.currency + " " + row.previousRevenue.toFixed(2)}
                              </Text>
                            </InlineStack>
                          </BlockStack>
                        </Card>
                      ))}
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="200">
                      {aovCards.map((row: { method: string; cancelledRate: number; aov: number; orders: number; guest: number; customer: number }) => (
                        <Card key={`aov-${row.method}`}>
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="p" variant="bodyMd"><strong>{row.method}</strong></Text>
                              <Badge tone={row.cancelledRate > 5 ? "critical" : "success"}>
                                {"Cancelled " + row.cancelledRate.toFixed(1) + "%"}
                              </Badge>
                            </InlineStack>
                            <InlineStack gap="300" blockAlign="center">
                              <Text as="p" variant="bodySm">{"AOV: " + data.currency + " " + row.aov.toFixed(2)}</Text>
                              <Text as="p" variant="bodySm">{"Orders: " + row.orders}</Text>
                              <Text as="p" variant="bodySm">{"Guest/Customer: " + row.guest + "/" + row.customer}</Text>
                            </InlineStack>
                            <div style={{ background: "#f1f2f4", borderRadius: 6, height: 8 }}>
                              <div
                                style={{
                                  width: `${Math.max(6, 100 - row.cancelledRate)}%`,
                                  background: row.cancelledRate > 5 ? "#d82c0d" : "#008060",
                                  borderRadius: 6,
                                  height: 8,
                                }}
                              />
                            </div>
                          </BlockStack>
                        </Card>
                      ))}
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>

              <Card>
                <BlockStack gap="200">
                  {countryCards.map((row: { countryCode: string; method: string; orders: number; revenue: number }) => (
                    <Card key={`country-${row.countryCode}-${row.method}`}>
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge>{row.countryCode}</Badge>
                          <Text as="p" variant="bodyMd"><strong>{row.method}</strong></Text>
                        </InlineStack>
                        <InlineStack gap="300">
                          <Text as="p" variant="bodySm">Orders: {row.orders}</Text>
                          <Text as="p" variant="bodySm">{data.currency} {row.revenue.toFixed(2)}</Text>
                        </InlineStack>
                      </InlineStack>
                    </Card>
                  ))}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">New vs returning and guest/customer mix</Text>
                  {data.customerMixByMethod.slice(0, 8).map((row: { method: string; guest: number; customer: number; newCustomer: number; returningCustomer: number }) => {
                    const totalKnown = row.newCustomer + row.returningCustomer;
                    const returningShare = totalKnown ? (row.returningCustomer / totalKnown) * 100 : 0;
                    return (
                      <Card key={`mix-${row.method}`}>
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p" variant="bodyMd"><strong>{row.method}</strong></Text>
                          <Badge tone="info">{`Guest/Customer: ${row.guest}/${row.customer}`}</Badge>
                        </InlineStack>
                        <InlineStack gap="300">
                          <Text as="p" variant="bodySm">New: {row.newCustomer}</Text>
                          <Text as="p" variant="bodySm">Returning: {row.returningCustomer}</Text>
                        </InlineStack>
                        <div style={{ background: "#eef1f4", borderRadius: 8, height: 8 }}>
                          <div
                            style={{
                              width: `${Math.max(6, returningShare)}%`,
                              background: "#5c6ac4",
                              borderRadius: 8,
                              height: 8,
                            }}
                          />
                        </div>
                      </BlockStack>
                      </Card>
                    );
                  })}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">Payment method summary</Text>
                  {data.stats.map((row: StatRow) => (
                    <Card key={`summary-${row.method}`}>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" variant="bodyMd"><strong>{row.method}</strong></Text>
                        <InlineStack gap="300">
                          <Text as="p" variant="bodySm">Orders: {row.orders}</Text>
                          <Text as="p" variant="bodySm">{data.currency} {row.revenue.toFixed(2)}</Text>
                          <Badge>{`${row.share.toFixed(1)}%`}</Badge>
                        </InlineStack>
                      </InlineStack>
                    </Card>
                  ))}
                </BlockStack>
              </Card>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  let title = "Payment stats failed to render";
  let details = "Unexpected UI error. Please refresh and check server logs.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    details = typeof error.data === "string" ? error.data : JSON.stringify(error.data);
  } else if (error instanceof Error) {
    details = error.message;
  }

  return (
    <Page>
      <TitleBar title="Payment Method Stats" />
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
