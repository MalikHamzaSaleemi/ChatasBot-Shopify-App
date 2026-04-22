// import { json, LoaderFunctionArgs } from "@remix-run/node";
// import {
//   Links,
//   Meta,
//   Outlet,
//   Scripts,
//   ScrollRestoration,
//   useLoaderData,
// } from "@remix-run/react";
// import { AppProvider } from "@shopify/polaris";

// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   return json({ apiKey: process.env.SHOPIFY_API_KEY! });
// };

// export default function App() {
//   return (
//     <html>
//       <head>
//         <meta charSet="utf-8" />
//         <meta name="viewport" content="width=device-width,initial-scale=1" />
//         <link rel="preconnect" href="https://cdn.shopify.com/" />
//         <link
//           rel="stylesheet"
//           href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
//         />
//         <Meta />
//         <Links />
//       </head>
//       <body>
//         <AppProvider i18n={{}}>
//           <Outlet />
//           <ScrollRestoration />
//           <Scripts />
//         </AppProvider>
//       </body>
//     </html>
//   );
// }


import { json, LoaderFunctionArgs } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json"; 
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({ apiKey: process.env.SHOPIFY_API_KEY! });
};

// 👇 add Polaris CSS via Remix links
export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {/* ✅ Provide Polaris with proper i18n + CSS */}
        <AppProvider i18n={enTranslations}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
